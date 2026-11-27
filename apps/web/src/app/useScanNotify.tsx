import { useCallback, useEffect, useRef, useState } from "react";
import { telegramReady } from "../components/NotifyWhenDone";
import { toast } from "../components/Toast";
import { telegramStatus, type TelegramStatus } from "../lib/automation";
import { canRunLocally } from "../lib/data";
import { useScanSelector } from "../lib/scanStore";

/** Telegram: with it connected, every scan started here sends a message when it finishes. */
export function useScanNotify(notifyScan: () => Promise<boolean>) {
  // Just these parts of the scan, so the page doesn't re-render on its progress.
  const scanning = useScanSelector((s) => s.phase === "running");
  const total = useScanSelector((s) => s.total);
  const notify = useScanSelector((s) => s.notify);
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
    if (notifyAsked.current || notify?.asked || !total || !telegramReady(tg)) return;
    notifyAsked.current = true;
    setNotifyFailed(false);
    void notifyScan().then((ok) => setNotifyFailed(!ok));
  }, [scanning, total, notify, tg, notifyScan]);
  // A message that went out is a toast; one that didn't stays on the page (NotifyFailed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires when the notify result arrives; `tg` is only read for the bot's name
  useEffect(() => {
    if (!scanning && notify?.result === "sent") toast({ message: <>Sent the results to Telegram{tg?.bot ? <> ({tg.bot})</> : null}.</> });
  }, [scanning, notify?.result]);
  /** Telegram was just connected during a scan: check it again and ask this scan to send its message. */
  const notifyNow = useCallback(() => {
    void refreshTg();
    void notifyScan().then((ok) => setNotifyFailed(!ok));
    notifyAsked.current = true;
  }, [refreshTg, notifyScan]);
  return { tg, notifyFailed, notifyNow, refreshTg };
}
