import logging
import math
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.map_server import MapServer
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.anomaly import Anomaly, AnomalyStatus
from models.anomaly_response import DiversionPhase, DiversionReturning, DiversionStarted
from models.device import DeviceView
from models.mission_execution import MissionStatus
from transport.zenoh_gateway import ZenohGateway

if TYPE_CHECKING:
    from core.mission_drive import MissionDriveCoordinator

logger = logging.getLogger(__name__)

# The statuses that make up one mission run, from Start until Stop/switch/
# completion. Only anomalies detected during a run are investigated by it --
# see on_anomaly_detected(), begin_run() and end_run().
_RUN_STATUSES = (MissionStatus.RUNNING, MissionStatus.INVESTIGATING, MissionStatus.PAUSED)


@dataclass
class _ActiveDiversion:
    token: int
    anomaly_id: str
    robot_device_id: str
    phase: DiversionPhase
    anomaly_target_xy: tuple[float, float]
    started_payload: dict
    # The tracked robot's own DeviceState.timestamp at the moment the
    # current leg's navigate_to_goal was issued -- an "arrived" sample only
    # completes this leg if its timestamp is strictly newer. Same fix as
    # MissionDriveCoordinator._ActiveGoal.issued_after_timestamp, and for
    # the identical reason: without this, a stale "arrived" sample left
    # over from whatever the robot was doing *before* this leg started
    # (most notably: finishing a mission waypoint at the same moment this
    # diversion begins, or reaching the anomaly right as the return leg
    # begins) satisfies a goal that was never actually acted on --
    # silently advancing this phase past OUTBOUND/RETURNING before the
    # robot has moved at all, so the real arrival later is never recognized.
    issued_after_timestamp: float
    # Set only once the RETURNING leg starts (see resolve()): the mission
    # waypoint the robot is heading back to, chosen as the one closest to
    # the last investigated anomaly by lanelet route distance.
    return_waypoint_index: int | None = None
    return_waypoint_xy: tuple[float, float] | None = None
    returning_payload: dict | None = None


# "arrived" alone doesn't say arrived at WHAT -- DeviceState carries no
# goal/request-id to correlate against. If MissionDriveCoordinator's "go to
# the next waypoint" command physically races with this diversion's own "go
# to the anomaly" command (both can be in flight within the same instant --
# see abort()'s call site in on_anomaly_detected), whichever reaches the
# robot last wins, and the robot can genuinely, freshly arrive at the WRONG
# place. issued_after_timestamp alone can't catch that (the sample is
# legitimately new, just for a different goal), so on_device_state also
# checks the robot's reported position against this leg's actual target.
ARRIVAL_POSITION_TOLERANCE_M = 2.0


