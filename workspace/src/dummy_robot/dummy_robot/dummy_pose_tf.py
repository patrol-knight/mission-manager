import math
import rclpy

from rclpy.node import Node
from tf2_ros import TransformBroadcaster
from nav_msgs.msg import Path, Odometry
from geometry_msgs.msg import TransformStamped


class RobotPoseTf(Node):
    def __init__(self):
        super().__init__('dummy_pose_tf_node')

        self.tf_broadcaster = TransformBroadcaster(self)
        self.pose_publisher = self.create_publisher(Odometry, '/pf/pose/odom', 10)
        self.path_sub = self.create_subscription(Path, '/planning/path', self._path_callback, 10)
        
        self.timer = self.create_timer(0.05, self._update)
        self.current_x = -8.0
        self.current_y = 0.0
        self.current_yaw = 0.0
        self.prev_x = self.current_x
        self.prev_y = self.current_y
        self.speed = 0.1
        self.waypoints = []
        self.get_logger().info('Dummy Pose and Tf node has started.')

    def _path_callback(self, msg: Path) -> None:
        self.waypoints = [p.pose.position for p in msg.poses]
        self.get_logger().info(f"Received {len(self.waypoints)} waypoints.")

    def _update(self):
        now = self.get_clock().now()
        dt: float = 0.5
        
        if self.waypoints:
            target = self.waypoints[0]
            dx = target.x - self.current_x
            dy = target.y - self.current_y
            distance = math.sqrt(dx**2 + dy**2)

            if distance < 0.1:
                self.waypoints.pop(0)
            else:
                self.current_yaw = math.atan2(dy, dx)
                self.current_x += (dx / distance) * self.speed
                self.current_y += (dy / distance) * self.speed

        vx = (self.current_x - self.prev_x) / dt
        vy = (self.current_y - self.prev_y) / dt
        v_yaw = 0.0

        self.prev_x = self.current_x
        self.prev_y = self.current_y

        qz = math.sin(self.current_yaw / 2.0)
        qw = math.cos(self.current_yaw / 2.0)

        t = TransformStamped()
        t.header.stamp = now.to_msg()
        t.header.frame_id = 'map'
        t.child_frame_id = 'base_link'

        t.transform.translation.x = self.current_x
        t.transform.translation.y = self.current_y
        t.transform.translation.z = 0.0

        t.transform.rotation.x = 0.0
        t.transform.rotation.y = 0.0
        t.transform.rotation.z = qz
        t.transform.rotation.w = qw

        self.tf_broadcaster.sendTransform(t)

        odom = Odometry()

        odom.header.stamp = now.to_msg()
        odom.header.frame_id = 'map'          
        odom.child_frame_id = 'base_link'    

        odom.pose.pose.position.x = self.current_x
        odom.pose.pose.position.y = self.current_y
        odom.pose.pose.position.z = 0.0

        odom.pose.pose.orientation.x = 0.0
        odom.pose.pose.orientation.y = 0.0
        odom.pose.pose.orientation.z = qz
        odom.pose.pose.orientation.w = qw

        odom.twist.twist.linear.x = vx
        odom.twist.twist.linear.y = vy
        odom.twist.twist.angular.z = v_yaw

        self.pose_publisher.publish(odom)
    

def main(args=None) -> None:
    rclpy.init(args=args)
    node = RobotPoseTf()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()