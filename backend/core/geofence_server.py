import json
import logging
import os
import threading
from pathlib import Path

import yaml

from core.errors import MapUnavailableError
from core.map_server import MapServer
from models.geofence import GeofenceFile, GeofencePoint, GeofencePolygon, GeofenceSet, GeofenceZone

logger = logging.getLogger(__name__)


class GeofenceServer:
    """The loaded map's restricted zones, one file per map. Anomaly Detection
    asks for them over Zenoh (ZenohGateway), so saving is all a change needs.

    A map with no file has no zones to give, which is different from an empty
    set: Anomaly Detection then keeps its local zones instead of clearing them."""

    def __init__(self, folder: str, map_name: str | None, map_server: MapServer) -> None:
        self._map_name = map_name
        self._path = Path(folder) / f"{map_name}.yaml" if map_name else None
        self._map = map_server
        self._lock = threading.Lock()
        self._file: GeofenceFile | None = None

    def load(self) -> None:
        if self._path is None or not self._path.exists():
            return
        with open(self._path, encoding="utf-8") as f:
            stored = GeofenceFile(**yaml.safe_load(f))
        if stored.map_name != self._map_name:
            logger.warning("Ignoring %s: its zones are for map %s", self._path, stored.map_name)
            return
        with self._lock:
            self._file = stored

    def zones(self) -> GeofenceSet:
        with self._lock:
            stored = self._file
        if stored is None:
            return GeofenceSet(zones=[])
        return GeofenceSet(zones=[self._to_zone(zone_id, zone) for zone_id, zone in stored.restricted_zones.items()])

    def replace(self, zones: GeofenceSet) -> GeofenceSet:
        """Saves `zones` as the whole set, replacing the file in one step."""
        if self._path is None:
            raise MapUnavailableError("Map service is unavailable: no map to save geofences for")
        stored = GeofenceFile(
            map_name=self._map_name,
            restricted_zones={zone.zone_id: self._to_polygon(zone) for zone in zones.zones},
        )
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self._path.with_suffix(".yaml.tmp")
            with open(temporary, "w", encoding="utf-8") as f:
                yaml.safe_dump(stored.model_dump(mode="json"), f, sort_keys=False, default_flow_style=None)
            os.replace(temporary, self._path)
            self._file = stored
        logger.info("Saved %d geofence(s) for map %s", len(zones.zones), self._map_name)
        return zones

    def wire_payload(self) -> bytes | None:
        """The reply to a geofences/restricted_zones query, None without a file."""
        with self._lock:
            stored = self._file
        if stored is None:
            return None
        return json.dumps(stored.model_dump(mode="json", include={"restricted_zones"})).encode("utf-8")

    def _to_polygon(self, zone: GeofenceZone) -> GeofencePolygon:
        vertices = [self._map.latlon_to_xy(point.lat, point.lon) for point in zone.points]
        return GeofencePolygon(polygon=[(vertex.x, vertex.y) for vertex in vertices])

    def _to_zone(self, zone_id: str, zone: GeofencePolygon) -> GeofenceZone:
        points = [self._map.xy_to_latlon(x, y) for x, y in zone.polygon]
        return GeofenceZone(zone_id=zone_id, points=[GeofencePoint(lat=p.lat, lon=p.lon) for p in points])
