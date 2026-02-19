import { Ros } from "roslib";

const locolhost_url = `ws://${window.location.hostname}:9090`;
const rosbridge_url = window.RUNTIME_CONFIG?.ROSBRIDGE_URL || locolhost_url;

export const ros = new Ros({
  url: rosbridge_url
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
