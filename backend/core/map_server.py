import yaml
import math

from lanelet2.io import load, Origin
from lanelet2.core import BasicPoint2d
from lanelet2.projection import UtmProjector
from lanelet2.geometry import inside, findNearest
from lanelet2.routing import RoutingGraph
from lanelet2 import traffic_rules

from pyproj import Proj

EARTH_RADIUS = 6378137.0


class MapServer:
    def __init__(self):
        self._lanelet_map    = None
        self._lanelet_layer  = None
        self._routing_graph  = None
        self._origin_lat     = None
        self._origin_lon     = None
        self._proj           = None
        self._map_bounds     = None

    def load(self, osm_path: str, projector_yaml: str):
        with open(projector_yaml, "r") as f:
            data = yaml.safe_load(f)

        self._origin_lat = data["map_origin"]["latitude"]
        self._origin_lon = data["map_origin"]["longitude"]
        print(f"[MapServer] Origin lat={self._origin_lat}, lon={self._origin_lon}")

        self._proj = Proj(
            proj="tmerc",
            lat_0=self._origin_lat,
            lon_0=self._origin_lon,
            k=0.9996,
            x_0=0.0,
            y_0=0.0,
            datum="WGS84",
            units="m",
        )

        origin    = Origin(self._origin_lat, self._origin_lon)
        projector = UtmProjector(origin)

        self._lanelet_map   = load(osm_path, projector)
        self._lanelet_layer = self._lanelet_map.laneletLayer

        tr = traffic_rules.create(
            traffic_rules.Locations.Germany,
            traffic_rules.Participants.Vehicle,
        )
        self._routing_graph = RoutingGraph(self._lanelet_map, tr)
        print(f"[MapServer] Loaded {len(self._lanelet_layer)} lanelets, routing graph built")

        self._map_bounds = self._compute_bounds()

    def xy_to_latlon(self, x: float, y: float) -> tuple[float, float]:
        if self._proj is not None:
            lon, lat = self._proj(x, y, inverse=True)
            return lat, lon
        lat0_rad = math.radians(self._origin_lat)
        lat = self._origin_lat + math.degrees(y / EARTH_RADIUS)
        lon = self._origin_lon + math.degrees(x / (EARTH_RADIUS * math.cos(lat0_rad)))
        return lat, lon

    def latlon_to_xy(self, lat: float, lon: float) -> tuple[float, float]:
        if self._proj is not None:
            x, y = self._proj(lon, lat)
            return x, y
        lat0_rad = math.radians(self._origin_lat)
        x = math.radians(lon - self._origin_lon) * EARTH_RADIUS * math.cos(lat0_rad)
        y = math.radians(lat - self._origin_lat) * EARTH_RADIUS
        return x, y

    def _to_latlon(self, x, y):
        lat, lon = self.xy_to_latlon(x, y)
        return [lon, lat]

    def _compute_bounds(self):
        min_lat = min_lon =  1e18
        max_lat = max_lon = -1e18
        for ll in self._lanelet_layer:
            for bound in (ll.leftBound, ll.rightBound):
                for p in bound:
                    lat, lon = self.xy_to_latlon(p.x, p.y)
                    if lat < min_lat: min_lat = lat
                    if lat > max_lat: max_lat = lat
                    if lon < min_lon: min_lon = lon
                    if lon > max_lon: max_lon = lon
        return [[min_lon, min_lat], [max_lon, max_lat]]

    def get_bounds(self):
        return self._map_bounds

    def get_origin(self):
        return {"lat": self._origin_lat, "lon": self._origin_lon}

    def get_json(self):
        features = []
        for ll in self._lanelet_layer:
            left   = [self._to_latlon(p.x, p.y) for p in ll.leftBound]
            right  = [self._to_latlon(p.x, p.y) for p in ll.rightBound]
            center = [self._to_latlon(p.x, p.y) for p in ll.centerline]
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": left},   "properties": {"type": "left"}})
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": right},  "properties": {"type": "right"}})
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": center}, "properties": {"type": "center"}})
        return {"type": "FeatureCollection", "features": features}

    def is_in_lanelet(self, x: float, y: float) -> bool:
        point   = BasicPoint2d(x, y)
        nearest = findNearest(self._lanelet_layer, point, 1)
        if not nearest:
            return False
        return inside(nearest[0][1], point)

    def _nearest_lanelet(self, x: float, y: float):
        point   = BasicPoint2d(x, y)
        nearest = findNearest(self._lanelet_layer, point, 1)
        return nearest[0][1] if nearest else None

    def _closest_centerline_index(self, ll, x: float, y: float) -> int:
        best_i, best_d = 0, float("inf")
        for i, p in enumerate(ll.centerline):
            d = (p.x - x) ** 2 + (p.y - y) ** 2
            if d < best_d:
                best_d, best_i = d, i
        return best_i

    def _project_point_onto_centerline(self, ll, x: float, y: float) -> float:
        """Return fractional arc-length [0,1] of (x,y) projected onto ll's centerline."""
        pts = list(ll.centerline)
        if len(pts) < 2:
            return 0.0
        arc = [0.0]
        for i in range(1, len(pts)):
            dx = pts[i].x - pts[i-1].x
            dy = pts[i].y - pts[i-1].y
            arc.append(arc[-1] + math.sqrt(dx*dx + dy*dy))
        total = arc[-1]
        if total == 0:
            return 0.0
        best_t = 0.0
        best_d = float("inf")
        for i in range(len(pts) - 1):
            ax, ay = pts[i].x, pts[i].y
            bx, by = pts[i+1].x, pts[i+1].y
            dx, dy = bx - ax, by - ay
            seg_len_sq = dx*dx + dy*dy
            t_seg = max(0.0, min(1.0, ((x-ax)*dx + (y-ay)*dy) / seg_len_sq)) if seg_len_sq > 0 else 0.0
            px = ax + t_seg * dx
            py = ay + t_seg * dy
            d = math.sqrt((x-px)**2 + (y-py)**2)
            if d < best_d:
                best_d = d
                best_t = (arc[i] + t_seg * (arc[i+1] - arc[i])) / total
        return best_t

    def _interp_centerline_at(self, pts, arc, total, t: float):
        """Interpolate [lon, lat] at fractional arc-length t on a centerline."""
        s = t * total
        for i in range(len(pts) - 1):
            if arc[i] <= s <= arc[i+1]:
                seg_len = arc[i+1] - arc[i]
                alpha = (s - arc[i]) / seg_len if seg_len > 0 else 0.0
                x = pts[i].x + alpha * (pts[i+1].x - pts[i].x)
                y = pts[i].y + alpha * (pts[i+1].y - pts[i].y)
                return self._to_latlon(x, y)
        return self._to_latlon(pts[-1].x, pts[-1].y)

    def _sample_centerline_from(self, ll, t_start: float) -> list:
        """Sample from t_start to end of centerline. Includes interpolated start point."""
        pts = list(ll.centerline)
        if len(pts) < 2:
            return []
        arc = [0.0]
        for i in range(1, len(pts)):
            dx = pts[i].x - pts[i-1].x
            dy = pts[i].y - pts[i-1].y
            arc.append(arc[-1] + math.sqrt(dx*dx + dy*dy))
        total = arc[-1]
        if total == 0:
            return [self._to_latlon(pts[0].x, pts[0].y)]
        result = [self._interp_centerline_at(pts, arc, total, t_start)]
        for i, a in enumerate(arc[1:], start=1):
            if a / total > t_start + 1e-9:
                result.append(self._to_latlon(pts[i].x, pts[i].y))
        return result

    def _sample_centerline_to(self, ll, t_end: float) -> list:
        """Sample from start to t_end of centerline. Includes interpolated end point."""
        pts = list(ll.centerline)
        if len(pts) < 2:
            return []
        arc = [0.0]
        for i in range(1, len(pts)):
            dx = pts[i].x - pts[i-1].x
            dy = pts[i].y - pts[i-1].y
            arc.append(arc[-1] + math.sqrt(dx*dx + dy*dy))
        total = arc[-1]
        if total == 0:
            return [self._to_latlon(pts[0].x, pts[0].y)]
        result = [self._to_latlon(pts[0].x, pts[0].y)]
        for i, a in enumerate(arc[1:], start=1):
            if a / total < t_end - 1e-9:
                result.append(self._to_latlon(pts[i].x, pts[i].y))
        result.append(self._interp_centerline_at(pts, arc, total, t_end))
        return result

    def get_route(self, waypoints: list[dict]) -> dict | None:
        if len(waypoints) < 2:
            return None

        full_coords = []

        for seg in range(len(waypoints) - 1):
            wx0, wy0 = waypoints[seg]["x"],   waypoints[seg]["y"]
            wx1, wy1 = waypoints[seg+1]["x"], waypoints[seg+1]["y"]

            start_ll = self._nearest_lanelet(wx0, wy0)
            end_ll   = self._nearest_lanelet(wx1, wy1)
            if start_ll is None or end_ll is None:
                return None

            t0 = self._project_point_onto_centerline(start_ll, wx0, wy0)
            t1 = self._project_point_onto_centerline(end_ll,   wx1, wy1)

            route = self._routing_graph.getRoute(start_ll, end_ll, 0)
            if route is None:
                return None
            path = route.shortestPath()
            if path is None:
                return None
            ll_sequence = list(path)

            coords = []
            for i, ll in enumerate(ll_sequence):
                if i == 0 and i == len(ll_sequence) - 1:
                    seg_coords = self._sample_centerline_from(ll, t0)
                    coords.extend(seg_coords[:-1])
                    coords.extend(self._sample_centerline_to(ll, t1))
                elif i == 0:
                    seg_coords = self._sample_centerline_from(ll, t0)
                    coords.extend(seg_coords[:-1])
                elif i == len(ll_sequence) - 1:
                    coords.extend(self._sample_centerline_to(ll, t1))
                else:
                    pts = list(ll.centerline)
                    coords.extend(self._to_latlon(p.x, p.y) for p in pts[:-1])

            if full_coords and coords:
                coords = coords[1:]

            full_coords.extend(coords)

        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": full_coords},
            "properties": {"type": "route"},
        }
