from fastapi import APIRouter, Depends

from api.deps import get_services
from bootstrap import Services
from models.map import (
    LatLon,
    LatLonQuery,
    MapPoint,
    PointQuery,
    RoutePreviewRequest,
)

router = APIRouter()


@router.get("/geojson")
def get_geojson(services: Services = Depends(get_services)) -> dict:
    return services.map_server.get_geojson()


@router.get("/bounds")
def get_bounds(services: Services = Depends(get_services)) -> dict:
    return {"bounds": services.map_server.get_bounds()}


@router.post("/place-waypoint", response_model=MapPoint | None)
def place_waypoint(query: LatLonQuery, services: Services = Depends(get_services)) -> MapPoint | None:
    return services.map_server.place_waypoint(query.lat, query.lon)


@router.post("/route-preview")
def route_preview(req: RoutePreviewRequest, services: Services = Depends(get_services)) -> dict:
    route = services.map_server.get_route_preview(req.waypoints)
    return {"ok": route is not None, "route": route}


@router.post("/xy-to-lnglat", response_model=LatLon)
def xy_to_lnglat(query: PointQuery, services: Services = Depends(get_services)) -> LatLon:
    return services.map_server.xy_to_latlon(query.x, query.y, query.frame_id)
