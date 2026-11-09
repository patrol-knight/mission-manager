import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./app/App";
import { ToastProvider } from "./components/Toast";
import { DevPage } from "./features/devtools/DevPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname.startsWith("/dev") ? (
      <ToastProvider>
        <DevPage />
      </ToastProvider>
    ) : (
      <App />
    )}
  </StrictMode>
);
