import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { canRunLocally } from "./lib/data";
import { migrateLegacyStorage } from "./lib/storage";

migrateLegacyStorage();

// The local server's service worker keeps one page: "RawJobs isn't running", shown when the
// dashboard's address doesn't answer (packages/server/src/pages.ts). Not in dev or the hosted copy.
if (import.meta.env.PROD && canRunLocally && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
