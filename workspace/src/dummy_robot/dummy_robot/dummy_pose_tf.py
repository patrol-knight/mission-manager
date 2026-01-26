import math
import rclpy

from rclpy.node import Node
from tf2_ros import TransformBroadcaster
from geometry_msgs.msg import PoseStamped, TransformStamped


class RobotPoseTf(Node):
    def __init__(self):
        super().__init__('dummy_pose_tf_node')

        self.tf_broadcaster = TransformBroadcaster(self)
        self.pose_publisher = self.create_publisher(PoseStamped, '/robot_pose', 10)
        self.timer = self.create_timer(0.1, self._update)

        self.start = self.get_clock().now()
        self.get_logger().info('Dummy Pose and Tf node has started.')

    def _update(self):
        now = self.get_clock().now()
        elapsed_time = (now - self.start).nanoseconds / 1e9

        radius = 2.0
        x = radius * math.cos(elapsed_time * 0.5)
        y = radius * math.sin(elapsed_time * 0.5)
        yaw = (elapsed_time * 0.5) + math.pi / 2

        qx = 0.0
        qy = 0.0
        qz = math.sin(yaw / 2.0)
        qw = math.cos(yaw / 2.0)

        pose_msg = PoseStamped()
        pose_msg.header.stamp = now.to_msg()
        pose_msg.header.frame_id = 'map'
        pose_msg.pose.position.x = x
        pose_msg.pose.position.y = y
        pose_msg.pose.orientation.x = qx
        pose_msg.pose.orientation.y = qy
        pose_msg.pose.orientation.z = qz
        pose_msg.pose.orientation.w = qw
        self.pose_publisher.publish(pose_msg)

        t = TransformStamped()
        t.header.stamp = now.to_msg()
        t.header.frame_id = 'map'
        t.child_frame_id = 'base_link'
        
        t.transform.translation.x = x
        t.transform.translation.y = y
        t.transform.translation.z = 0.0
        t.transform.rotation.x = qx
        t.transform.rotation.y = qy
        t.transform.rotation.z = qz
        t.transform.rotation.w = qw

        self.tf_broadcaster.sendTransform(t)



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