import { Topic } from "roslib";
import { ros } from "./ros";

export type MapData = {
  image: HTMLCanvasElement;
  info: {
    width: number;
    height: number;
    resolution: number;
    origin: { x: number; y: number };
  };
};export function subscribeMap(onMap: (data: MapData) => void) {
  const mapTopic = new Topic({
    ros,
    name: "/map",
    messageType: "nav_msgs/OccupancyGrid",
  });

  const handler = (msg: any) => {
    const { width, height, resolution, origin } = msg.info;
    const data = msg.data;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imageData = ctx.createImageData(width, height);

    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      const gray = value === -1
        ? 127
        : 255 - Math.floor((value / 100) * 255);

      const x = i % width;
      const y = height - Math.floor(i / width) - 1; // FLIP Y
      const idx = (y * width + x) * 4;

      imageData.data[idx] = gray;
      imageData.data[idx + 1] = gray;
      imageData.data[idx + 2] = gray;
      imageData.data[idx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

    onMap({
      image: canvas,
      info: {
        width,
        height,
        resolution,
        origin: {
          x: origin.position.x,
          y: origin.position.y,
        },
      },
    });
  };

  mapTopic.subscribe(handler);

  return () => {
    mapTopic.unsubscribe(handler);
  };
}

export type RobotPose = {
  x: number;
  y: number;
  yaw: number; 
};

export function subscribeRobotPose(
  onPose: (pose: RobotPose) => void
) {
  const poseTopic = new Topic({
    ros,
    name: "/robot_pose",
    messageType: "geometry_msgs/PoseStamped",
  });

  poseTopic.subscribe((msg: any) => {
    const { position, orientation } = msg.pose;

    const { x: qx, y: qy, z: qz, w: qw } = orientation;
    const yaw = Math.atan2(
      2 * (qw * qz + qx * qy),
      1 - 2 * (qy * qy + qz * qz)
    );

    onPose({
      x: position.x,
      y: position.y,
      yaw: yaw,
    });
  });
}

export type PathPoint = {
  x: number;
  y: number;
};

export type PathData = {
  points: PathPoint[];
  frameId: string;
};

export function subscribePath(
  onPath: (path: PathData) => void
) {
  const pathTopic = new Topic({
    ros,
    name: "/mission/path",
    messageType: "nav_msgs/Path",
  });

  pathTopic.subscribe((msg: any) => {
    const points: PathPoint[] = msg.poses.map((poseStamped: any) => ({
      x: poseStamped.pose.position.x,
      y: poseStamped.pose.position.y,
    }));

    onPath({
      points,
      frameId: msg.header.frame_id || "map",
    });
  });
}