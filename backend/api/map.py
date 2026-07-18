from fastapi import APIRouter, HTTPException, Request

from core.errors import MapUnavailableError
from models.map import (
    MapInfo,
    MapPoint,
    PointQuery,
    ProjectReachableGoalRequest,
    ReachableGoal,
    RoutePreviewRequest,
)

router = APIRouter()


def _map_server(request: Request):
    return request.app.state.map_server


def _unavailable(exc: MapUnavailableError) -> HTTPException:
    return HTTPException(status_code=503, detail=str(exc))


@router.get("/info", response_model=MapInfo)
def get_info(request: Request) -> MapInfo:
    try:
        return _map_server(request).get_info()
    except MapUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.get("/geojson")
def get_geojson(request: Request) -> dict:
    try:
        return _map_server(request).get_geojson()
    except MapUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.get("/bounds")
def get_bounds(request: Request) -> dict:
    try:
        return {"bounds": _map_server(request).get_bounds()}
    except MapUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.post("/is-in-lanelet")
def is_in_lanelet(query: PointQuery, request: Request) -> dict:
    try:
        result = _map_server(request).is_in_lanelet(query.x, query.y, query.frame_id)
        return {"in_lanelet": result}
    except MapUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.post("/snap-waypoint", response_model=MapPoint)
def snap_waypoint(query: PointQuery, request: Request) -> MapPoint:
    try:
        return _map_server(request).snap_to_lanelet(query.x, query.y, query.frame_id)
    except MapUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.post("/project-reachable-goal", response_model=ReachableGoal)
def project_reachable_goal(
    req: ProjectReachableGoalRequest, request: Request
) -> ReachableGoal:
    try:
        return _map_server(request).project_reachable_goal(
            req.x, req.y, req.frame_id
        )
    except MapUnavailableError as exc:
        raise _unavailable(exc) from exc


@router.post("/route-preview")
def route_preview(req: RoutePreviewRequest, request: Request) -> dict:
    try:
        route = _map_server(request).get_route_preview(req.waypoints)
        return {"ok": route is not None, "route": route}
    except MapUnavailableError as exc:
        raise _unavailable(exc) from exc
