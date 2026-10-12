import { appPlace, desktopScene, logPath, SCENE_CSS, sleepScene, WINDOW_CSS } from "@rawjobs/server/pages";
import { Copy, Power, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openStartLink, type ServerHealth } from "../lib/update";
import { Dialog } from "./Dialog";
import { toast } from "./Toast";
import { Button, Card } from "./ui";

/** Starting takes up to 20 s (as `rawjobs open` waits); after that, it didn't come back. */
const START_TIMEOUT_MS = 20_000;
/** "RawJobs is back" stays this long before the page reloads, so you see why it does. */
const BACK_MS = 900;

type Phase = "asleep" | "starting" | "back" | "stuck";

const CHECK = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/**
 * "RawJobs isn't running": shown once the server hasn't answered for a while (ServerNotices), until
 * it's back, then the page reloads. One way back at a time:
 *   - the Start button, when the installer registered rawjobs://open (it runs what the Desktop
 *     shortcut runs); the shortcut is offered only if the button didn't bring RawJobs back;
 *   - otherwise the Desktop shortcut, shown as a picture of what to do.
 * The pictures and their motion are shared with the offline page (packages/server/src/pages.ts).
 */
export function ServerDownWindow({ health }: { health: ServerHealth }) {
  const { down, startLink, platform, setFast } = health;
  const [phase, setPhase] = useState<Phase>("asleep");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Back: the steps tick off, then the page reloads with fresh data on the same tab.
  useEffect(() => {
    if (down) return;
    clearTimeout(timer.current);
    setPhase("back");
    setFast(false);
    const t = setTimeout(() => location.reload(), BACK_MS);
    return () => clearTimeout(t);
  }, [down, setFast]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const start = () => {
    setPhase("starting");
    setFast(true);
    openStartLink();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPhase("stuck");
      setFast(false);
    }, START_TIMEOUT_MS);
  };

  const scene = phase === "back" ? "awake" : phase === "starting" ? "waking" : "asleep";
  const picture = startLink || phase === "back" ? sleepScene() : desktopScene(platform);
  const title = phase === "starting" ? "Starting RawJobs…" : phase === "back" ? "RawJobs is back" : phase === "stuck" ? "RawJobs still isn't running" : "RawJobs isn't running";
  const place = appPlace(platform);

  return (
    <Dialog open persistent onClose={() => {}} labelledBy="server-down-title" describedBy="server-down-body">
      <style>{SCENE_CSS + WINDOW_CSS}</style>
      <Card className="overflow-hidden p-0 shadow-l3">
        {/* The picture is decorative: everything it shows is said in the text. Its markup is our own
            constant (pages.ts), shared with the offline page, never anything from outside. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: fixed markup from pages.ts, no input in it */}
        <div className="rjd-hero" data-p={scene} aria-hidden dangerouslySetInnerHTML={{ __html: picture }} />
        <div className="p-5 sm:p-6">
          <h2 id="server-down-title" key={title} className="rjd-title type-subheading font-semibold text-balance">
            {title}
          </h2>
          <p id="server-down-body" className="mt-1.5 type-small text-ink">
            {phase === "starting"
              ? "A few seconds. You don't need to do anything."
              : phase === "back"
                ? "Taking you back to where you were…"
                : startLink
                  ? "Your jobs, notes and settings are safe. Start it again and this page picks up where you left off."
                  : `Your jobs, notes and settings are safe. Double-click RawJobs on your Desktop to start it. ${place} This page picks up where you left off.`}
          </p>

          {phase === "starting" || phase === "back" ? (
            <ol className="rjd-steps" aria-label="Progress">
              <li data-s={phase === "back" ? "done" : "doing"}>
                <b>{CHECK}</b>Starting RawJobs
              </li>
              <li data-s={phase === "back" ? "done" : undefined}>
                <b>{CHECK}</b>Loading your jobs
              </li>
              <li data-s={phase === "back" ? "doing" : undefined}>
                <b>{CHECK}</b>Back to where you were
              </li>
            </ol>
          ) : !startLink ? (
            <div className="mt-4 flex items-center gap-2.5 type-small text-muted" role="status">
              <span className="rj-skel w-12 shrink-0" style={{ height: 6 }} />
              {platform === "win32" ? "Waiting for RawJobs. On Windows it also comes back by itself within a minute." : "Waiting for RawJobs…"}
            </div>
          ) : platform === "win32" && phase === "asleep" ? (
            <p className="mt-3 type-small text-muted">On Windows it also comes back by itself within a minute.</p>
          ) : null}

          {phase === "stuck" && (
            <div className="rjd-fallback" role="status">
              <b aria-hidden />
              <p className="type-small text-ink">
                <b className="font-semibold">Didn't open?</b> Double-click RawJobs on your Desktop instead. {place}
              </p>
            </div>
          )}

          {startLink && (
            <div className="mt-5 flex justify-end">
              <button type="button" className="rjd-cta" data-p={phase} onClick={phase === "asleep" || phase === "stuck" ? start : undefined} aria-live="polite">
                <i aria-hidden />
                <span key={phase}>
                  {phase === "starting" ? (
                    "Starting…"
                  ) : phase === "back" ? (
                    <>{CHECK}RawJobs is back</>
                  ) : phase === "stuck" ? (
                    <>
                      <RotateCcw aria-hidden />
                      Try again
                    </>
                  ) : (
                    <>
                      <Power aria-hidden />
                      Start RawJobs
                    </>
                  )}
                </span>
              </button>
            </div>
          )}
          {phase === "starting" && startLink && <p className="mt-2 text-right type-meta text-muted">If your browser asks, choose Open RawJobs.</p>}

          {(phase === "asleep" || phase === "stuck") && <Details platform={platform} />}
        </div>
      </Card>
    </Dialog>
  );
}

function Details({ platform }: { platform: string | null }) {
  const log = logPath(platform);
  return (
    <details className="mt-4 type-small">
      <summary className="cursor-pointer text-muted">Technical details</summary>
      <div className="mt-2 space-y-1.5 rounded-md bg-inset px-3 py-2">
        <p>
          From a terminal: <code className="font-mono type-meta">rawjobs open</code>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span>If it doesn't start, its log says why:</span>
          <code className="min-w-0 break-all font-mono type-meta">{log}</code>
          <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(log).then(() => toast({ message: "Copied the log's location" }))}>
            <Copy className="size-3.5" /> Copy
          </Button>
        </div>
      </div>
    </details>
  );
}
