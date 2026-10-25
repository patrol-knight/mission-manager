import { ToastProvider } from "../components/Toast";
import { HintLayer } from "../components/HintLayer";
import { AppShell } from "./AppShell";

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
      <HintLayer />
    </ToastProvider>
  );
}
