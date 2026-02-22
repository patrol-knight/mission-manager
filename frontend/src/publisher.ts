import { Topic } from "roslib";
import { ros } from "./ros"

export const missionTopic = new Topic({
  ros,
  name: "/interface/waypoints",
  messageType: "geometry_msgs/PoseArray",
});

export function publishMission(waypoints: any[]) {
  const msg = {
    header: {
      frame_id: "map",
      stamp: {
        sec: Math.floor(Date.now() / 1000),
        nanosec: (Date.now() % 1000) * 1e6,
      },
    },
    poses: waypoints.map((wp) => ({
      position: {
        x: wp.x,
        y: wp.y,
        z: 0,
      },
      orientation: {
        x: 0,
        y: 0,
        z: Math.sin(wp.yaw / 2),
        w: Math.cos(wp.yaw / 2),
      },
    })),
  };

  missionTopic.publish(msg);
}

export function publishInitialPose(x: number, y: number, yaw: number) {
  const initialPoseTopic = new Topic({
    ros,
    name: "/initialpose",
    messageType: "geometry_msgs/PoseWithCovarianceStamped",
  });

  const msg = {
    header: {
      frame_id: "map",
      stamp: {
        sec: Math.floor(Date.now() / 1000),
        nanosec: (Date.now() % 1000) * 1e6,
      },
    },
    pose: {
      pose: {
        position: { x, y, z: 0 },
        orientation: {
          x: 0,
          y: 0,
          z: Math.sin(yaw / 2),
          w: Math.cos(yaw / 2),
        },
      },
      // Standard AMCL initial covariance (6x6 row-major)
      covariance: [
        0.25, 0, 0, 0, 0, 0,
        0, 0.25, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0.06853892326654787,
      ],
    },
  };

  initialPoseTopic.publish(msg);
}