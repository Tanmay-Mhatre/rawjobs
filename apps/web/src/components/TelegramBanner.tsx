import { Lock, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { dailySummaryStatus, scheduleStatus, type TelegramStatus } from "../lib/automation";
import { PRIORITY, type Notice } from "../app/notices";
import { load, save } from "../lib/storage";
import { TelegramSetupDialog, telegramReady } from "./NotifyWhenDone";
import { settingsHash } from "./settings/registry";
import { Button } from "./primitives";
import { cx, IconButton } from "./ui";

/** How the Radar's Telegram banner was answered: "Not now" count, hidden until, closed for good. */
export type TelegramBannerState = { notNow: number; until: number; closed?: boolean };
export const TELEGRAM_BANNER_KEY = "rawjobs.telegramBanner.v1";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** How long "Connected" stays before it closes itself. */
const CONNECTED_MS = 8000;

/**
 * What the Radar shows about Telegram: the full banner, the quiet one-line reminder (after "Not now"
 * twice, or once it was connected and later disconnected), or nothing (connected, not known yet,
 * snoozed, or closed for good).
 */
export function telegramBannerMode(tg: TelegramStatus | null | undefined, state: TelegramBannerState, now: number): "full" | "slim" | null {
  if (!tg || tg.error || telegramReady(tg)) return null;
  if (state.closed || now < state.until) return null;
  return state.notNow >= 2 ? "slim" : "full";
}

const INITIAL: TelegramBannerState = { notNow: 0, until: 0 };

/**
 * The Radar's case for Telegram, for people who haven't connected it: what it sends (new jobs, scans
 * finishing, updates, reminders) and that it's two steps. Connect opens the same setup as the scan bell.
 * On phones it starts folded to two lines, so the jobs stay in view. A low notice: it waits for a calm visit.
 */
export function useTelegramNotice({ enabled, tg, onConnected }: { enabled: boolean; tg: TelegramStatus | null | undefined; onConnected: () => Promise<void> }): Notice | null {
  const [state, setState] = useState<TelegramBannerState>(() => load(TELEGRAM_BANNER_KEY, INITIAL));
  const [setup, setSetup] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const mode = telegramBannerMode(tg, state, Date.now());

  useEffect(() => {
    if (!justConnected) return;
    const t = setTimeout(() => setJustConnected(false), CONNECTED_MS);
    return () => clearTimeout(t);
  }, [justConnected]);

  const shows = enabled && (justConnected || !!mode);
  if (!shows && !setup) return null;
  const update = (next: TelegramBannerState) => {
    setState(next);
    save(TELEGRAM_BANNER_KEY, next);
  };
  return {
    id: "telegram-promo",
    priority: PRIORITY.telegramPromo,
    tone: "info",
    render: shows
      ? () => <TelegramBanner mode={justConnected || !mode ? "connected" : mode} state={state} update={update} onSetup={() => setSetup(true)} onCloseConnected={() => setJustConnected(false)} />
      : null,
    dialog: (
      <TelegramSetupDialog
        open={setup}
        onClose={() => setSetup(false)}
        title="Get RawJobs on your phone"
        intro="Two quick steps, once. Then RawJobs can message you when you're away from it."
        footnote="Choose which messages you get in Settings › Notifications."
        onChanged={onConnected}
        onConnected={() => {
          // Disconnecting later brings back the quiet line, not the full banner.
          update({ notNow: Math.max(state.notNow, 2), until: 0 });
          setJustConnected(true);
        }}
      />
    ),
  };
}

function TelegramBanner({
  mode,
  state,
  update,
  onSetup,
  onCloseConnected,
}: {
  mode: "full" | "slim" | "connected";
  state: TelegramBannerState;
  update: (next: TelegramBannerState) => void;
  onSetup: () => void;
  onCloseConnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** Reminders only go out with scheduled scans or the daily summary: true when both are off. */
  const [noReminders, setNoReminders] = useState(false);
  useEffect(() => {
    if (mode !== "full") return;
    let live = true;
    void Promise.all([scheduleStatus(), dailySummaryStatus()]).then(
      ([s, d]) => live && setNoReminders(!s.error && !d.error && !s.installed && !d.installed),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [mode]);

  if (mode === "connected")
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-hairline bg-success-subtle px-4 py-2.5 type-small">
        <span aria-hidden className="size-2 shrink-0 bg-success" />
        <span className="min-w-0 flex-1">
          <b className="font-semibold">Connected.</b> A welcome message is waiting in Telegram.
        </span>
        <IconButton label="Close" className="-my-1 -mr-2" onClick={onCloseConnected}>
          <X className="size-4" />
        </IconButton>
      </div>
    );

  if (mode === "slim")
    return (
      <div className="flex items-center gap-2 type-small text-muted">
        <Send aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0">Get new jobs and reminders on your phone.</span>
        <button type="button" className="min-h-6 shrink-0 font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={onSetup}>
          Connect Telegram
        </button>
        <IconButton label="Don't show this again" className="-my-1 ml-auto" onClick={() => update({ ...state, closed: true })}>
          <X className="size-4" />
        </IconButton>
      </div>
    );

  return (
    <section aria-labelledby="tg-banner-title" className="flex flex-col gap-3 rounded-md border border-hairline bg-raised p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md border border-hairline bg-inset text-ink sm:size-10">
          <Send className="size-4 sm:size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="tg-banner-title" className="type-body font-semibold">
            Get RawJobs on your phone
          </h2>
          <p id="tg-banner-body" className={cx("mt-1 max-w-[68ch] type-small text-muted", !open && "max-sm:line-clamp-2")}>
            Connect Telegram and RawJobs will message you when a scan finds new jobs, when a scan you started finishes, and when an update is ready or required. It can also remind you to follow up,
            prepare for interviews and answer offers in time.
          </p>
          <p className={cx("mt-2 flex items-center gap-1.5 type-meta text-muted", !open && "max-sm:hidden")}>
            <Lock aria-hidden className="size-3 shrink-0" /> Free. Two steps in Telegram. Your bot token stays on this computer.
          </p>
          {noReminders && (
            <p className={cx("mt-3 rounded-md border border-hairline bg-inset px-2.5 py-2 type-small text-muted", !open && "max-sm:hidden")}>
              For reminders, also turn on{" "}
              <a href={`#${settingsHash("schedule")}`} className="font-medium text-ink underline underline-offset-2 hover:text-muted">
                daily scans
              </a>{" "}
              or the{" "}
              <a href={`#${settingsHash("daily")}`} className="font-medium text-ink underline underline-offset-2 hover:text-muted">
                daily summary
              </a>{" "}
              after you connect.
            </p>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="tg-banner-body"
            className="mt-1 min-h-6 type-small font-medium text-ink underline underline-offset-2 hover:text-muted sm:hidden"
            onClick={() => setOpen(!open)}
          >
            {open ? "Show less" : "Read more"}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:shrink-0">
        <Button variant="quiet" onClick={() => update({ notNow: state.notNow + 1, until: Date.now() + SNOOZE_MS })}>
          Not now
        </Button>
        <Button variant="primary" className="max-sm:flex-1" onClick={onSetup}>
          Connect Telegram
        </Button>
      </div>
    </section>
  );
}
