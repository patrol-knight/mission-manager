import { useMemo, useReducer, type ReactNode } from "react";
import { MissionEditorContext } from "./missionEditorContextObject";
import { missionEditorReducer, BLANK_STATE } from "./missionEditorReducer";

export function MissionEditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(missionEditorReducer, BLANK_STATE);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <MissionEditorContext.Provider value={value}>{children}</MissionEditorContext.Provider>;
}
