from pydantic import Field

from models.base import WireModel


class MapInfo(WireModel):
    map_name: str
    frame_id: str = "map"
    origin_lat: float
    origin_lon: float
    lanelet_count: int


class LatLon(WireModel):
    lat: float
    lon: float


class XY(WireModel):
    x: float
    y: float
    frame_id: str = "map"


class MapPoint(WireModel):
    x: float
    y: float
    frame_id: str = "map"
    lanelet_id: int | None = None
    # Computed alongside x/y by MapServer.snap_to_lanelet() itself (single
    # computation point) -- lets consumers like InvestigationState.target
    # reach the frontend with lat/lon already attached, no separate
    # xy-to-lnglat round trip needed to render it.
    lat: float | None = None
    lon: float | None = None


class PointQuery(WireModel):
    x: float
    y: float
    frame_id: str = "map"


class LatLonQuery(WireModel):
    lat: float
    lon: float
    frame_id: str = "map"


class RouteWaypoint(WireModel):
    x: float
    y: float
    yaw: float | None = None
    frame_id: str = "map"


class RoutePreviewRequest(WireModel):
    waypoints: list[RouteWaypoint] = Field(min_length=2)
