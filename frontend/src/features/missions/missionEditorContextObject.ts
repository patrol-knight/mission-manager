import { createContext, type Dispatch } from "react";
import type { MissionEditorState, MissionEditorAction } from "./missionEditorReducer";

export interface MissionEditorContextValue {
  state: MissionEditorState;
  dispatch: Dispatch<MissionEditorAction>;
}

export const MissionEditorContext = createContext<MissionEditorContextValue | null>(null);
