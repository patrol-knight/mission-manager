import os

from launch import LaunchDescription
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory


def generate_launch_description() -> LaunchDescription:
    pkg_share = get_package_share_directory('dummy_robot')
    map_yaml_file = os.path.join(pkg_share, 'maps', 'map_0201.yaml')

    return LaunchDescription([
        Node(
            package='nav2_map_server',
            executable='map_server',
            name='map_server',
            parameters=[{'yaml_filename': map_yaml_file}]
        ),
        Node(
            package='nav2_lifecycle_manager',
            executable='lifecycle_manager',
            name='lifecycle_manager',
            parameters=[{'autostart': True, 'node_names': ['map_server']}]
        ),
        Node(
            package='rosbridge_server',
            executable='rosbridge_websocket',
            name='rosbridge_websocket',
            parameters=[{
                'port': 9090,
                'address': '0.0.0.0',
                'default_call_service_timeout': 5.0,
                'call_services_in_new_thread': True,
                'send_action_goals_in_new_thread': True,
            }]
        ),
        Node(
          package='dummy_robot',
          executable='dummy_pose_tf',
          name='dummy_pose_tf_node'  
        ),
        Node(
          package='dummy_robot',
          executable='astar_planner',
          name='astar_planner_node'  
        )
    ])
