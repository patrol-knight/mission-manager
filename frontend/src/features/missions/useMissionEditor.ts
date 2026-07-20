import { useContext } from "react";
import { MissionEditorContext, type MissionEditorContextValue } from "./missionEditorContextObject";

export function useMissionEditor(): MissionEditorContextValue {
  const ctx = useContext(MissionEditorContext);
  if (!ctx) throw new Error("useMissionEditor must be used within a MissionEditorProvider");
  return ctx;
}
