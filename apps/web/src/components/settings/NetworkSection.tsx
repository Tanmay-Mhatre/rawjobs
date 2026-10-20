import { RefreshCw, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { formatDate } from "../../lib/format";
import { deleteNetwork, REFRESH_AFTER_DAYS, useNetwork } from "../../lib/network";
import { ConnectLinkedIn } from "../referral/ConnectLinkedIn";
import { Button, Card } from "../ui";
import { ConfirmDialog } from "./ConfirmDialog";

/** Settings → Data & privacy → LinkedIn connections: import, refresh and delete. */
export function NetworkSection() {
  const network = useNetwork();
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const status = network?.state === "ready" ? network.value.status : null;

  return (
    <Card id="settings-network" className="scroll-mt-32 p-5 sm:p-6 md:scroll-mt-20">
      <h3 id="h-network" className="type-body font-semibold">
        LinkedIn connections
      </h3>
      <p className="mt-0.5 type-small text-muted">Who you know at each company, from LinkedIn's own export. Kept on this computer only.</p>

      <div className="mt-3 space-y-3 type-small">
        {network?.state === "loading" && <p className="text-muted">Checking your connections…</p>}
        {network?.state === "error" && <p className="text-danger-text">Couldn't read your connections. Check that RawJobs is running.</p>}
        {status && !status.connected && status.newer && <p className="text-warning-text">Your connections were saved by a newer RawJobs. Update RawJobs to read them.</p>}
        {status?.connected && (
          <div>
            <p className="inline-flex items-center gap-1.5 text-ink">
              <Users className="rj-icon" aria-hidden />
              <span>
                <b className="tabular">{status.counts.connections.toLocaleString()}</b> connection{status.counts.connections === 1 ? "" : "s"} · imported {formatDate(status.importedAt)}
              </span>
            </p>
            {status.ageDays >= REFRESH_AFTER_DAYS && <p className="mt-1 text-muted">It's been {status.ageDays} days. Get a fresh copy so new jobs and people show up.</p>}
          </div>
        )}
        {status && (
          <div className="flex flex-wrap gap-2">
            {status.connected ? (
              <>
                <Button onClick={() => setConnecting(true)}>
                  <RefreshCw className="size-4" /> Get a fresh copy
                </Button>
                <Button variant="danger" onClick={() => setDeleting(true)}>
                  <Trash2 className="size-4" /> Delete
                </Button>
              </>
            ) : (
              !status.newer && <Button onClick={() => setConnecting(true)}>Connect LinkedIn</Button>
            )}
            {!status.connected && status.newer && (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
          </div>
        )}
      </div>

      <ConnectLinkedIn open={connecting} onClose={() => setConnecting(false)} />
      <ConfirmDialog
        id="delete-network"
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete your LinkedIn connections?"
        confirmLabel="Delete connections"
        workingLabel="Deleting…"
        onConfirm={deleteNetwork}
      >
        <p>Your imported connections, positions, schools and close contacts are removed from this computer.</p>
        <p>
          Your connections file isn't backed up or synced. People you added to a job's contacts are part of your tracking data, so they stay, and they're in its browser copy, its backups and its
          exports.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
