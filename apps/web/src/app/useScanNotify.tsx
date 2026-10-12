import { useCallback, useEffect, useRef, useState } from "react";
import { telegramReady } from "../components/NotifyWhenDone";
import { toast } from "../components/Toast";
import { telegramStatus, type TelegramStatus } from "../lib/automation";
import { canRunLocally } from "../lib/data";
import type { ScanState } from "../lib/scan";

/** Telegram: with it connected, every scan started here sends a message when it finishes. */
export function useScanNotify(scan: ScanState, notifyScan: () => Promise<boolean>) {
  const scanning = scan.phase === "running";
  /** undefined: not asked yet (or can't run scans here) · null: couldn't tell. */
  const [tg, setTg] = useState<TelegramStatus | null | undefined>(undefined);
  const refreshTg = useCallback(async () => setTg(await telegramStatus().catch(() => null)), []);
  // Checked again as each scan starts: it may have been set up in Settings since.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rechecks Telegram when a scan starts (or before the first check); a new `tg` value must not trigger it
  useEffect(() => {
    if (canRunLocally && (scanning || tg === undefined)) void refreshTg();
  }, [scanning, refreshTg]);
  const [notifyFailed, setNotifyFailed] = useState(false);
  const notifyAsked = useRef(false);
  useEffect(() => {
    if (!scanning) {
      notifyAsked.current = false;
      return;
    }
    // After the "start" event: the scan clears any earlier request just before it starts.
    if (notifyAsked.current || scan.notify?.asked || !scan.total || !telegramReady(tg)) return;
    notifyAsked.current = true;
    setNotifyFailed(false);
    void notifyScan().then((ok) => setNotifyFailed(!ok));
  }, [scanning, scan.total, scan.notify, tg, notifyScan]);
  // A message that went out is a toast; one that didn't stays on the page (NotifyFailed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires when the notify result arrives; `tg` is only read for the bot's name
  useEffect(() => {
    if (!scanning && scan.notify?.result === "sent") toast({ message: <>Sent the results to Telegram{tg?.bot ? <> ({tg.bot})</> : null}.</> });
  }, [scanning, scan.notify?.result]);
  /** Telegram was just connected during a scan: check it again and ask this scan to send its message. */
  const notifyNow = useCallback(() => {
    void refreshTg();
    void notifyScan().then((ok) => setNotifyFailed(!ok));
    notifyAsked.current = true;
  }, [refreshTg, notifyScan]);
  return { tg, notifyFailed, notifyNow };
}
