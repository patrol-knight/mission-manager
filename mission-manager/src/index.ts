import { ExtensionContext } from "@foxglove/extension";
import { initMissionPanel } from "./panel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "mission manager", initPanel: initMissionPanel });
}
