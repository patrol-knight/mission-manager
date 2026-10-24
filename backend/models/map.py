from pydantic import BaseModel, Field


class MapInfo(BaseModel):
    map_name: str
    frame_id: str = "map"
    origin_lat: float
    origin_lon: float
    lanelet_count: int


class LatLon(BaseModel):
    lat: float
    lon: float


class XY(BaseModel):
    x: float
    y: float
    frame_id: str = "map"


class MapPoint(BaseModel):
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


class PointQuery(BaseModel):
    x: float
    y: float
    frame_id: str = "map"


class LatLonQuery(BaseModel):
    lat: float
    lon: float
    frame_id: str = "map"


class RouteWaypoint(BaseModel):
    x: float
    y: float
    yaw: float | None = None
    frame_id: str = "map"


class RoutePreviewRequest(BaseModel):
    waypoints: list[RouteWaypoint] = Field(min_length=2)
