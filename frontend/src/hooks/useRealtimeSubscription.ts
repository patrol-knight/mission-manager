import { useEffect } from "react";
import { getRealtimeClient } from "../api/realtimeClient";
import { useDeviceStore } from "../stores/deviceStore";
import { useMissionStore } from "../stores/missionStore";
import { useInvestigationStore } from "../stores/investigationStore";

/**
 * Mounted once (in AppShell). Bridges the singleton realtime connection into
 * the stores. Cleanup always unsubscribes and effect re-mount always
 * re-subscribes, so this is safe under React StrictMode's dev-mode double-invoke.
 *
 * Pure store updates only — no side effects like toasts. InvestigationNotifier
 * (a separate, always-mounted component) reacts to the resulting state.
 */
export function useRealtimeSubscription(): void {
  useEffect(() => {
    const client = getRealtimeClient();
    client.connect();

    // Store actions are stable for the store's lifetime, so reading them
    // once here is equivalent to selecting them as hook dependencies.
    const devices = useDeviceStore.getState();
    const missions = useMissionStore.getState();
    const investigations = useInvestigationStore.getState();

    const unsubscribers = [
      client.on("devices.snapshot", devices.setDevices),
      client.on("device.updated", devices.upsertDevice),
      client.on("anomalies.snapshot", devices.setAnomalies),
      client.on("anomaly.updated", devices.upsertAnomaly),
      client.on("anomaly.expired", devices.removeAnomaly),
      client.on("cameras.snapshot", (cameras) => cameras.forEach(devices.upsertCamera)),
      client.on("camera.updated", devices.upsertCamera),
      client.on("mission.current", missions.setDefinition),
      client.on("mission.execution", missions.setExecution),
      client.on("investigation.updated", investigations.setInvestigation),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, []);
}
