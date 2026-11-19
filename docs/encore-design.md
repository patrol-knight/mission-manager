# FVD Encore: where the robot stops, Explore and dwell

Status (2026-11-19, `feat/encore`):

| | Feature | State | Issue |
|---|---|---|---|
| R0 | **Where the robot stops**, and arriving when an obstacle stops it short | Blocked arrival done; stop selection **reverted to the nearest lanelet point**, to be discussed | #__ |
| R1 | **Explore** (Go here): the operator sends the robot to look at a point; it holds until dismissed | Works end to end; preview mode in progress; UI to be reworked | #__ |
| R2 | **Dwell**: each mission waypoint can hold the robot for a set time | Done | #__ |

The triple camera, camera health and lost-track interfaces are in the tracking issue; they get their own doc when we implement them.

## Background

Goals go to the robot one at a time as a single pose (`navigate_to_goal`). Autoware plans the path to it on the same Lanelet2 map, so the route Mission Manager draws is a preview of the shortest path, not a path the robot is told to follow. state_machine reports success once the route is `ARRIVED` and the wheels have stopped, and stays `arrived` until the next goal, a cancel or a takeover. While the LiDAR sees an obstacle on the route it reports `blocked`, and its 10 s `not_moving` timer is paused, so a blocked goal never fails on its own.

All three features work within that: they choose which goal to send, and when.

---

## R0: where the robot stops

### Problems

| # | Problem | State |
|---|---|---|
| 1 | **The goal is on the anomaly.** The goal is the nearest lanelet point to the anomaly. A person lying on the lane is an obstacle right at the goal: the robot stops short, reports `blocked`, never arrives, and the verify window never opens | Open (the blocked arrival below catches it) |
| 2 | **Blocked never fails.** `not_moving` is paused while `blocked`, so the investigation stays EN_ROUTE indefinitely | **Fixed** by blocked arrival |
| 3 | **Detours.** Lanelets are directed. When the nearest lane runs away from the robot, it may loop around a block, while the opposite lane a few metres away is reachable directly | Open |
| 4 | **Wrong goal heading.** The yaw is `lane_yaw(x, y)`, the nearest lanelet's direction; next to an opposite lane the goal can face against its own lane | Open |

### Done: arrive when blocked close to the goal

While an investigation (anomaly or Explore) is EN_ROUTE, if the robot reports `blocked` **within 4 m of the target for 5 s**, it counts as arrived:

1. Send `cancel_navigation` (the robot holds where it stopped)
2. Phase becomes ON_SITE, `arrived_at` is set, the verify / observe window opens as on a normal arrival

- Checked on every robot state sample, changed or not: a robot standing blocked only repeats itself, and the registry reports no change then. The 5 s window restarts whenever the robot isn't blocked or is farther than 4 m
- The cancel's result is ignored: `classify` maps a cancelled goal to IGNORE, and once ON_SITE the coordinator ignores results for the old request anyway, so it can't trigger `on_goal_failed`
- Blocked farther than 4 m: unchanged, the operator decides
- Config: `arrive_blocked_within_m` (4.0), `arrive_blocked_after_sec` (5.0)
- Checked on the dummy robot: blocked 2.9 m short → on site after 5 s; blocked 5.5 m short for 7 s → still en route

### Stop selection: reverted, to be discussed

The goal is back to what it was before the Encore: the subject snapped onto its nearest lanelet (`snap_to_lanelet`), heading `lane_yaw` there, route from the robot (`get_route`). It is used for anomalies and Explore alike.

What was tried and taken out (2026-11-18/19), for the discussion:

- **Stand-off**: when the subject is within 1.5 m of the lane, pull the goal back 2 m along the route, so the subject isn't an obstacle at the goal (problem 1), with the heading taken from the route (problem 4)
- **Candidates**: every lanelet within 6 m of the subject, cheapest by route length + 2 × distance left to the subject (problem 3). On the KS map this replaced a 60 m loop with a 2.8 m stop on the robot's own lane

### Tests

- Blocked within 4 m for 5 s: ON_SITE, `cancel_navigation` sent, no goal-failed callback; for 4.9 s, or 5 m away, or cleared in between: still EN_ROUTE

---

## R1: Explore

