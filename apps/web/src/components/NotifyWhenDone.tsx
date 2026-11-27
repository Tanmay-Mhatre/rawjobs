import { Bell, BellOff, BellRing, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import type { TelegramStatus } from "../lib/automation";
import { PRIORITY, type Notice } from "../app/notices";
import type { ScanState } from "../lib/scan";
import { useScanSelector } from "../lib/scanStore";
import { Dialog } from "./Dialog";
import { TelegramAlerts } from "./TelegramAlerts";
import { IconButton as RjIconButton } from "./primitives";
import { Button, Card, cx, IconButton } from "./ui";
import { settingsHash } from "./settings/registry";

/** Settings › Telegram alerts. */
const toTelegramSettings = () => {
  location.hash = settingsHash("alerts");
};

export const telegramReady = (tg: TelegramStatus | null | undefined) => !!tg?.token && !!tg.connected;

/** One line on what happens when the running scan ends, for the scan details. */
export function notifyLine(tg: TelegramStatus | null | undefined, scan: ScanState, failed: boolean): string {
  if (!tg) return "Checking Telegram…";
  if (!telegramReady(tg)) return "Set up Telegram to get a message when scans finish.";
  if (failed) return "Couldn't ask for a Telegram message for this scan: it was started from another tab or by a schedule.";
  return scan.notify?.asked ? `Sends you a Telegram message (${tg.bot ?? "your bot"}) when this scan finishes.` : "Asking for a Telegram message when this scan finishes…";
}

/**
 * The bell next to Stop scan. With Telegram connected, every scan sends a message when it finishes
 * (asked for automatically), and the bell rings. Without it, the bell opens the Telegram setup and
 * this scan's message is asked for once it's connected.
 */
export function NotifyBell({
  tg,
  scan,
  failed,
  onConnected,
  onSaved,
  onDetails,
}: {
  tg: TelegramStatus | null | undefined;
  scan: ScanState;
  failed: boolean;
  /** Telegram was just connected: refresh its status and ask for this scan's message. */
  onConnected: () => void;
  onSaved: () => Promise<void>;
  /** Show the scan details, which say what the bell means. */
  onDetails: () => void;
}) {
  const [setup, setSetup] = useState(false);
  if (tg === undefined) return null;
  const ready = telegramReady(tg);
  const on = ready && !!scan.notify?.asked;
  const label = !tg
    ? "Checking Telegram"
    : !ready
      ? "Get a Telegram message when it's done"
      : failed
        ? "No Telegram message for this scan"
        : on
          ? "Telegram message when it's done: on"
          : "Asking for a Telegram message";
  return (
    <>
      <RjIconButton size="sm" label={label} onClick={() => (tg && !ready ? setSetup(true) : onDetails())} className={cx(on && "text-success-text", failed && "text-warning-text")}>
        {!tg || (ready && !on && !failed) ? (
          <LoaderCircle className="rj-icon animate-spin text-muted" />
        ) : failed ? (
          <BellOff className="rj-icon" />
        ) : on ? (
          <BellRing className="rj-icon" />
        ) : (
          <Bell className="rj-icon" />
        )}
      </RjIconButton>

      <TelegramSetupDialog
        open={setup}
        onClose={() => setSetup(false)}
        title="Get a Telegram message when it's done"
        intro="Two quick steps, once. Your scan keeps running meanwhile, and every scan after it sends a message too."
        footnote="Once it's connected, you get a message when this scan finishes, and after every scan from then on."
        onChanged={onSaved}
        onConnected={onConnected}
      />
    </>
  );
}

/** The two Telegram setup steps in a dialog, over the page (the scan bell and the Radar's banner). Closes once connected. */
export function TelegramSetupDialog({
  open,
  onClose,
  title,
  intro,
  footnote,
  onChanged,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro: string;
  footnote?: string;
  onChanged: () => Promise<void>;
  onConnected: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="tg-setup-title" placement="bottom">
      <Card className="relative max-h-[90vh] overflow-y-auto p-5 shadow-l3 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="tg-setup-title" className="type-subheading">
              {title}
            </h2>
            <p className="mt-0.5 type-small text-muted">{intro}</p>
          </div>
          <IconButton label="Close" className="-mr-2 -mt-1" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <TelegramAlerts
          footnote={footnote}
          onChanged={onChanged}
          onConnected={() => {
            onConnected();
            onClose();
          }}
        />
      </Card>
    </Dialog>
  );
}

/**
 * After a scan: a Telegram message that couldn't be sent, and what to do. (A sent one is a toast.)
 * Dismiss hides it for this scan; the next scan's result shows again.
 */
export function useNotifyFailedNotice(): Notice | null {
  const running = useScanSelector((s) => s.phase === "running");
  const result = useScanSelector((s) => s.notify?.result);
  const startedAt = useScanSelector((s) => s.startedAt);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = `${startedAt ?? ""}:${result}`;
  if (running || !result || result === "sent" || dismissed === key) return null;
  return { id: "telegram-failed", priority: PRIORITY.telegramFailed, tone: "danger", at: startedAt, render: () => <NotifyFailed result={result} onDismiss={() => setDismissed(key)} /> };
}

function NotifyFailed({ result, onDismiss }: { result: string; onDismiss: () => void }) {
  const reason = result.replace(/^failed: /, "");
  return (
    <Card className="px-4 py-2.5 type-small">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <X className="size-4 shrink-0 text-danger-text max-sm:hidden" aria-hidden />
        <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <span className="text-danger-text">Couldn't send the Telegram message.</span>{" "}
          <span className="text-muted">
            {result === "off" ? "Telegram isn't connected yet." : "Check that Telegram is still connected and send a test message."} Your results are on the Radar either way.
          </span>
        </span>
        <Button size="sm" onClick={toTelegramSettings}>
          {result === "off" ? "Set up Telegram" : "Open Telegram settings"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </p>
      {result !== "off" && (
        <details className="mt-1 type-meta text-muted">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 whitespace-pre-wrap font-mono">{reason}</p>
        </details>
      )}
    </Card>
  );
}
