import rclpy

from rclpy.node import Node
from nav_msgs.msg import Path
from geometry_msgs.msg import PoseArray, PoseStamped


class Planner(Node):
    def __init__(self):
        super().__init__('dummy_planner_node')

        self.subscriber = self.create_subscription(PoseArray, '/interface/waypoints', self._update, 10)
        self.publisher = self.create_publisher(Path, '/planning/path', 10)

        self.get_logger().info("Dummy Planner ready.")

    def _update(self, msg: PoseArray) -> None:
        path = Path()

        path.header.frame_id = msg.header.frame_id if msg.header.frame_id else "map"
        path.header.stamp = self.get_clock().now().to_msg()

        for pose in msg.poses:
            p = PoseStamped()
            p.header = path.header
            p.pose = pose
            path.poses.append(p)

        self.publisher.publish(path)
        

def main(args=None):
    rclpy.init(args=args)
    node = Planner()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
