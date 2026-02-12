import { Topic } from "roslib";
import { ros } from "./ros"

export const missionTopic = new Topic({
  ros,
  name: "/mission/waypoints",
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