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


class ReachableGoal(BaseModel):
    x: float
    y: float
    frame_id: str = "map"
    reachable: bool


class PointQuery(BaseModel):
    x: float
    y: float
    frame_id: str = "map"


class LatLonQuery(BaseModel):
    lat: float
    lon: float
    frame_id: str = "map"


class ProjectReachableGoalRequest(BaseModel):
    x: float
    y: float
    frame_id: str = "map"


class RouteWaypoint(BaseModel):
    x: float
    y: float
    yaw: float | None = None
    frame_id: str = "map"


class RoutePreviewRequest(BaseModel):
    waypoints: list[RouteWaypoint] = Field(min_length=2)
