import { useEffect } from "react";
import { getRealtimeClient } from "../api/realtimeClient";
import { useDeviceStore } from "../stores/deviceStore";
import { useMissionStore } from "../stores/missionStore";
import {
  missionDefinitionFromRaw,
  missionExecutionStateFromRaw,
  type RawMission,
  type RawMissionExecutionState,
} from "../features/missions/missionTypes";
import { anomalyFromRaw, type RawAnomaly, type RawAnomalyExpired } from "../features/anomalies/anomalyTypes";
import type { RawDiversionReturning, RawDiversionStarted } from "../features/anomalies/diversionTypes";

/**
 * Mounted once (in AppShell). Bridges the singleton realtime connection into
 * deviceStore/missionStore. Cleanup always unsubscribes and effect re-mount always
 * re-subscribes, so this is safe under React StrictMode's dev-mode double-invoke.
 *
 * Pure store updates only — no side effects like toasts. AnomalyArrivalWatcher
 * (a separate, always-mounted component) is what reacts to the resulting
 * anomalies collection to show the arrival toast.
 */
export function useRealtimeSubscription(): void {
  const setDevices = useDeviceStore((s) => s.setDevices);
  const upsertDevice = useDeviceStore((s) => s.upsertDevice);
  const setAnomalies = useDeviceStore((s) => s.setAnomalies);
  const upsertAnomaly = useDeviceStore((s) => s.upsertAnomaly);
  const removeAnomaly = useDeviceStore((s) => s.removeAnomaly);
  const setDiversionStarted = useDeviceStore((s) => s.setDiversionStarted);
  const setDiversionReturning = useDeviceStore((s) => s.setDiversionReturning);
  const clearDiversion = useDeviceStore((s) => s.clearDiversion);
  const upsertCamera = useDeviceStore((s) => s.upsertCamera);
  const setDefinition = useMissionStore((s) => s.setDefinition);
  const setExecution = useMissionStore((s) => s.setExecution);

  useEffect(() => {
    const client = getRealtimeClient();
    client.connect();

    const unsubscribers = [
      client.onDevicesSnapshot(setDevices),
      client.onDeviceUpdate(upsertDevice),
      client.onMissionUpdate((raw) => {
        setDefinition(raw ? missionDefinitionFromRaw(raw as RawMission) : null);
      }),
      client.onMissionExecutionUpdate((raw) => {
        setExecution(raw ? missionExecutionStateFromRaw(raw as RawMissionExecutionState) : null);
      }),
      client.onAnomalySnapshot((raw) => {
        setAnomalies((raw as RawAnomaly[]).map(anomalyFromRaw));
      }),
      client.onAnomalyUpdate((raw) => {
        upsertAnomaly(anomalyFromRaw(raw as RawAnomaly));
      }),
      client.onAnomalyExpired((raw) => removeAnomaly((raw as RawAnomalyExpired).anomaly_id)),
      client.onDiversionStarted((raw) => setDiversionStarted(raw as RawDiversionStarted)),
      client.onDiversionReturning((raw) => setDiversionReturning(raw as RawDiversionReturning)),
      client.onDiversionCleared(() => clearDiversion()),
      client.onCamerasSnapshot((cameras) => cameras.forEach(upsertCamera)),
      client.onCameraUpdate(upsertCamera),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [
    setDevices,
    upsertDevice,
    setAnomalies,
    upsertAnomaly,
    removeAnomaly,
    setDiversionStarted,
    setDiversionReturning,
    clearDiversion,
    upsertCamera,
    setDefinition,
    setExecution,
  ]);
}
