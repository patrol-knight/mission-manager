from typing import Literal

from pydantic import Field, field_validator

from models.base import WireModel


class GeofencePolygon(WireModel):
    """One zone as stored and sent to Anomaly Detection: map-frame vertices."""

    frame_id: Literal["map"] = "map"
    polygon: list[tuple[float, float]] = Field(min_length=3)


class GeofenceFile(WireModel):
    """storage/geofences/{map_name}.yaml."""

    map_name: str
    restricted_zones: dict[str, GeofencePolygon]


class GeofencePoint(WireModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class GeofenceZone(WireModel):
    """One zone as the map editor sees it."""

    zone_id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    points: list[GeofencePoint] = Field(min_length=3)


class GeofenceSet(WireModel):
    """Every zone of the loaded map. Empty means no restricted zones."""

    zones: list[GeofenceZone]

    @field_validator("zones")
    @classmethod
    def _check_unique_ids(cls, zones: list[GeofenceZone]) -> list[GeofenceZone]:
        ids = [zone.zone_id for zone in zones]
        if len(set(ids)) != len(ids):
            raise ValueError("zone_id values must be unique")
        return zones
