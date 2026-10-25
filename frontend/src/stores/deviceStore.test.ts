import { describe, it, expect } from "vitest";
import { useDeviceStore, selectAlertCounts, selectRobot } from "./deviceStore";
import type { Anomaly } from "../features/anomalies/anomalyTypes";
import type { Device } from "../types/domain";

const anomaly = (id: string, source: string, resolution: Anomaly["resolution"] = null) =>
  ({ anomalyId: id, sourceDeviceId: source, resolution }) as Anomaly;

describe("deviceStore selectors", () => {
  it("counts only open anomalies per reporting tower", () => {
    useDeviceStore.getState().setAnomalies([
      anomaly("a", "t1"),
      anomaly("b", "t1", "unclear"),
      anomaly("c", "t1", "true_positive"),
      anomaly("d", "t2"),
    ]);
    expect(selectAlertCounts(useDeviceStore.getState())).toEqual({ t1: 2, t2: 1 });
  });

  it("picks the robot with the lowest id, connected or not", () => {
    const device = (deviceId: string, type: Device["type"], connected = true) => ({ deviceId, type, connected }) as Device;
    useDeviceStore.getState().setDevices([device("iot-1", "iot"), device("robot-b", "robot"), device("robot-a", "robot", false)]);
    expect(selectRobot(useDeviceStore.getState())?.deviceId).toBe("robot-a");
    useDeviceStore.getState().setDevices([device("iot-1", "iot")]);
    expect(selectRobot(useDeviceStore.getState())).toBeNull();
  });
});