Explore (Go here in the backend: `kind = manual`, `/api/investigation/goto`) is another way into investigate mode, not a new state. The operator picks a point to look at; the robot goes, holds there, and returns to the mission when dismissed.

### Behaviour

It follows the anomaly flow step for step: a card for the thing picked, then a card for the thing in progress.

| | Anomaly | Explore |
|---|---|---|
| Start | Click an anomaly marker | **Explore** on the map, then click a point |
| Picked | Anomaly card: [Investigate] [Cancel] | **Explore** card: Distance, ETA; [Investigate] [Cancel] |
| In progress | Investigate card · En route / On site | **Explore** card · En route / On site |
| On site | Verify window opens; Verify, Submit | Observe window opens; Observe, Back to route (Done without a mission) |

- The click is where to **look**; the robot stops at the nearest lanelet point (see R0), so the click may be off the lanes. Another click moves the point.
- A new point picked during Explore shows a new Explore card in the selection slot; Investigate retargets the robot.
- A point whose stop is where the robot already is (route under 0.5 m) starts on site.
- No keyboard shortcuts for now.

### UI

**Entry: the map's controls, bottom left.** Explore sits where Overview was, and Overview (which only appears once the view has moved) sits to its right, in the same pill style. Picking a point is done on the map, so its control is on the map; RobotCard stays a status card and can't be mis-clicked into it. While picking, the button itself becomes the hint: a yellow-bordered pill "● Click where to explore | Cancel".

**Map: previewed like a navigation app.** While a point is previewed:

- The route there in the investigation yellow at half strength, from the robot to the stop, trimmed to what lies ahead of the robot as it moves; re-previewed if the robot drives more than 5 m meanwhile (a running mission)
- The point as a hollow yellow ring, the stop as a small yellow dot, and a dotted yellow sight line between them: "stops here, looks there"
- The mission's orange route and waypoints dimmed (25–30 %): still there, no longer the path that matters
- If the preview runs off the screen, the view eases out to show it (never in)

After Investigate, exactly as for an anomaly: the preview route becomes the solid yellow route, the mission hides, the stop becomes the investigation's pulsing target. The ring and the sight line stay until Explore ends. Cancel removes the preview and brings the mission back.

**Cards: only what the operator acts on.** Distance and ETA (ETA = route length at `patrol_speed_mps` plus one `waypoint_stop_sec`, the same model as the mission ETA). En route, both are live: distance from the route left ahead of the robot, ETA counting down from the estimate. On site, Arrived. No map coordinates, no "stops 6 m short", no notes about the mission: an anomaly investigation pauses the mission too, without saying so on its card. A point that can't be reached says so and disables Investigate.

```
┌ Explore ─────────────────── En route ┐
│ Distance        23 m                 │
│ ETA             <1 min               │
│ [ Cancel ]                           │
└──────────────────────────────────────┘
```

**Layout.** The Explore pick card and a selected anomaly share one slot (picking clears the selection and vice versa); the Explore card in progress and an investigation share the other, so the top band never holds more than the folded mission strip and two cards.

### Priority

| Active when Explore is sent | Result |
|---|---|
| Nothing, or a mission | The mission yields and folds, as for an investigation |
| Anomaly investigation, EN_ROUTE | Abandoned, nothing recorded, anomaly stays on the map |
| Anomaly investigation, ON_SITE with a draft verdict | Verdict committed, then Explore starts |
| Anomaly investigation, ON_SITE without a verdict | Abandoned, nothing recorded, anomaly stays on the map |
| Explore | Next point: retarget |

| During Explore | Result |
|---|---|
| Operator clicks Investigate on an anomaly | Allowed; Explore ends, the investigation starts |
| Mission commands | 409, as during an investigation |
| Mission drive, monitor | Never send a goal; a lost robot aborts Explore as it aborts an investigation |
| Goal failure | Same as an investigation (`on_goal_failed`: pause or abort) |

### State

