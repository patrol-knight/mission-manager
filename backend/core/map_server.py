import logging
import math
from functools import lru_cache
from pathlib import Path

import yaml

from core.errors import MapUnavailableError
from models.map import LatLon, MapInfo, MapPoint, ReachableGoal, RouteWaypoint, XY

logger = logging.getLogger(__name__)

try:
    from lanelet2.core import BasicPoint2d, BasicPoint3d, GPSPoint
    from lanelet2.geometry import findNearest, inside
    from lanelet2.io import Origin
    from lanelet2.io import load as ll2_load
    from lanelet2.projection import LocalCartesianProjector
    from lanelet2.routing import RoutingGraph
    from lanelet2 import traffic_rules

    _LANELET2_AVAILABLE = True
except ImportError:
    _LANELET2_AVAILABLE = False


class MapServer:
    def __init__(self) -> None:
        self._available     = False
        self._map_name       = None
        self._lanelet_map    = None
        self._lanelet_layer  = None
        self._routing_graph  = None
        self._origin_lat     = None
        self._origin_lon     = None
        self._projector      = None
        self._map_bounds     = None
        self._geojson        = None

    def is_available(self) -> bool:
        return self._available

    def _ensure_available(self) -> None:
        if not self._available:
            raise MapUnavailableError(
                "Map service is unavailable: map files or Lanelet2 dependency not loaded"
            )

    def load(self, osm_path: str, projector_yaml: str) -> None:
        if not _LANELET2_AVAILABLE:
            logger.warning(
                "MapServer.load() skipped: lanelet2 dependency is not installed"
            )
            raise MapUnavailableError(
                "Map service is unavailable: map files or Lanelet2 dependency not loaded"
            )

        try:
            with open(projector_yaml, "r") as f:
                data = yaml.safe_load(f)

            self._origin_lat = data["map_origin"]["latitude"]
            self._origin_lon = data["map_origin"]["longitude"]

            origin = Origin(self._origin_lat, self._origin_lon)
            self._projector = LocalCartesianProjector(origin)

            self._lanelet_map   = ll2_load(osm_path, self._projector)
            self._lanelet_layer = self._lanelet_map.laneletLayer

            tr = traffic_rules.create(
                traffic_rules.Locations.Germany,
                traffic_rules.Participants.Vehicle,
            )
            self._routing_graph = RoutingGraph(self._lanelet_map, tr)
            self._map_bounds = self._compute_bounds()
            self._geojson = None
            self._route.cache_clear()
            self._map_name = Path(osm_path).stem
            self._available = True
            logger.info(
                "MapServer loaded %d lanelets from %s", len(self._lanelet_layer), osm_path
            )
        except MapUnavailableError:
            raise
        except Exception as exc:
            self._available = False
            raise MapUnavailableError(
                f"Map service is unavailable: failed to load map: {exc}"
            ) from exc

    def xy_to_latlon(self, x: float, y: float, frame_id: str = "map") -> LatLon:
        self._ensure_available()
        gps = self._projector.reverse(BasicPoint3d(x, y, 0.0))
        return LatLon(lat=gps.lat, lon=gps.lon)

    def latlon_to_xy(self, lat: float, lon: float, target_frame_id: str = "map") -> XY:
        self._ensure_available()
        point = self._projector.forward(GPSPoint(lat, lon, 0.0))
        return XY(x=point.x, y=point.y, frame_id=target_frame_id)

    def _to_latlon(self, x: float, y: float) -> list[float]:
        gps = self._projector.reverse(BasicPoint3d(x, y, 0.0))
        return [gps.lon, gps.lat]

    def _compute_bounds(self):
        min_lat = min_lon =  1e18
        max_lat = max_lon = -1e18
        for ll in self._lanelet_layer:
            for bound in (ll.leftBound, ll.rightBound):
                for p in bound:
                    lon, lat = self._to_latlon(p.x, p.y)
                    min_lat = min(min_lat, lat)
                    max_lat = max(max_lat, lat)
                    min_lon = min(min_lon, lon)
                    max_lon = max(max_lon, lon)
        # [[south, west], [north, east]]
        return [[min_lat, min_lon], [max_lat, max_lon]]

    def get_bounds(self) -> list[list[float]]:
        self._ensure_available()
        return self._map_bounds

    def get_info(self) -> MapInfo:
        self._ensure_available()
        return MapInfo(
            map_name=self._map_name,
            frame_id="map",
            origin_lat=self._origin_lat,
            origin_lon=self._origin_lon,
            lanelet_count=len(self._lanelet_layer),
        )

    def get_geojson(self) -> dict:
        self._ensure_available()
        if self._geojson is None:
            self._geojson = self._build_geojson()
        return self._geojson

    def _build_geojson(self) -> dict:
        features = []
        for ll in self._lanelet_layer:
            left   = [self._to_latlon(p.x, p.y) for p in ll.leftBound]
            right  = [self._to_latlon(p.x, p.y) for p in ll.rightBound]
            center = [self._to_latlon(p.x, p.y) for p in ll.centerline]
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": left},   "properties": {"type": "left"}})
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": right},  "properties": {"type": "right"}})
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": center}, "properties": {"type": "center"}})
        return {"type": "FeatureCollection", "features": features}

    def is_in_lanelet(self, x: float, y: float, frame_id: str = "map") -> bool:
        self._ensure_available()
        point   = BasicPoint2d(x, y)
        nearest = findNearest(self._lanelet_layer, point, 1)
        if not nearest:
            return False
        return inside(nearest[0][1], point)

    def snap_to_lanelet(self, x: float, y: float, frame_id: str = "map") -> MapPoint:
        self._ensure_available()
        ll = self._nearest_lanelet(x, y)
        if ll is None:
            lon, lat = self._to_latlon(x, y)
            return MapPoint(x=x, y=y, frame_id=frame_id, lanelet_id=None, lat=lat, lon=lon)
        t = self._project_point_onto_centerline(ll, x, y)
        sx, sy = self._interp_centerline_xy_at(ll, t)
        lon, lat = self._to_latlon(sx, sy)
        return MapPoint(x=sx, y=sy, frame_id=frame_id, lanelet_id=ll.id, lat=lat, lon=lon)

    def place_waypoint(self, lat: float, lon: float) -> MapPoint | None:
        """A clicked point snapped onto its lanelet, or None if it's off the road."""
        xy = self.latlon_to_xy(lat, lon)
        if not self.is_in_lanelet(xy.x, xy.y):
            return None
        return self.snap_to_lanelet(xy.x, xy.y)

    def project_reachable_goal(
        self, x: float, y: float, frame_id: str = "map"
    ) -> ReachableGoal:
        self._ensure_available()
        return ReachableGoal(
            x=x, y=y, frame_id=frame_id, reachable=self.is_in_lanelet(x, y, frame_id)
        )

    def _get_lanelet_yaw(self, ll, x: float, y: float) -> float:
        pts = list(ll.centerline)
        if len(pts) < 2:
            return 0.0
        best_i = 0
        best_d = float("inf")
        for i in range(len(pts) - 1):
            mx = (pts[i].x + pts[i+1].x) / 2
            my = (pts[i].y + pts[i+1].y) / 2
            d = (mx - x) ** 2 + (my - y) ** 2
            if d < best_d:
                best_d = d
                best_i = i
        dx = pts[best_i + 1].x - pts[best_i].x
        dy = pts[best_i + 1].y - pts[best_i].y
        return math.atan2(dy, dx)

    def _nearest_lanelet(self, x: float, y: float):
        point = BasicPoint2d(x, y)
        candidates = findNearest(self._lanelet_layer, point, 5)
        if not candidates:
            return None

        best_ll   = None
        best_dist = float("inf")

        for dist, ll in candidates:
            yaw = self._get_lanelet_yaw(ll, x, y)
            if best_ll is None:
                ref_yaw = yaw
                best_ll = ll
                best_dist = dist
                continue

            dot = math.cos(yaw) * math.cos(ref_yaw) + math.sin(yaw) * math.sin(ref_yaw)
            if dot > 0 and dist < best_dist:
                best_dist = dist
                best_ll = ll

        return best_ll

    def _project_point_onto_centerline(self, ll, x: float, y: float) -> float:
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
        s = t * total
        for i in range(len(pts) - 1):
            if arc[i] <= s <= arc[i+1]:
                seg_len = arc[i+1] - arc[i]
                alpha = (s - arc[i]) / seg_len if seg_len > 0 else 0.0
                x = pts[i].x + alpha * (pts[i+1].x - pts[i].x)
                y = pts[i].y + alpha * (pts[i+1].y - pts[i].y)
                return self._to_latlon(x, y)
        return self._to_latlon(pts[-1].x, pts[-1].y)

    def _interp_centerline_xy_at(self, ll, t: float) -> tuple[float, float]:
        pts = list(ll.centerline)
        if len(pts) < 2:
            p = pts[0]
            return p.x, p.y
        arc   = self._build_arc(pts)
        total = arc[-1]
        if total == 0:
            return pts[0].x, pts[0].y
        s = t * total
        for i in range(len(pts) - 1):
            if arc[i] <= s <= arc[i+1]:
                seg_len = arc[i+1] - arc[i]
                alpha = (s - arc[i]) / seg_len if seg_len > 0 else 0.0
                x = pts[i].x + alpha * (pts[i+1].x - pts[i].x)
                y = pts[i].y + alpha * (pts[i+1].y - pts[i].y)
                return x, y
        return pts[-1].x, pts[-1].y

    def _build_arc(self, pts):
        arc = [0.0]
        for i in range(1, len(pts)):
            dx = pts[i].x - pts[i-1].x
            dy = pts[i].y - pts[i-1].y
            arc.append(arc[-1] + math.sqrt(dx*dx + dy*dy))
        return arc

    def _centerline_arc_length_between(self, ll, t_start: float, t_end: float) -> float:
        pts = list(ll.centerline)
        if len(pts) < 2:
            return 0.0
        total = self._build_arc(pts)[-1]
        return max(0.0, t_end - t_start) * total

    def _sample_centerline_between(self, ll, t_start: float, t_end: float) -> list:
        pts = list(ll.centerline)
        if len(pts) < 2:
            return []
        arc   = self._build_arc(pts)
        total = arc[-1]
        if total == 0:
            return [self._to_latlon(pts[0].x, pts[0].y)]
        result = [self._interp_centerline_at(pts, arc, total, t_start)]
        for i, a in enumerate(arc[1:], start=1):
            t = a / total
            if t_start + 1e-9 < t < t_end - 1e-9:
                result.append(self._to_latlon(pts[i].x, pts[i].y))
        result.append(self._interp_centerline_at(pts, arc, total, t_end))
        return result

    def _sample_centerline_from(self, ll, t_start: float) -> list:
        pts = list(ll.centerline)
        if len(pts) < 2:
            return []
        arc   = self._build_arc(pts)
        total = arc[-1]
        if total == 0:
            return [self._to_latlon(pts[0].x, pts[0].y)]
        result = [self._interp_centerline_at(pts, arc, total, t_start)]
        for i, a in enumerate(arc[1:], start=1):
            if a / total > t_start + 1e-9:
                result.append(self._to_latlon(pts[i].x, pts[i].y))
        return result

    def _sample_centerline_to(self, ll, t_end: float) -> list:
        pts = list(ll.centerline)
        if len(pts) < 2:
            return []
        arc   = self._build_arc(pts)
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
        """Cached (the same loop is requested from several views); treat as read-only."""
        if len(waypoints) < 2:
            return None
        return self._route(tuple((wp["x"], wp["y"]) for wp in waypoints))

    @lru_cache(maxsize=256)
    def _route(self, points: tuple[tuple[float, float], ...]) -> dict | None:
        waypoints = [{"x": x, "y": y} for x, y in points]

        full_coords = []
        total_length = 0.0

        for seg in range(len(waypoints) - 1):
            wx0, wy0 = waypoints[seg]["x"],   waypoints[seg]["y"]
            wx1, wy1 = waypoints[seg+1]["x"], waypoints[seg+1]["y"]

            start_ll = self._nearest_lanelet(wx0, wy0)
            end_ll   = self._nearest_lanelet(wx1, wy1)
            if start_ll is None or end_ll is None:
                return None

            t0 = self._project_point_onto_centerline(start_ll, wx0, wy0)
            t1 = self._project_point_onto_centerline(end_ll,   wx1, wy1)

            if start_ll.id == end_ll.id and t0 > t1:
                following = list(self._routing_graph.following(start_ll))
                if not following:
                    logger.info("No following lanelets for ll=%s, cannot reroute", start_ll.id)
                    return None
                via_ll = following[0]

                route1 = self._routing_graph.getRoute(start_ll, via_ll, 0)
                if route1 is None:
                    logger.info("getRoute part1 returned None")
                    return None
                route2 = self._routing_graph.getRoute(via_ll, end_ll, 0)
                if route2 is None:
                    logger.info("getRoute part2 returned None")
                    return None

                path1 = list(route1.shortestPath())
                path2 = list(route2.shortestPath())
                ll_sequence = path1 + path2[1:]
            else:
                route = self._routing_graph.getRoute(start_ll, end_ll, 0)
                if route is None:
                    return None
                ll_sequence = list(route.shortestPath())

            coords = []
            for i, ll in enumerate(ll_sequence):
                if i == 0 and i == len(ll_sequence) - 1:
                    coords.extend(self._sample_centerline_between(ll, t0, t1))
                    total_length += self._centerline_arc_length_between(ll, t0, t1)
                elif i == 0:
                    coords.extend(self._sample_centerline_from(ll, t0)[:-1])
                    total_length += self._centerline_arc_length_between(ll, t0, 1.0)
                elif i == len(ll_sequence) - 1:
                    coords.extend(self._sample_centerline_to(ll, t1))
                    total_length += self._centerline_arc_length_between(ll, 0.0, t1)
                else:
                    pts = list(ll.centerline)
                    coords.extend(self._to_latlon(p.x, p.y) for p in pts[:-1])
                    total_length += self._centerline_arc_length_between(ll, 0.0, 1.0)

            if full_coords and coords:
                coords = coords[1:]
            full_coords.extend(coords)

        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": full_coords},
            "properties": {"type": "route", "length_m": total_length},
        }

    def get_route_preview(self, waypoints: list[RouteWaypoint]) -> dict | None:
        self._ensure_available()
        wps = [{"x": w.x, "y": w.y} for w in waypoints]
        return self.get_route(wps)
