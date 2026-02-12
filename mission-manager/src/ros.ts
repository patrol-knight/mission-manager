import { Ros } from "roslib";

export const ros = new Ros({
  url: "ws://localhost:9090"
});

ros.on("connection", () => {
  console.log("Connected to ROS");
});

ros.on("error", (err) => {
  console.error("ROS connection error:", err);
});

ros.on("close", () => {
  console.warn("ROS connection closed");
});