```python
class InvestigationKind(str, Enum):
    ANOMALY = "anomaly"
    MANUAL = "manual"

class InvestigationState(WireModel):
    kind: InvestigationKind = InvestigationKind.ANOMALY
    anomaly_id: str | None            # None exactly when MANUAL
    look_at: MapPoint                 # the subject: the anomaly, or the clicked point
    target: MapPoint                  # where the robot stops: look_at's nearest lanelet point (R0)
    target_yaw: float | None          # the lane's heading there
    eta_sec: float | None             # route length at patrol_speed_mps, plus one waypoint_stop_sec
    # unchanged: robot_device_id, phase, route, draft_verdict (always None for MANUAL), started_at, arrived_at
```

### API

| Route | Change |
|---|---|
| `POST /api/investigation/goto/preview {lat, lon}` | New: where Explore would send the robot (stop, route, length, ETA); sends nothing |
| `POST /api/investigation/goto {lat, lon}` | New: start Explore, or retarget it. 409 if the robot isn't available or there is no route |
| `POST /api/investigation/cancel` | MANUAL: allowed in either phase (Cancel and Dismiss). ANOMALY: unchanged |
| `POST /api/investigation/finish` | MANUAL: same as cancel. ANOMALY: unchanged |
| `PUT /api/investigation/verdict` | MANUAL: 409 |
| `POST /api/investigation` | During MANUAL: allowed, takes over |

### Backend

| File | Change |
|---|---|
| `models/investigation.py` | `InvestigationKind`, `kind`, optional `anomaly_id`, `look_at`, `target_yaw`, `eta_sec`, validator; `GoToRequest`, `GoToPreview` |
| `core/investigation.py` | `go_to()`, `preview_go_to()`; `start()` takes over from MANUAL; `_end()` skips verdict, `set_target` and `_commit` for MANUAL; blocked arrival (`on_device_state`) |
| `transport/zenoh_gateway.py` | Every robot state sample reaches the investigation, changed or not |
| `api/investigation.py` | `goto`, `goto/preview` |

### Frontend

| File | Change |
|---|---|
| `investigationTypes.ts` | `kind`, nullable `anomalyId`, `lookAt`, `etaSec`; `needsVerdict` only for anomalies; `ExplorePreview` |
| `investigationStore.ts` | `picking`, `picked` (the point and its preview); shares the selection slot with `selectedAnomalyId` |
| `MapWorkspace.tsx` | `controls`: shown bottom left before Overview |
| `CurrentMissionRouteLayer.tsx`, `MissionWaypointMarkersLayer.tsx` | Dimmed while a point is previewed (`selectPreviewing`) |
| `ExploreButton.tsx` (new) | Explore among the map's controls; the picking hint and Cancel |
| `ExploreLayer.tsx` (new) | Picking clicks → preview; preview route, ring, stop, sight line; view fit |
| `ExploreCards.tsx` (new) | The pick card (selection slot) and the card in progress (investigation slot) |
| `VerifyModal.tsx` | MANUAL: the observe window -- robot camera plus towers that see the point, no verdict |
| `InvestigationNotifier.tsx` | Arrival toast and auto-open for MANUAL |
| `robotStatus.ts` | MANUAL like an investigation: En route / On site |

---

## R2: dwell

### Behaviour

Each mission waypoint has `dwell_sec` (default 0). On arrival the robot holds that long, then heads to the next waypoint. There is no way to end a dwell early: a mission is a fixed, periodic plan, and Explore covers anything ad hoc. Running missions can't be edited (`assert_editable`), which keeps this consistent.

No robot-side change: state_machine stays `arrived` after a goal, and `not_moving` only times an active goal.

### Model

```python
class Waypoint(WireModel):
    dwell_sec: float = Field(default=0.0, ge=0.0, le=600.0)   # old mission files load with 0

class MissionExecutionState(WireModel):
    dwell_remaining_sec: float | None = None                   # set while holding at current_waypoint_index
    dwell_sec: float | None = None                             # that waypoint's full dwell, for the ring
```

The manager keeps the deadline privately on `time.monotonic()` and fills `dwell_remaining_sec` when it broadcasts. The browser counts down from the value it received; no absolute time crosses the wire (the browser's clock isn't synced with the lab machine).

### Mechanism

`MissionDriveCoordinator.advance()` stays safe to call at any time; it gains one precondition.

