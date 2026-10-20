import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { parseHash } from "./app/route";
import { CardPage } from "./components/referral/OutreachCard";
import "./index.css";
import { canRunLocally } from "./lib/data";
import { migrateLegacyStorage } from "./lib/storage";
import { restoreFromDisk } from "./lib/tracking";

migrateLegacyStorage();

// The local server's service worker keeps one page: "RawJobs isn't running", shown when the
// dashboard's address doesn't answer (packages/server/src/pages.ts). Not in dev or the hosted copy.
if (import.meta.env.PROD && canRunLocally && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

const root = createRoot(document.getElementById("root")!);
if ("card" in parseHash()) {
  // The See people card's popup (no Picture-in-Picture): only the card, no job list or tracking.
  root.render(
    <StrictMode>
      <CardPage />
    </StrictMode>,
  );
} else {
  // What your RawJobs folder remembers comes first (lib/tracking.ts), so every screen starts from it.
  void restoreFromDisk().finally(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