class AnomalyResponseCoordinator:
    """Drives the anomaly -> robot-diverts -> operator-resolves -> robot-
    returns workflow, over a FIFO queue of anomalies awaiting investigation.

    The queue belongs to the current mission run: only anomalies detected
    while one is in progress (RUNNING/INVESTIGATING/PAUSED) are queued, and
    it's cleared whenever a run starts or ends (begin_run()/end_run()) --
    an anomaly detected outside a run is only recorded (visible on the map
    as DETECTED), never investigated.

    Every anomaly detected during a run is appended to the queue. Whenever the
    queue is non-empty and the mission is RUNNING, the robot diverts to the
    head of the queue (the mission enters INVESTIGATING). Once the operator
    verifies/dismisses it, the robot goes straight on to the next queued
    anomaly if there is one; only when the queue is empty does it return to
    the mission, at the waypoint closest to where it is by lanelet route
    distance (see _closest_waypoint). An anomaly detected during that
    return leg interrupts it the same way. Anomalies detected while PAUSED
    wait in the queue until the mission is resumed (see dispatch_pending).

    Sends the robot a `navigate_to_goal` command (see ZenohGateway.
    publish_command) for each outbound (to an anomaly) and return (back to
    the mission) leg, then waits for the tracked robot's own
    reported arrival (DeviceState.status.operational_state == "arrived",
    delivered via on_device_state()) -- the robot (dummy_robot today, a
    real onboard nav stack later) plans its own path there, this class
    never computes or sends one. There is deliberately no timeout on this
    wait (a diversion can legitimately take a while) -- the only automatic
    way out is `abort_if_robot_disconnected()`; the manual way out is
    Stop, which `MissionExecutionManager.stop()` allows even mid-diversion
    specifically as an escape hatch (see core/mission_execution.py).

    Almost everything here is synchronous and RLock-protected, callable
    from any thread (Zenoh's subscriber thread or a FastAPI sync-route
    thread-pool thread) -- exactly like MissionExecutionManager.

    Orchestration mostly happens at the call site (zenoh_gateway's ingest,
    api/anomaly.py's verify/dismiss, api/mission.py's/api/mission_execution.py's
    abort triggers), matching this codebase's existing convention (see
    api/mission.py) -- but this class DOES mutate MissionExecutionManager
    in one specific way: entering/exiting the INVESTIGATING status, via
    enter_investigating()/exit_investigating(). That status has to be
    genuinely authoritative (it's what blocks Pause/Resume/Stop-as-normal
    during a diversion), so it can't just be inferred by reading state --
    something has to own setting it, and this is the only thing that knows
    when a diversion starts/ends. MissionDriveCoordinator, bound late via
    bind_mission_drive() (same construction-order reason as ZenohGateway.
    bind_coordinators()), is paused/resumed the same way for the same
    reason: the two must never command the robot at once.
    """

    def __init__(
        self,
        anomaly_registry: AnomalyRegistry,
        mission_execution_manager: MissionExecutionManager,
        mission_server: MissionServer,
        map_server: MapServer,
        device_registry: DeviceRegistry,
        websocket_manager: WebSocketManager,
        zenoh_gateway: ZenohGateway,
        settings: Settings,
    ) -> None:
        self._anomaly_registry = anomaly_registry
        self._mission_execution_manager = mission_execution_manager
        self._mission_server = mission_server
        self._map_server = map_server
        self._device_registry = device_registry
        self._websocket_manager = websocket_manager
        self._zenoh_gateway = zenoh_gateway
        self._settings = settings
        self._mission_drive_coordinator: "MissionDriveCoordinator | None" = None

        self._lock = threading.RLock()
        self._active: _ActiveDiversion | None = None
        self._queue: deque[str] = deque()
        self._next_token = 0

    def bind_mission_drive(self, mission_drive_coordinator: "MissionDriveCoordinator") -> None:
        self._mission_drive_coordinator = mission_drive_coordinator

    def is_active_for(self, device_id: str) -> bool:
        """For MissionDriveCoordinator: is a diversion currently commanding
        this robot? While true, mission-driven waypoint goals must not be
        sent, and any arrival report for it belongs to this diversion, not
        a mission waypoint."""
        with self._lock:
            return self._active is not None and self._active.robot_device_id == device_id

    def on_anomaly_detected(self, anomaly: Anomaly) -> None:
        """Call once per newly-created anomaly (not on re-published updates
        to an already-known one) -- see zenoh_gateway.py's is_new gate.
        Queues it if a mission run is in progress, then starts
        investigating right away if nothing else is holding the robot."""
        if not self._settings.anomaly_response_enabled:
            return

        exec_state = self._mission_execution_manager.get_state()
        if exec_state is None or exec_state.status not in _RUN_STATUSES:
            logger.info("Anomaly %s detected outside a mission run; not queued", anomaly.anomaly_id)
            return

        with self._lock:
            active_id = self._active.anomaly_id if self._active is not None else None
            if anomaly.anomaly_id in self._queue or anomaly.anomaly_id == active_id:
                return
            self._queue.append(anomaly.anomaly_id)
            logger.info("Anomaly %s queued for investigation (%d in queue)", anomaly.anomaly_id, len(self._queue))

        self.dispatch_pending()

    def dispatch_pending(self) -> None:
        """Starts investigating the head of the queue if the robot is free
        to: the mission is RUNNING (or INVESTIGATING but only returning to
        the mission, which a queued anomaly interrupts). Always safe to
        call speculatively -- a no-op whenever the queue is empty or the
        preconditions don't hold. Called on every new anomaly, after
        resume() (api/mission_execution.py), and whenever the robot
        reports state with no diversion active (so a queue left waiting on
        a disconnected robot picks back up once it reconnects)."""
        if not self._settings.anomaly_response_enabled:
            return

        with self._lock:
            if not self._queue:
                return
            active = self._active
            if active is not None and active.phase != DiversionPhase.RETURNING:
                return  # already investigating; the queue waits its turn

            exec_state = self._mission_execution_manager.get_state()
            if exec_state is None:
                return
            if active is None and exec_state.status != MissionStatus.RUNNING:
                return
            if active is not None and exec_state.status != MissionStatus.INVESTIGATING:
                return

            robot = self._device_registry.get_connected_robot()
            if robot is None or not self._map_server.is_available():
                return

            started = self._start_next_outbound(robot, exec_state.mission_id, enter_investigating=active is None)

        if started is not None:
            self._announce_outbound(*started)

    def _start_next_outbound(
        self, robot: DeviceView, mission_id: str, *, enter_investigating: bool
    ) -> tuple[Anomaly, DeviceView, str, int, dict] | None:
        """Must be called with self._lock held. Pops queued anomalies until
        one is routable, and makes it the active OUTBOUND diversion.
        Returns what _announce_outbound() needs (to run outside the lock),
        or None if nothing could be started."""
        while self._queue:
            anomaly_id = self._queue[0]
            anomaly = self._anomaly_registry.get(anomaly_id)
            if anomaly is None or anomaly.status != AnomalyStatus.DETECTED:
                self._queue.popleft()  # resolved or gone in the meantime
                continue

            target_point = self._map_server.snap_to_lanelet(anomaly.x, anomaly.y, anomaly.frame_id)
            route = self._map_server.get_route(
                [{"x": robot.pose.x, "y": robot.pose.y}, {"x": target_point.x, "y": target_point.y}]
            )
            if route is None:
                # Left at DETECTED, but no longer queued -- retrying it
                # would block every anomaly behind it on the same failure.
                self._queue.popleft()
                logger.warning("Anomaly %s: no route from robot to anomaly; dropped from queue", anomaly_id)
                continue

            # Authoritative commit gate, re-checked as late as possible:
            # enter_investigating() re-checks status atomically under
            # MissionExecutionManager's own lock and returns None if it's no
            # longer RUNNING (a pause()/stop() won the race) -- if so, leave
            # the anomaly queued and back out.
            if enter_investigating and self._mission_execution_manager.enter_investigating() is None:
                logger.info("Anomaly %s: mission status changed before diversion could start", anomaly_id)
                return None

            self._queue.popleft()
            token = self._next_token = self._next_token + 1
            started_payload = DiversionStarted(
                anomaly_id=anomaly_id,
                robot_device_id=robot.device_id,
                route=route,
                target=target_point,
                started_at=datetime.now(timezone.utc),
            ).model_dump(mode="json")
            self._active = _ActiveDiversion(
                token=token,
                anomaly_id=anomaly_id,
                robot_device_id=robot.device_id,
                phase=DiversionPhase.OUTBOUND,
                anomaly_target_xy=(target_point.x, target_point.y),
                started_payload=started_payload,
                issued_after_timestamp=robot.timestamp,
            )
            return anomaly, robot, mission_id, token, started_payload
        return None

    def _announce_outbound(
        self, anomaly: Anomaly, robot: DeviceView, mission_id: str, token: int, started_payload: dict
    ) -> None:
        # This diversion now owns the robot -- release any mission-driven
        # waypoint goal in flight (it was just physically superseded by the
        # navigate_to_goal command below, but MissionDriveCoordinator's own
        # bookkeeping doesn't know that yet).
        if self._mission_drive_coordinator is not None:
            self._mission_drive_coordinator.abort()

        self._anomaly_registry.record_mission_context(anomaly.anomaly_id, mission_id)
        updated = self._anomaly_registry.update_status(anomaly.anomaly_id, AnomalyStatus.ROBOT_EN_ROUTE)
        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.updated", "data": updated.model_dump(mode="json")}
        )
        self._websocket_manager.broadcast_threadsafe({"type": "anomaly.diversion.started", "data": started_payload})

        target = started_payload["target"]
        sent = self._zenoh_gateway.publish_command(
            robot.device_id, "navigate_to_goal",
            request_id=f"anomaly-{anomaly.anomaly_id}-outbound-{token}",
            fields={"x": target["x"], "y": target["y"], "frame_id": target["frame_id"]},
        )
        if not sent:
            logger.warning("Anomaly %s: failed to publish navigate_to_goal command", anomaly.anomaly_id)

        logger.info("Anomaly %s: robot %s diverting", anomaly.anomaly_id, robot.device_id)

    def on_device_state(self, view: DeviceView) -> None:
        """Called by ZenohGateway for every meaningfully-changed device
        state -- a cheap no-op unless this device is the one an active
        diversion is waiting on."""
        with self._lock:
            active = self._active
            idle_with_queue = active is None and bool(self._queue)
        if idle_with_queue:
            self.dispatch_pending()
            return

        with self._lock:
            active = self._active
            if active is None or active.robot_device_id != view.device_id:
                return
            if view.status.get("operational_state") != "arrived":
                return
            if view.timestamp <= active.issued_after_timestamp:
                return  # stale sample from before this leg's goal was issued
            phase = active.phase
            # AWAITING_RESOLUTION has no active navigation goal at all -- the
            # robot is just parked at the anomaly waiting on the operator, so
            # there's nothing to position-check here (and no reason for
            # on_device_state to do anything else either; the dispatch below
            # only acts on OUTBOUND/RETURNING).
            if phase in (DiversionPhase.OUTBOUND, DiversionPhase.RETURNING):
                target_x, target_y = (
                    active.anomaly_target_xy if phase == DiversionPhase.OUTBOUND else active.return_waypoint_xy
                )
                distance = math.hypot(view.pose.x - target_x, view.pose.y - target_y)
                if distance > ARRIVAL_POSITION_TOLERANCE_M:
                    # Genuinely new "arrived" sample, but not at this leg's
                    # target -- most likely a mission-drive goal that raced
                    # with this diversion's own command and reached the
                    # robot last (see abort()'s call site in
                    # on_anomaly_detected). Not this leg's arrival; ignore.
                    logger.warning(
                        "Anomaly %s: robot reported arrived %.1fm from expected %s target; ignoring",
                        active.anomaly_id, distance, phase.value,
                    )
                    return
            token = active.token
            anomaly_id = active.anomaly_id

        if phase == DiversionPhase.OUTBOUND:
            self._complete_arrival(token, anomaly_id)
        elif phase == DiversionPhase.RETURNING:
            self._complete_return(token, anomaly_id)

    def _complete_arrival(self, token: int, anomaly_id: str) -> None:
        with self._lock:
            if self._active is None or self._active.token != token or self._active.phase != DiversionPhase.OUTBOUND:
                return  # already handled or superseded
            self._active.phase = DiversionPhase.AWAITING_RESOLUTION

        updated = self._anomaly_registry.update_status(anomaly_id, AnomalyStatus.ROBOT_ARRIVED)
        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.updated", "data": updated.model_dump(mode="json")}
        )
        # No separate diversion event here -- AnomalyArrivalWatcher already
        # reacts to anomaly.updated's robot_arrived status.
        logger.info("Anomaly %s: robot arrived, awaiting operator resolution", anomaly_id)

    def _complete_return(self, token: int, anomaly_id: str) -> None:
        with self._lock:
            if self._active is None or self._active.token != token or self._active.phase != DiversionPhase.RETURNING:
                return
            waypoint_index = self._active.return_waypoint_index
            self._active = None
        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.diversion.cleared", "data": {"anomaly_id": anomaly_id, "reason": "return_complete"}}
        )
        logger.info("Anomaly %s: diversion cleared (return_complete)", anomaly_id)
        self._end_diversion(reached_waypoint_index=waypoint_index)

    def resolve(self, anomaly_id: str) -> None:
        """Call after verify() or dismiss() succeeds -- both resolve an
        anomaly identically (see anomaly_registry._resolve's docstring).
        Moves on to the next queued anomaly if there is one; otherwise
        heads back to the mission."""
        with self._lock:
            active = self._active
            if active is None or active.anomaly_id != anomaly_id or active.phase != DiversionPhase.AWAITING_RESOLUTION:
                logger.info("Anomaly %s resolved but no matching in-flight diversion; no-op", anomaly_id)
                return

            robot = self._device_registry.get(active.robot_device_id)
            exec_state = self._mission_execution_manager.get_state()
            next_started = None
            if self._queue and robot is not None and robot.connected and exec_state is not None:
                self._active = None
                next_started = self._start_next_outbound(robot, exec_state.mission_id, enter_investigating=False)
                if next_started is None:
                    self._active = active  # nothing routable left; fall through to the return leg

            if next_started is None:
                returning = self._start_return(active, exec_state.mission_id if exec_state else None)

        if next_started is not None:
            logger.info("Anomaly %s resolved; moving on to the next queued anomaly", anomaly_id)
            self._announce_outbound(*next_started)
            return

        if returning is None:
            self._websocket_manager.broadcast_threadsafe(
                {"type": "anomaly.diversion.cleared", "data": {"anomaly_id": anomaly_id, "reason": "return_route_unavailable"}}
            )
            logger.info("Anomaly %s resolved but no return route available; cleared without a return leg", anomaly_id)
            self._end_diversion()
            return

        robot_device_id, token, returning_payload, (wx, wy) = returning
        self._websocket_manager.broadcast_threadsafe({"type": "anomaly.diversion.returning", "data": returning_payload})

        sent = self._zenoh_gateway.publish_command(
            robot_device_id, "navigate_to_goal",
            request_id=f"anomaly-{anomaly_id}-return-{token}",
            fields={"x": wx, "y": wy, "frame_id": "map"},
        )
        if not sent:
            logger.warning("Anomaly %s: failed to publish return-leg navigate_to_goal command", anomaly_id)

        logger.info("Anomaly %s: robot returning to mission", anomaly_id)

    def _start_return(
        self, active: _ActiveDiversion, mission_id: str | None
    ) -> tuple[str, int, dict, tuple[float, float]] | None:
        """Must be called with self._lock held. Switches `active` to the
        RETURNING leg, toward the mission waypoint closest to the anomaly
        the robot is parked at. Clears it and returns None if there's no
        mission/map/route to return along."""
        mission = self._mission_server.get_mission(mission_id) if mission_id else None
        closest = None
        if mission is not None and mission.waypoints and self._map_server.is_available():
            closest = self._closest_waypoint(active.anomaly_target_xy, mission.waypoints)
        if closest is None:
            self._active = None
            return None

        waypoint_index, route = closest
        waypoint = mission.waypoints[waypoint_index]
        returning_payload = DiversionReturning(
            anomaly_id=active.anomaly_id,
            robot_device_id=active.robot_device_id,
            route=route,
            target_waypoint_id=waypoint.waypoint_id,
            started_at=datetime.now(timezone.utc),
        ).model_dump(mode="json")
        active.phase = DiversionPhase.RETURNING
        active.return_waypoint_index = waypoint_index
        active.return_waypoint_xy = (waypoint.x, waypoint.y)
        active.returning_payload = returning_payload
        # Same staleness guard as the outbound leg (see
        # _ActiveDiversion.issued_after_timestamp) -- otherwise a stale
        # "arrived" sample left over from reaching the anomaly (the
        # outbound leg's own destination) would immediately satisfy the
        # return leg too, before the robot has moved at all.
        current_view = self._device_registry.get(active.robot_device_id)
        if current_view is not None:
            active.issued_after_timestamp = current_view.timestamp
        return active.robot_device_id, active.token, returning_payload, (waypoint.x, waypoint.y)

    def _closest_waypoint(self, from_xy: tuple[float, float], waypoints: list) -> tuple[int, dict] | None:
        """(index, route) of the mission waypoint with the shortest lanelet
        route from `from_xy` -- not straight-line distance: lanelets are
        one-way, so a waypoint a few meters behind the robot can be a full
        lap away. None if no waypoint is routable."""
        fx, fy = from_xy
        best = None
        for index, waypoint in enumerate(waypoints):
            route = self._map_server.get_route([{"x": fx, "y": fy}, {"x": waypoint.x, "y": waypoint.y}])
            if route is None:
                continue
            length = route["properties"]["length_m"]
            if best is None or length < best[0]:
                best = (length, index, route)
        return (best[1], best[2]) if best is not None else None

    def begin_run(self) -> None:
        """Call on Start (api/mission_execution.py), before mission drive
        sends the first waypoint -- a new run starts with an empty queue.
        Normally already empty (end_run() clears it on Stop/switch, and a
        run only completes once the queue is empty); this is the backstop."""
        with self._lock:
            if self._queue:
                logger.info("Mission run starting; dropping %d anomalies left from a previous run", len(self._queue))
            self._queue.clear()

    def end_run(self, reason: str) -> None:
        """Call when the mission run ends early: stopped (the escape hatch --
        see MissionExecutionManager.stop()) or switched to another mission.
        Aborts any in-flight diversion without requeueing it and clears the
        queue -- anomalies not investigated during this run stay DETECTED
        on the map, but no later run will go to them."""
        with self._lock:
            dropped = len(self._queue)
            self._queue.clear()
        if dropped:
            logger.info("Mission run ended (%s); dropped %d queued anomalies", reason, dropped)
        self._abort(reason, requeue=False)

    def abort_if_active(self, reason: str) -> None:
        """Called when the robot disconnects mid-investigation (see
        abort_if_robot_disconnected below). The run is still in progress, so
        an anomaly the operator hadn't resolved yet goes back to DETECTED at
        the front of the queue -- the robot has left it, so it needs
        revisiting before it can be verified -- and is picked up again once
        the robot reconnects (see dispatch_pending)."""
        self._abort(reason, requeue=True)

    def _abort(self, reason: str, *, requeue: bool) -> None:
        with self._lock:
            active = self._active
            if active is None:
                return
            anomaly_id = active.anomaly_id
            phase = active.phase
            self._active = None
            # An anomaly already resolved (RETURNING) has nothing to undo.
            unresolved = phase in (DiversionPhase.OUTBOUND, DiversionPhase.AWAITING_RESOLUTION)
            if unresolved:
                # Status reset under the lock, before it's requeued -- a
                # dispatch_pending() in between would otherwise see it still
                # ROBOT_EN_ROUTE/ARRIVED and drop it as already handled.
                updated = self._anomaly_registry.update_status(anomaly_id, AnomalyStatus.DETECTED)
                if requeue:
                    self._queue.appendleft(anomaly_id)

        if unresolved:
            self._websocket_manager.broadcast_threadsafe(
                {"type": "anomaly.updated", "data": updated.model_dump(mode="json")}
            )

        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.diversion.cleared", "data": {"anomaly_id": anomaly_id, "reason": reason}}
        )
        logger.info("Anomaly %s: diversion aborted (%s)", anomaly_id, reason)
        self._end_diversion()

    def abort_if_robot_disconnected(self) -> None:
        """Call once per DeviceRegistry offline-monitor tick (app.py) --
        cheap no-op unless a diversion is actually active."""
        with self._lock:
            active = self._active
            if active is None:
                return
            robot_device_id = active.robot_device_id

        device = self._device_registry.get(robot_device_id)
        if device is None or not device.connected:
            self.abort_if_active("robot_disconnected")

    def _end_diversion(self, reached_waypoint_index: int | None = None) -> None:
        """A diversion just ended/aborted -- restore normal mission status
        (INVESTIGATING -> RUNNING) and let mission-driven waypoint goals
        resume. `reached_waypoint_index` is the waypoint the return leg just
        arrived at: recorded as reached, so the mission carries on from the
        one after it instead of re-sending the robot to where it already
        is. All steps re-check their own preconditions and no-op harmlessly
        if there's nothing to do (e.g. Stop already moved status past
        INVESTIGATING directly to RETURNING_HOME), so it's always safe to
        call this from every diversion-ending path."""
        self._mission_execution_manager.exit_investigating()
        if reached_waypoint_index is not None:
            self._mission_execution_manager.record_waypoint_reached(reached_waypoint_index)
        if self._mission_drive_coordinator is not None:
            self._mission_drive_coordinator.advance()

    def get_active(self) -> tuple[str, dict] | None:
        """For WebSocket-reconnect resend (api/websocket.py): the last
        broadcast diversion event, if one is in flight."""
        with self._lock:
            active = self._active
            if active is None:
                return None
            if active.phase == DiversionPhase.RETURNING and active.returning_payload is not None:
                return "anomaly.diversion.returning", active.returning_payload
            return "anomaly.diversion.started", active.started_payload
