import { Ros } from "roslib";

const localhostUrl = `ws://${window.location.hostname}:9090`;
const rosbridge_url = (window as any).RUNTIME_CONFIG?.ROSBRIDGE_URL || localhostUrl;

export const ros = new Ros({ url: rosbridge_url });

const BASE_DELAY = 2000;   // 2s first retry
const MAX_DELAY  = 30000;  // cap at 30s
let retryDelay   = BASE_DELAY;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let isConnected  = false;

function scheduleReconnect() {
  if (retryTimer) return; // already scheduled, don't stack

  console.warn(`[ROS] Reconnecting in ${retryDelay / 1000}s...`);

  retryTimer = setTimeout(() => {
    retryTimer = null;
    console.log("[ROS] Attempting reconnect...");
    ros.connect(rosbridge_url);

    // Double delay for next attempt, capped at MAX_DELAY
    retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
  }, retryDelay);
}

ros.on("connection", () => {
  console.log("[ROS] Connected to", rosbridge_url);
  isConnected = true;
  retryDelay = BASE_DELAY; // reset backoff on successful connect

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
});

ros.on("error", (err) => {
  console.error("[ROS] Connection error:", err);
  if (isConnected) {
    isConnected = false;
  }
  scheduleReconnect();
});

ros.on("close", () => {
  console.warn("[ROS] Connection closed");
  if (isConnected) {
    isConnected = false;
  }
  scheduleReconnect();
});