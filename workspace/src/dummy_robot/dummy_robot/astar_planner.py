#!/usr/bin/env python3
import math
import heapq
from typing import List, Tuple, Optional

import rclpy
from rclpy.node import Node

from nav_msgs.msg import OccupancyGrid, Path
from geometry_msgs.msg import PoseArray, PoseStamped, Quaternion

from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy


Grid = List[List[int]]


def yaw_to_quat(yaw: float) -> Quaternion:
    q = Quaternion()
    q.w = math.cos(yaw * 0.5)
    q.z = math.sin(yaw * 0.5)
    q.x = 0.0
    q.y = 0.0
    return q


def dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def bresenham(x0: int, y0: int, x1: int, y1: int) -> List[Tuple[int, int]]:
    """Grid line cells between (x0,y0) and (x1,y1)."""
    cells = []
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    x, y = x0, y0
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    if dx > dy:
        err = dx / 2.0
        while x != x1:
            cells.append((x, y))
            err -= dy
            if err < 0:
                y += sy
                err += dx
            x += sx
    else:
        err = dy / 2.0
        while y != y1:
            cells.append((x, y))
            err -= dx
            if err < 0:
                x += sx
                err += dy
            y += sy
    cells.append((x1, y1))
    return cells


class AStarGridPlanner(Node):
    def __init__(self):
        super().__init__("astar_planner_node")

        self.declare_parameter("map_topic", "/map")
        self.declare_parameter("robot_pose_topic", "/robot_pose")
        self.declare_parameter("waypoints_topic", "/mission/waypoints")
        self.declare_parameter("path_topic", "/mission/path")

        self.declare_parameter("occupied_threshold", 50)    
        self.declare_parameter("unknown_is_occupied", True)
        self.declare_parameter("inflation_radius_m", 0.25)

        self.declare_parameter("allow_diagonal", True)
        self.declare_parameter("astar_timeout_ms", 300) 

        self.declare_parameter("shortcut_passes", 0)
        self.declare_parameter("chaikin_iters", 2)
        self.declare_parameter("resample_ds", 0.10)
        self.declare_parameter("min_path_points", 2)

        self.map_topic = self.get_parameter("map_topic").value
        self.robot_pose_topic = self.get_parameter("robot_pose_topic").value
        self.waypoints_topic = self.get_parameter("waypoints_topic").value
        self.path_topic = self.get_parameter("path_topic").value

        self.map_qos = QoSProfile(
            depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL
        )

        self.stream_qos = QoSProfile(
            depth=10,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE
        )

        self.map_sub = self.create_subscription(
            OccupancyGrid, self.map_topic, self._on_map, self.map_qos
        )
        self.robot_sub = self.create_subscription(
            PoseStamped, self.robot_pose_topic, self._on_robot_pose, self.stream_qos
        )
        self.wp_sub = self.create_subscription(
            PoseArray, self.waypoints_topic, self._on_waypoints, self.stream_qos
        )
        self.path_pub = self.create_publisher(Path, self.path_topic, 10)

        self.robot_pose: Optional[PoseStamped] = None

        self.map_msg: Optional[OccupancyGrid] = None
        self.grid: Optional[Grid] = None
        self.inflated_grid: Optional[Grid] = None

        self.width = 0
        self.height = 0
        self.resolution = 0.0
        self.origin_x = 0.0
        self.origin_y = 0.0
        self.frame_id = "map"

        self.get_logger().info(
            f"A* Grid Planner ready. Waiting for {self.map_topic}, {self.robot_pose_topic}, {self.waypoints_topic}."
        )

    def _on_robot_pose(self, msg: PoseStamped) -> None:
        self.robot_pose = msg

    def _on_map(self, msg: OccupancyGrid) -> None:
        self.map_msg = msg
        self.frame_id = msg.header.frame_id if msg.header.frame_id else "map"
        self.width = msg.info.width
        self.height = msg.info.height
        self.resolution = msg.info.resolution
        self.origin_x = msg.info.origin.position.x
        self.origin_y = msg.info.origin.position.y

        self.grid = self._occupancy_to_grid(msg)
        self.inflated_grid = self._inflate_grid(self.grid)

        self.get_logger().info(
            f"Map received: {self.width}x{self.height}, res={self.resolution:.3f}, origin=({self.origin_x:.2f},{self.origin_y:.2f}), frame={self.frame_id}"
        )

    def _on_waypoints(self, msg: PoseArray) -> None:
        if self.map_msg is None or self.grid is None or self.inflated_grid is None:
            self.get_logger().warn("No map yet. Cannot plan.")
            return

        if self.robot_pose is None:
            self.get_logger().warn("No robot pose yet. Cannot plan.")
            return

        if len(msg.poses) < 1:
            self.get_logger().warn("Need at least 1 mission waypoint.")
            return

        # Use mission frame if provided, otherwise map frame.
        frame_id = msg.header.frame_id if msg.header.frame_id else self.frame_id

        # Build world waypoints: [robot_pose, wp0, wp1, ...]
        world_points: List[Tuple[float, float]] = []
        world_points.append((
            float(self.robot_pose.pose.position.x),
            float(self.robot_pose.pose.position.y)
        ))
        for pose in msg.poses:
            world_points.append((float(pose.position.x), float(pose.position.y)))

        # Convert to grid cells
        way_cells: List[Tuple[int, int]] = []
        for (wx, wy) in world_points:
            cell = self.world_to_cell(wx, wy)
            if cell is None:
                self.get_logger().warn(f"Waypoint out of map bounds: ({wx:.2f},{wy:.2f}).")
                return
            way_cells.append(cell)

        # Plan segment-by-segment
        full_cells: List[Tuple[int, int]] = []
        for i in range(len(way_cells) - 1):
            start_raw = way_cells[i]
            goal_raw = way_cells[i + 1]

            start = self._nearest_free(start_raw)
            goal = self._nearest_free(goal_raw)
            if start is None or goal is None:
                self.get_logger().warn(f"Start/goal not reachable near: {start_raw} -> {goal_raw}")
                return

            seg = self._astar(start, goal, self.inflated_grid)
            if seg is None or len(seg) == 0:
                self.get_logger().warn(f"A* failed on segment {i}: {start}->{goal}")
                return

            if i > 0 and len(seg) > 0:
                seg = seg[1:]  # avoid duplicating joint
            full_cells.extend(seg)

        # Convert to world polyline
        poly = [self.cell_to_world(cx, cy) for (cx, cy) in full_cells]

        # Smoothing
        poly = self._shortcut_smooth(poly, passes=int(self.get_parameter("shortcut_passes").value))
        poly = self._chaikin(poly, iters=int(self.get_parameter("chaikin_iters").value))

        # Resample for pure pursuit
        ds = float(self.get_parameter("resample_ds").value)
        poly = self._resample(poly, ds)

        if len(poly) < int(self.get_parameter("min_path_points").value):
            self.get_logger().warn("Path too short after smoothing/resampling.")
            return

        path_msg = self._polyline_to_path(poly, frame_id)
        self.path_pub.publish(path_msg)
        self.get_logger().info(
            f"Published path with {len(path_msg.poses)} poses (segments={len(way_cells)-1})."
        )

    def _occupancy_to_grid(self, msg: OccupancyGrid) -> Grid:
        thr = int(self.get_parameter("occupied_threshold").value)
        unknown_occ = bool(self.get_parameter("unknown_is_occupied").value)

        data = msg.data
        grid: Grid = [[0 for _ in range(self.width)] for _ in range(self.height)]
        for y in range(self.height):
            base = y * self.width
            for x in range(self.width):
                v = data[base + x]
                if v < 0:
                    grid[y][x] = 1 if unknown_occ else 0
                else:
                    grid[y][x] = 1 if v >= thr else 0
        return grid

    def _inflate_grid(self, grid: Grid) -> Grid:
        r_m = float(self.get_parameter("inflation_radius_m").value)
        if r_m <= 1e-6:
            return grid

        r_cells = int(math.ceil(r_m / self.resolution))
        if r_cells <= 0:
            return grid

        inflated: Grid = [row[:] for row in grid]
        occ = [(x, y) for y in range(self.height) for x in range(self.width) if grid[y][x] == 1]

        for (ox, oy) in occ:
            for dy in range(-r_cells, r_cells + 1):
                ny = oy + dy
                if ny < 0 or ny >= self.height:
                    continue
                for dx in range(-r_cells, r_cells + 1):
                    nx = ox + dx
                    if nx < 0 or nx >= self.width:
                        continue
                    if dx * dx + dy * dy <= r_cells * r_cells:
                        inflated[ny][nx] = 1
        return inflated

    def world_to_cell(self, wx: float, wy: float) -> Optional[Tuple[int, int]]:
        mx = int(math.floor((wx - self.origin_x) / self.resolution))
        my = int(math.floor((wy - self.origin_y) / self.resolution))
        if 0 <= mx < self.width and 0 <= my < self.height:
            return (mx, my)
        return None

    def cell_to_world(self, cx: int, cy: int) -> Tuple[float, float]:
        wx = self.origin_x + (cx + 0.5) * self.resolution
        wy = self.origin_y + (cy + 0.5) * self.resolution
        return (wx, wy)

    def _is_free(self, cx: int, cy: int, grid: Grid) -> bool:
        return 0 <= cx < self.width and 0 <= cy < self.height and grid[cy][cx] == 0

    def _nearest_free(self, cell: Tuple[int, int], max_r: int = 30) -> Optional[Tuple[int, int]]:
        cx, cy = cell
        if self._is_free(cx, cy, self.inflated_grid):
            return (cx, cy)

        for r in range(1, max_r + 1):
            for dy in range(-r, r + 1):
                ny = cy + dy
                if ny < 0 or ny >= self.height:
                    continue
                for dx in range(-r, r + 1):
                    nx = cx + dx
                    if nx < 0 or nx >= self.width:
                        continue
                    if self._is_free(nx, ny, self.inflated_grid):
                        return (nx, ny)
        return None

    def _astar(
        self,
        start: Tuple[int, int],
        goal: Tuple[int, int],
        grid: Grid
    ) -> Optional[List[Tuple[int, int]]]:
        allow_diag = bool(self.get_parameter("allow_diagonal").value)
        timeout_ms = int(self.get_parameter("astar_timeout_ms").value)

        def h(a: Tuple[int, int], b: Tuple[int, int]) -> float:
            dx = abs(a[0] - b[0])
            dy = abs(a[1] - b[1])
            if allow_diag:
                return (dx + dy) + (math.sqrt(2) - 2) * min(dx, dy)  # octile
            return dx + dy  # manhattan

        if start == goal:
            return [start]

        if allow_diag:
            nbrs = [(-1, 0), (1, 0), (0, -1), (0, 1),
                    (-1, -1), (-1, 1), (1, -1), (1, 1)]
        else:
            nbrs = [(-1, 0), (1, 0), (0, -1), (0, 1)]

        t0 = self.get_clock().now().nanoseconds

        open_heap: List[Tuple[float, Tuple[int, int]]] = []
        heapq.heappush(open_heap, (0.0, start))
        came_from = {start: None}
        gscore = {start: 0.0}

        while open_heap:
            # timeout
            t = self.get_clock().now().nanoseconds
            if (t - t0) / 1e6 > timeout_ms:
                self.get_logger().warn("A* timeout.")
                return None

            _, cur = heapq.heappop(open_heap)
            if cur == goal:
                return self._reconstruct(came_from, cur)

            cx, cy = cur
            for dx, dy in nbrs:
                nx, ny = cx + dx, cy + dy
                if not self._is_free(nx, ny, grid):
                    continue

                # avoid cutting corners
                if allow_diag and dx != 0 and dy != 0:
                    if not (self._is_free(cx + dx, cy, grid) and self._is_free(cx, cy + dy, grid)):
                        continue

                step = math.sqrt(2) if (dx != 0 and dy != 0) else 1.0
                tentative = gscore[cur] + step
                nxt = (nx, ny)

                if nxt not in gscore or tentative < gscore[nxt]:
                    came_from[nxt] = cur
                    gscore[nxt] = tentative
                    f = tentative + h(nxt, goal)
                    heapq.heappush(open_heap, (f, nxt))

        return None

    def _reconstruct(self, came_from, cur: Tuple[int, int]) -> List[Tuple[int, int]]:
        path = [cur]
        while came_from[cur] is not None:
            cur = came_from[cur]
            path.append(cur)
        path.reverse()
        return path

    def _line_of_sight_free(self, a: Tuple[float, float], b: Tuple[float, float]) -> bool:
        ca = self.world_to_cell(a[0], a[1])
        cb = self.world_to_cell(b[0], b[1])
        if ca is None or cb is None:
            return False
        for (x, y) in bresenham(ca[0], ca[1], cb[0], cb[1]):
            if not self._is_free(x, y, self.inflated_grid):
                return False
        return True

    def _shortcut_smooth(self, pts: List[Tuple[float, float]], passes: int = 1) -> List[Tuple[float, float]]:
        if len(pts) <= 2 or passes <= 0:
            return pts

        out = pts[:]
        for _ in range(passes):
            if len(out) <= 2:
                break
            simplified = [out[0]]
            i = 0
            while i < len(out) - 1:
                j = len(out) - 1
                while j > i + 1 and not self._line_of_sight_free(out[i], out[j]):
                    j -= 1
                simplified.append(out[j])
                i = j
            out = simplified
        return out

    def _chaikin(self, pts: List[Tuple[float, float]], iters: int = 1) -> List[Tuple[float, float]]:
        if len(pts) < 3 or iters <= 0:
            return pts

        out = pts[:]
        for _ in range(iters):
            new_pts = [out[0]]
            for i in range(len(out) - 1):
                p0 = out[i]
                p1 = out[i + 1]
                q = (0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1])
                r = (0.25 * p0[0] + 0.75 * p1[0], 0.25 * p1[1] + 0.75 * p0[1])
                # NOTE: the above line is intentionally wrong for y to show nothing?
                # FIX IT:
                r = (0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1])
                new_pts.append(q)
                new_pts.append(r)
            new_pts.append(out[-1])
            out = new_pts
        return out

    def _resample(self, pts: List[Tuple[float, float]], ds: float) -> List[Tuple[float, float]]:
        if len(pts) < 2 or ds <= 1e-6:
            return pts

        res = [pts[0]]
        acc = 0.0
        cur = pts[0]

        for i in range(1, len(pts)):
            nxt = pts[i]
            seg_len = dist(cur, nxt)
            if seg_len < 1e-9:
                continue

            direction = ((nxt[0] - cur[0]) / seg_len, (nxt[1] - cur[1]) / seg_len)

            while acc + seg_len >= ds:
                remain = ds - acc
                newp = (cur[0] + direction[0] * remain, cur[1] + direction[1] * remain)
                res.append(newp)
                cur = newp
                seg_len = dist(cur, nxt)
                acc = 0.0
                if seg_len < 1e-9:
                    break

            acc += seg_len
            cur = nxt

        if dist(res[-1], pts[-1]) > ds * 0.5:
            res.append(pts[-1])
        return res

    def _polyline_to_path(self, pts: List[Tuple[float, float]], frame_id: str) -> Path:
        path = Path()
        path.header.frame_id = frame_id
        path.header.stamp = self.get_clock().now().to_msg()

        yaws = []
        for i in range(len(pts)):
            if i == len(pts) - 1:
                dx = pts[i][0] - pts[i - 1][0]
                dy = pts[i][1] - pts[i - 1][1]
            else:
                dx = pts[i + 1][0] - pts[i][0]
                dy = pts[i + 1][1] - pts[i][1]
            yaws.append(math.atan2(dy, dx))

        for (p, yaw) in zip(pts, yaws):
            ps = PoseStamped()
            ps.header = path.header
            ps.pose.position.x = float(p[0])
            ps.pose.position.y = float(p[1])
            ps.pose.position.z = 0.0
            ps.pose.orientation = yaw_to_quat(yaw)
            path.poses.append(ps)

        return path


def main(args=None):
    rclpy.init(args=args)
    node = AStarGridPlanner()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
