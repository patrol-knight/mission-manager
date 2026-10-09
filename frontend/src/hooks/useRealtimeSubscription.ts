import { useEffect } from "react";
import { getRealtimeClient } from "../api/realtimeClient";
import { useDeviceStore } from "../stores/deviceStore";
import { useMissionStore } from "../stores/missionStore";
import { useInvestigationStore } from "../stores/investigationStore";
import {
  missionDefinitionFromRaw,
  missionExecutionStateFromRaw,
  type RawMission,
  type RawMissionExecutionState,
} from "../features/missions/missionTypes";
import { anomalyFromRaw, type RawAnomaly, type RawAnomalyExpired } from "../features/anomalies/anomalyTypes";
import { investigationFromRaw, type RawInvestigation } from "../features/investigation/investigationTypes";

/**
 * Mounted once (in AppShell). Bridges the singleton realtime connection into
 * the stores. Cleanup always unsubscribes and effect re-mount always
 * re-subscribes, so this is safe under React StrictMode's dev-mode double-invoke.
 *
 * Pure store updates only — no side effects like toasts. InvestigationNotifier
 * (a separate, always-mounted component) reacts to the resulting state.
 */
export function useRealtimeSubscription(): void {
  const setDevices = useDeviceStore((s) => s.setDevices);
  const upsertDevice = useDeviceStore((s) => s.upsertDevice);
  const setAnomalies = useDeviceStore((s) => s.setAnomalies);
  const upsertAnomaly = useDeviceStore((s) => s.upsertAnomaly);
  const removeAnomaly = useDeviceStore((s) => s.removeAnomaly);
  const upsertCamera = useDeviceStore((s) => s.upsertCamera);
  const setDefinition = useMissionStore((s) => s.setDefinition);
  const setExecution = useMissionStore((s) => s.setExecution);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);

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
      client.onInvestigationUpdate((raw) => {
        setInvestigation(raw ? investigationFromRaw(raw as RawInvestigation) : null);
      }),
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
    upsertCamera,
    setDefinition,
    setExecution,
    setInvestigation,
  ]);
}
