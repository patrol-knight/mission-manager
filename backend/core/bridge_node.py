import math

from rclpy.node import Node
from nav_msgs.msg import Odometry
from geometry_msgs.msg import PoseArray, Pose, Quaternion

from .state_manager import StateManager
from .map_server import MapServer


class BridgeNode(Node):
    def __init__(self, state_manager: StateManager, map_server=None):
        super().__init__('bridge_node')
        self._sm: StateManager      = state_manager
        self._map_server: MapServer = map_server

        self.create_subscription(
            Odometry,
            '/localization/kinematic_state',
            self._odom_callback,
            10,
        )
        self._pose_array_pub = self.create_publisher(
            PoseArray,
            '/robot/waypoints', 
            10,
        )
        self._advertise_timer = self.create_timer(0.5, self._once_advertise)

        self.get_logger().info('[BridgeNode] subscribed to /localization/kinematic_state')
        self.get_logger().info('[BridgeNode] advertising /robot/waypoints (PoseArray)')

    def _once_advertise(self):
        """Publish one empty PoseArray so the topic appears in ros2 topic list."""
        msg = PoseArray()
        msg.header.stamp    = self.get_clock().now().to_msg()
        msg.header.frame_id = 'map'
        self._pose_array_pub.publish(msg)
        self.destroy_timer(self._advertise_timer)
        self.get_logger().info('[BridgeNode] /robot/waypoints advertised')

    def _odom_callback(self, msg: Odometry):
        x     = msg.pose.pose.position.x
        y     = msg.pose.pose.position.y
        yaw   = self._quat_to_yaw(msg.pose.pose.orientation)
        speed = msg.twist.twist.linear.x

        lat, lon = None, None
        if self._map_server is not None:
            try:
                lat, lon = self._map_server.xy_to_latlon(x, y)
            except Exception as e:
                self.get_logger().warn(f'xy_to_latlon failed: {e}')

        self._sm.update(x, y, yaw, speed, lat=lat, lon=lon)

    def publish_waypoints(self, waypoints: list[dict]):
        """
        Publish confirmed waypoints as PoseArray on /robot/waypoints.
        Each dict: {'x': float, 'y': float, 'yaw': float (optional)}
        """
        msg = PoseArray()
        msg.header.stamp    = self.get_clock().now().to_msg()
        msg.header.frame_id = 'map'

        for wp in waypoints:
            pose            = Pose()
            pose.position.x = float(wp['x'])
            pose.position.y = float(wp['y'])
            pose.position.z = 0.0
            pose.orientation = self._yaw_to_quat(float(wp.get('yaw', 0.0)))
            msg.poses.append(pose)

        self._pose_array_pub.publish(msg)
        self.get_logger().info(f'[BridgeNode] Published {len(msg.poses)} waypoints on /robot/waypoints')


    @staticmethod
    def _quat_to_yaw(q) -> float:
        siny = 2.0 * (q.w * q.z + q.x * q.y)
        cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        return math.atan2(siny, cosy)

    @staticmethod
    def _yaw_to_quat(yaw: float) -> Quaternion:
        q   = Quaternion()
        q.w = math.cos(yaw / 2.0)
        q.x = 0.0
        q.y = 0.0
        q.z = math.sin(yaw / 2.0)
        return q
