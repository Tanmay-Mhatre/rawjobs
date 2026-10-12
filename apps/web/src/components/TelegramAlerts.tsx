import { Check, ExternalLink, LoaderCircle, RefreshCw, Send, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { telegramAction, telegramStatus, type TelegramAction, type TelegramStatus } from "../lib/automation";
import { Dialog } from "./Dialog";
import { StatusGlyph } from "./primitives";
import { Button, Card, cx, IconButton, Toggle } from "./ui";

/** What failed, and how to fix it. The raw reason goes under "Technical details" unless it's already plain advice. */
const FAILED: Record<TelegramAction, string> = {
  token: "Couldn't check that token. Copy it again from @BotFather (it looks like 123456789:AAF…) and paste it here.",
  connect: "Couldn't connect to your bot yet. Open it in Telegram, press Start, then try again.",
  test: "Couldn't send the test message. Check your internet connection and try again.",
  on: "Couldn't turn alerts on. Try again.",
  off: "Couldn't turn alerts off. Try again.",
  forget: "Couldn't disconnect the bot. Try again.",
};
/** Server messages that already say what to do: shown as they are. */
const PLAIN = /^(That doesn't look like|No message from you yet|Add your bot token first)/;

type Note = { tone: "ok" | "bad"; text: string; detail?: string; retry?: () => void };

/**
 * Telegram alerts in three steps: make a bot, send it a message, done. Your bot token stays on this
 * computer, never in your settings file.
 */
export function TelegramAlerts({
  onChanged,
  onConnected,
  footnote,
}: {
  onChanged: () => Promise<void>;
  /** Called once the bot is connected (the setup is done). */
  onConnected?: () => void;
  /** Replaces the footnote (what messages you'll get). */
  footnote?: string;
}) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<TelegramAction | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  /** "Disconnect" / "use another bot" can't be undone (the token is gone), so they ask first. */
  const [confirmForget, setConfirmForget] = useState(false);

  const refresh = useCallback(async () => setStatus(await telegramStatus()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (action: TelegramAction, body?: unknown, ok?: (r: { bot?: string; name?: string }) => string) => {
    setBusy(action);
    setNote(null);
    try {
      const r = await telegramAction(action, body);
      if (!r.ok) {
        const plain = !!r.error && PLAIN.test(r.error);
        setNote({
          tone: "bad",
          text: plain ? r.error! : FAILED[action],
          detail: plain ? undefined : r.error,
          // Retrying a token needs the token again, which the user re-submits from the form.
          retry: action === "token" ? undefined : () => void act(action, body, ok),
        });
      } else if (ok) setNote({ tone: "ok", text: ok(r) });
      await refresh();
      if (r.ok && (action === "connect" || action === "on" || action === "off" || action === "forget")) await onChanged();
      if (r.ok && action === "token") setToken("");
      if (r.ok && action === "connect") onConnected?.();
    } finally {
      setBusy(null);
    }
  };

  if (!status)
    return (
      <p className="flex items-center gap-2 type-small text-muted">
        <LoaderCircle className="size-4 animate-spin" /> Checking…
      </p>
    );
  if (status.error)
    return (
      <div className="type-small" role="alert">
        <p className="text-danger-text">Couldn't check your Telegram alerts. Make sure RawJobs is running on this computer, then try again.</p>
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => void refresh()}>
          <RefreshCw className="size-3.5" /> Try again
        </Button>
        <details className="mt-1 type-meta text-muted">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 whitespace-pre-wrap font-mono">{status.error}</p>
        </details>
      </div>
    );

  const spin = (a: TelegramAction) => busy === a && <LoaderCircle className="size-3.5 animate-spin" />;
  const botLink = status.bot ? `https://t.me/${status.bot.replace(/^@/, "")}` : undefined;
  const step = !status.token ? 1 : !status.connected ? 2 : 3;
  const botName = status.bot ?? "your bot";

  return (
    <div className="space-y-4">
      {step < 3 ? (
        <ol className="space-y-3">
          <Step n={1} done={step > 1} title="Make your own bot">
            {step === 1 ? (
              <>
                <p className="type-small text-muted">
                  In Telegram, open{" "}
                  <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2 hover:text-muted">
                    @BotFather <ExternalLink className="inline size-3" />
                  </a>
                  , send <code className="rounded-md bg-inset px-1">/newbot</code>, pick any name, and copy the token it gives you.
                </p>
                <form
                  className="mt-2 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("token", { token }, (r) => `Found your bot ${r.bot}.`);
                  }}
                >
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="123456789:AAF…"
                    aria-label="Bot token from BotFather"
                    className="h-9 min-w-0 flex-1 rounded-md border border-line bg-raised px-3 font-mono type-small"
                  />
                  <Button type="submit" variant="primary" disabled={!token.trim() || !!busy}>
                    {spin("token")} Check token
                  </Button>
                </form>
              </>
            ) : (
              <p className="type-small text-muted">
                Bot {status.bot ?? status.token} ·{" "}
                <button type="button" className="min-h-6 font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={() => setConfirmForget(true)} disabled={!!busy}>
                  use another bot
                </button>
              </p>
            )}
          </Step>
          <Step n={2} done={false} title="Say hi to it" muted={step < 2}>
            {step === 2 && (
              <>
                <p className="type-small text-muted">
                  Open{" "}
                  {botLink ? (
                    <a href={botLink} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2 hover:text-muted">
                      {status.bot} <ExternalLink className="inline size-3" />
                    </a>
                  ) : (
                    "your bot"
                  )}{" "}
                  in Telegram and press <b>Start</b> (or send it any message). That tells RawJobs where to send your alerts.
                </p>
                <Button
                  className="mt-2"
                  variant="primary"
                  onClick={() => void act("connect", undefined, (r) => `Connected. Check Telegram, ${r.name}: a welcome message is waiting.`)}
                  disabled={!!busy}
                >
                  {spin("connect")} I've messaged the bot
                </Button>
              </>
            )}
          </Step>
        </ol>
      ) : (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 type-small">
            <span className="inline-flex items-center gap-2 text-success-text">
              <StatusGlyph shape="full" /> <span className="font-medium text-ink">Connected</span>
            </span>
            New jobs go to {botName} on Telegram.
          </p>
          <Toggle checked={status.enabled} onChange={(on) => void act(on ? "on" : "off")}>
            Send alerts after scheduled scans
          </Toggle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void act("test", undefined, () => "Sent. Check Telegram.")} disabled={!!busy}>
              {busy === "test" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send a test message
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmForget(true)} disabled={!!busy || status.fromEnv}>
              Disconnect
            </Button>
          </div>
        </div>
      )}
      {note && (
        <div role={note.tone === "bad" ? "alert" : "status"} className="type-small">
          <p className={note.tone === "bad" ? "text-danger-text" : "text-success-text"}>{note.text}</p>
          {note.retry && (
            <Button size="sm" variant="ghost" className="mt-1" onClick={note.retry} disabled={!!busy}>
              <RefreshCw className="size-3.5" /> Try again
            </Button>
          )}
          {note.detail && (
            <details className="mt-1 type-meta text-muted">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="mt-1 whitespace-pre-wrap font-mono">{note.detail}</p>
            </details>
          )}
        </div>
      )}
      <p className="type-small text-muted">
        {footnote ?? "One message per scheduled scan, only when there are new jobs for you (best first, up to 10). Scans you start yourself don't send one."} Your bot token is kept on this computer
        only.
      </p>

      <Dialog open={confirmForget} onClose={() => setConfirmForget(false)} labelledBy="tg-forget-title" initialFocus="[data-autofocus]">
        <Card className="p-5 shadow-l3 sm:p-6">
          <div className="flex items-start gap-3">
            <h2 id="tg-forget-title" className="min-w-0 flex-1 type-subheading font-semibold">
              {step === 3 ? "Disconnect Telegram?" : "Use another bot?"}
            </h2>
            <IconButton label="Close" className="-mr-2 -mt-1" onClick={() => setConfirmForget(false)}>
              <X className="size-4" />
            </IconButton>
          </div>
          <p className="mt-1 type-small text-muted">
            {step === 3 ? "Alerts stop, and " : ""}
            {botName}'s token is removed from this computer. To use it again, you'll paste its token from @BotFather again.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmForget(false)} data-autofocus>
              {step === 3 ? "Keep connected" : "Keep this bot"}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmForget(false);
                void act("forget", undefined, () => (step === 3 ? "Disconnected. Telegram alerts are off." : "Removed. Paste the token of the bot you want to use."));
              }}
            >
              {step === 3 ? "Disconnect" : "Remove this bot"}
            </Button>
          </div>
        </Card>
      </Dialog>
    </div>
  );
}

function Step({ n, title, done, muted, children }: { n: number; title: string; done: boolean; muted?: boolean; children?: ReactNode }) {
  return (
    <li className={cx("flex gap-3", muted && "opacity-50")}>
      <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-sm border type-label", done ? "border-ink bg-ink text-raised" : "border-line")}>
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-label">{title}</p>
        {children && <div className="mt-1">{children}</div>}
      </div>
    </li>
  );
}
