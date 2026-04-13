from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.bridge_node import BridgeNode
from core.map_server import MapServer

router     = APIRouter()
map_server: MapServer = None
bridge_node: BridgeNode = None


def init(server, bridge=None):
    global map_server, bridge_node
    map_server  = server
    bridge_node = bridge


class Waypoint(BaseModel):
    x: float
    y: float


class WaypointWithYaw(BaseModel):
    x:   float
    y:   float
    yaw: float = 0.0


class RouteRequest(BaseModel):
    waypoints: list[Waypoint]


class WaypointPublishRequest(BaseModel):
    waypoints: list[WaypointWithYaw]


class LngLatPoint(BaseModel):
    lng: float
    lat: float


@router.get("/map")
def get_map():
    return map_server.get_json()


@router.get("/map/origin")
def get_origin():
    return map_server.get_origin()


@router.get("/map/bounds")
def get_bounds():
    bounds = map_server.get_bounds()
    if bounds is None:
        raise HTTPException(status_code=503, detail="Map not loaded yet")
    return {"bounds": bounds}


@router.post("/map/project/to_xy")
def project_to_xy(pt: LngLatPoint):
    x, y = map_server.latlon_to_xy(pt.lat, pt.lng)
    return {"x": x, "y": y}


@router.post("/map/project/to_lnglat")
def project_to_lnglat(wp: Waypoint):
    lat, lon = map_server.xy_to_latlon(wp.x, wp.y)
    return {"lng": lon, "lat": lat}


@router.post("/map/validate")
def validate(wp: Waypoint):
    return {"valid": map_server.is_in_lanelet(wp.x, wp.y)}


@router.post("/map/route")
def get_route(req: RouteRequest):
    wps    = [{"x": w.x, "y": w.y} for w in req.waypoints]
    result = map_server.get_route(wps)
    if result is None:
        return {"ok": False, "route": None}
    return {"ok": True, "route": result}


@router.post("/map/waypoints/publish")
def publish_waypoints(req: WaypointPublishRequest):
    if bridge_node is None:
        raise HTTPException(status_code=503, detail="ROS2 bridge not ready")

    wps = [{"x": w.x, "y": w.y, "yaw": w.yaw} for w in req.waypoints]
    bridge_node.publish_waypoints(wps)
    return {"ok": True, "count": len(wps)}
