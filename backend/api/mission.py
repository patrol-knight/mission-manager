from fastapi import APIRouter, HTTPException, Request, Response, status

from core.errors import (
    MissionAlreadyExistsError,
    MissionExecutionLockedError,
    MissionNotFoundError,
    MissionValidationError,
)
from core.map_server import MapServer
from models.mission import Mission, MissionSummary
from models.waypoint import Waypoint

router = APIRouter()


class WaypointGeo(Waypoint):
    """Waypoint plus its lat/lon, computed once server-side (see
    _with_geo below) using MapServer's real lanelet2 projector -- response
    -only, never part of the persisted Mission/Waypoint shape (see
    models/waypoint.py and mission_server.py's YAML persistence), and null
    whenever the map service is unavailable. Lets the frontend's map layers
    render waypoints with no per-marker xy-to-lnglat round trip."""

    lat: float | None = None
    lon: float | None = None


class MissionGeo(Mission):
    waypoints: list[WaypointGeo]


def _with_geo(mission: Mission, map_server: MapServer) -> MissionGeo:
    waypoints = []
    for wp in mission.waypoints:
        lat = lon = None
        if map_server.is_available():
            try:
                latlon = map_server.xy_to_latlon(wp.x, wp.y, mission.frame_id)
                lat, lon = latlon.lat, latlon.lon
            except Exception:
                pass
        waypoints.append(WaypointGeo(**wp.model_dump(), lat=lat, lon=lon))
    return MissionGeo(**mission.model_dump(exclude={"waypoints"}), waypoints=waypoints)


def _broadcast_current_mission(request: Request) -> None:
    current = request.app.state.mission_server.get_current()
    request.app.state.websocket_manager.broadcast_threadsafe(
        {
            "type": "mission.current",
            "data": _with_geo(current, request.app.state.map_server).model_dump(mode="json") if current else None,
        }
    )


@router.get("", response_model=list[MissionSummary])
def list_missions(request: Request) -> list[MissionSummary]:
    return request.app.state.mission_server.list_missions(request.app.state.map_server)


@router.get("/current", response_model=MissionGeo)
def get_current_mission(request: Request) -> MissionGeo:
    mission = request.app.state.mission_server.get_current()
    if mission is None:
        raise HTTPException(status_code=404, detail="No current mission is set")
    return _with_geo(mission, request.app.state.map_server)


@router.get("/default", response_model=MissionGeo)
def get_default_mission(request: Request) -> MissionGeo:
    mission = request.app.state.mission_server.get_default()
    if mission is None:
        raise HTTPException(status_code=404, detail="No default mission is set")
    return _with_geo(mission, request.app.state.map_server)


@router.get("/{mission_id}", response_model=MissionGeo)
def get_mission(mission_id: str, request: Request) -> MissionGeo:
    mission = request.app.state.mission_server.get_mission(mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail=f"Mission not found: {mission_id}")
    return _with_geo(mission, request.app.state.map_server)


@router.post("", response_model=MissionGeo)
def create_mission(mission: Mission, request: Request) -> MissionGeo:
    try:
        created = request.app.state.mission_server.create_mission(mission)
        return _with_geo(created, request.app.state.map_server)
    except MissionAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except MissionValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{mission_id}", response_model=MissionGeo)
def update_mission(mission_id: str, mission: Mission, request: Request) -> MissionGeo:
    try:
        request.app.state.mission_execution_manager.assert_editable(mission_id)
        updated = request.app.state.mission_server.update_mission(mission_id, mission)
        request.app.state.mission_execution_manager.on_edited(mission_id)
        _broadcast_current_mission(request)
        return _with_geo(updated, request.app.state.map_server)
    except MissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except MissionValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except MissionExecutionLockedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{mission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mission(mission_id: str, request: Request) -> Response:
    try:
        request.app.state.mission_execution_manager.assert_editable(mission_id)
        request.app.state.mission_server.delete_mission(mission_id)
        request.app.state.mission_execution_manager.on_deleted(mission_id)
        _broadcast_current_mission(request)
    except MissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except MissionExecutionLockedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # No abort call here, deliberately: assert_editable above already blocks
    # deleting the mission while it's RUNNING/PAUSED/RETURNING_HOME (the only
    # window a diversion can be active in), so a successful delete can only
    # be for a mission that either isn't current or has no diversion possible.
    # Aborting unconditionally here would be a real bug -- it would clear a
    # legitimate diversion on a DIFFERENT, still-running current mission.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{mission_id}/activate", response_model=MissionGeo)
def activate_mission(mission_id: str, request: Request) -> MissionGeo:
    try:
        activated = request.app.state.mission_server.activate(mission_id)
        request.app.state.mission_execution_manager.on_activated(mission_id)
        _broadcast_current_mission(request)
        request.app.state.anomaly_response_coordinator.end_run("mission_switched")
        return _with_geo(activated, request.app.state.map_server)
    except MissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{mission_id}/set-default", response_model=MissionGeo)
def set_default_mission(mission_id: str, request: Request) -> MissionGeo:
    try:
        mission = request.app.state.mission_server.set_default(mission_id)
        return _with_geo(mission, request.app.state.map_server)
    except MissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
