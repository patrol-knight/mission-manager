import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./app/App";
import { DevPage } from "./features/devtools/DevPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname.startsWith("/dev") ? <DevPage /> : <App />}
  </StrictMode>
);