1. ARRIVED → `record_waypoint_reached(i)`. If the mission continues and waypoint *i* has `dwell_sec > 0`, the manager sets the deadline.
2. `advance()` returns while dwelling and schedules a token-guarded wake-up at the deadline (like `_timeout_then_retry`).
3. The wake-up clears the deadline and calls `advance()`, which sends waypoint *i + 1*.

| Case | Result |
|---|---|
| Pause while dwelling | Remaining time frozen into `dwell_remaining_sec` |
| Resume after pausing while dwelling | Continue the dwell, **without `rejoin()`** (below) |
| Investigation or Go here takes the robot | Dwell dropped; no dwell on return unless the join target has one |
| Cancel, robot lost, mission switched | Dwell dropped |
| Arrival while joining | Dwells if the waypoint has one |
| Arrival at waypoint 1 that completes the mission | No dwell |
| Arrival at waypoint 1 on a non-final loop | Loop counted, then dwell |

**Why Resume must not rejoin while dwelling.** A robot standing on waypoint *i* counts as on the leg into *i* (`leg_at`), so `rejoin()` would pick *i*, send a goal to where the robot already is, and the arrival would start the full dwell again.

### UI

**Editor (mauve).** Rows stay as they are; a waypoint with a dwell shows it right-aligned and muted. The selected row expands with a dwell stepper styled like the Loops stepper (±5 s). The route summary adds the total dwell per loop. Map markers are unchanged.

```
Waypoints                                    4
 ① 12.40, −3.10
 ② 18.02,  4.55                           30 s
┌───────────────────────────────────────────────┐
│ ③ 25.71,  9.88                       Remove  │
│    Dwell   [ − ]  30  [ + ] s                │
└───────────────────────────────────────────────┘
 ④ 31.20, 15.03

 Route OK · 86 m per loop · 1 min 30 s dwell
```

**Monitor: the robot's status pill counts down.** Dwelling is something the robot does, so it shows where the robot's state is: the RobotCard pill (and the inspector's) reads "Dwell 0:18" instead of "Patrolling". Pills use tabular figures, so the pill keeps its width as it counts. Paused, the robot pill reads "Holding" as for any paused mission. Map markers are unchanged.

**Statuses stay simple.**

- The mission pill keeps the mission's own states only: Not ready, Ready, Running, Paused.
- The robot pill has no live dot (whether the robot is up is the connection pill's job).
- Go here is another way into investigate mode, not a new state: its pill reads En route / On site like an anomaly investigation.

### Tests

- Mission with dwell waypoints: each next goal is sent only after the dwell
- Every row of the table above, especially pause and resume while dwelling (no extra goal, remaining time kept)
- Old mission YAML without `dwell_sec` loads with 0

---

## Next (2026-11-20)

**R1 Explore UI.** Works end to end, but doesn't look right yet:

- The Explore card looks plain next to the anomaly and investigation cards
- The point ring, stop dot and sight line read as unclear, not intuitive
- Keep the direction (preview, then Investigate); try the translucent preview route on the map and rework the card and markers around it
- Once Explore looks right, the same preview could apply when an anomaly is selected (it has no route until Investigate today)

**R0.** Discuss stop selection again (stand-off, candidates, heading) before bringing anything back.

**Naming.** The UI says Explore; the backend still says Go here (`kind = manual`, `/api/investigation/goto`). Rename together later if wanted (changes the API path).

**Then.** The tracking issue's camera work: `CameraHealth.msg`, zenoh_bridge `status.camera`, `camera_blind` and lost tracks in Mission Manager, the three-camera tiles.

## Decisions

- Blocked arrival within 4 m for 5 s; to be checked on the real robot
- Stop selection: the nearest lanelet point, for now
- Explore follows investigation logic end to end (`kind = manual`); Cancel/Dismiss return to the mission, or hold without one
- Explore uses the investigate yellow; entry among the map's controls, bottom left, Overview beside it; no keyboard shortcuts yet
- Robot pill: En route / On site for both kinds; no live dot; "Dwell 0:18" while dwelling
- Mission pill: its own four states only
- No early end to a dwell; markers are not changed for dwell; the next waypoint pulses only once its goal is sent
- Mission ETA: route length at 0.7 m/s, 5 s per waypoint, plus dwells (`patrol_speed_mps`, `waypoint_stop_sec`)
