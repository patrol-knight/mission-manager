from fastapi import APIRouter, Depends

from api.deps import get_services
from bootstrap import Services
from models.map import (
    LatLon,
    LatLonQuery,
    MapInfo,
    MapPoint,
    PointQuery,
    ProjectReachableGoalRequest,
    ReachableGoal,
    RoutePreviewRequest,
    XY,
)

router = APIRouter()


@router.get("/info", response_model=MapInfo)
def get_info(services: Services = Depends(get_services)) -> MapInfo:
    return services.map_server.get_info()


@router.get("/geojson")
def get_geojson(services: Services = Depends(get_services)) -> dict:
    return services.map_server.get_geojson()


@router.get("/bounds")
def get_bounds(services: Services = Depends(get_services)) -> dict:
    return {"bounds": services.map_server.get_bounds()}


@router.post("/is-in-lanelet")
def is_in_lanelet(query: PointQuery, services: Services = Depends(get_services)) -> dict:
    result = services.map_server.is_in_lanelet(query.x, query.y, query.frame_id)
    return {"in_lanelet": result}


@router.post("/snap-waypoint", response_model=MapPoint)
def snap_waypoint(query: PointQuery, services: Services = Depends(get_services)) -> MapPoint:
    return services.map_server.snap_to_lanelet(query.x, query.y, query.frame_id)


@router.post("/place-waypoint", response_model=MapPoint | None)
def place_waypoint(query: LatLonQuery, services: Services = Depends(get_services)) -> MapPoint | None:
    return services.map_server.place_waypoint(query.lat, query.lon)


@router.post("/project-reachable-goal", response_model=ReachableGoal)
def project_reachable_goal(
    req: ProjectReachableGoalRequest, services: Services = Depends(get_services)
) -> ReachableGoal:
    return services.map_server.project_reachable_goal(req.x, req.y, req.frame_id)


@router.post("/route-preview")
def route_preview(req: RoutePreviewRequest, services: Services = Depends(get_services)) -> dict:
    route = services.map_server.get_route_preview(req.waypoints)
    return {"ok": route is not None, "route": route}


@router.post("/xy-to-lnglat", response_model=LatLon)
def xy_to_lnglat(query: PointQuery, services: Services = Depends(get_services)) -> LatLon:
    return services.map_server.xy_to_latlon(query.x, query.y, query.frame_id)


@router.post("/lnglat-to-xy", response_model=XY)
def lnglat_to_xy(query: LatLonQuery, services: Services = Depends(get_services)) -> XY:
    return services.map_server.latlon_to_xy(query.lat, query.lon, query.frame_id)
