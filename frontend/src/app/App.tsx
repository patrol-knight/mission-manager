import { ToastProvider } from "../components/Toast";
import { AppShell } from "./AppShell";

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}
