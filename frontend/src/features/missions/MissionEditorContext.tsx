import { useReducer, type ReactNode } from "react";
import { MissionEditorContext } from "./missionEditorContextObject";
import { missionEditorReducer, BLANK_STATE } from "./missionEditorReducer";

export function MissionEditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(missionEditorReducer, BLANK_STATE);
  return (
    <MissionEditorContext.Provider value={{ state, dispatch }}>
      {children}
    </MissionEditorContext.Provider>
  );
}
