import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createReminder, NETWORK_REMINDER_PATH, type ReminderDeps, reminderMessage } from "../src/network/reminder";
import { createNetworkStore } from "../src/network/store";

const CONNECTIONS = `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ada,Lovelace,https://www.linkedin.com/in/ada-l,,Acme,Engineer,15 Oct 2020
`;
const HOUR = 3_600_000;
const SECRETS = { token: "123456:ABCDEF", chatId: "42" };

function setup(o: { telegram?: boolean; send?: ReminderDeps["send"] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "rawjobs-reminder-"));
  mkdirSync(join(home, "profile"));
  const clock = { t: Date.parse("2026-10-21T09:00:00.000Z") };
  const store = createNetworkStore(home, () => new Date(clock.t));
  const pending: { fn: () => void; ms: number }[] = [];
  const send = vi.fn(o.send ?? (async () => {}));
  const deps: ReminderDeps = {
    now: () => clock.t,
    schedule: (fn, ms) => pending.push({ fn, ms }),
    cancel: () => {},
    telegram: () => (o.telegram === false ? null : SECRETS),
    send,
    log: () => {},
  };
  const make = () => createReminder(home, store, deps);
  return { home, clock, store, pending, send, make, reminder: make(), file: join(home, NETWORK_REMINDER_PATH) };
}

describe("the LinkedIn file reminder", () => {
  it("sets 48 h by default, caps the hours, and clears", () => {
    const s = setup();
    expect(s.reminder.state()).toBeNull();
    expect(s.reminder.set()).toEqual({ at: "2026-10-23T09:00:00.000Z", due: false });
    expect(s.reminder.state()).toEqual({ at: "2026-10-23T09:00:00.000Z", due: false });
    expect(s.reminder.set(1000).at).toBe("2026-10-24T09:00:00.000Z");
    expect(s.reminder.set(24).at).toBe("2026-10-22T09:00:00.000Z");
    s.reminder.clear();
    expect(s.reminder.state()).toBeNull();
    expect(existsSync(s.file)).toBe(false);
  });

  it("fires once when its time comes: due on disk, one Telegram message", async () => {
    const s = setup();
    s.reminder.set(48);
    await s.reminder.check();
    expect(s.send).not.toHaveBeenCalled();
    s.clock.t += 48 * HOUR;
    await s.reminder.check();
    await s.reminder.check();
    expect(s.reminder.state()).toEqual({ at: "2026-10-23T09:00:00.000Z", due: true });
    expect(JSON.parse(readFileSync(s.file, "utf8")).dueAt).toBe("2026-10-23T09:00:00.000Z");
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send.mock.calls[0]).toEqual([reminderMessage(), SECRETS]);
    // Plain copy, nothing about your connections.
    expect(reminderMessage()).toBe(
      "🔗 <b>Your LinkedIn file</b>\n\nLinkedIn's copy of your data should be ready by now.\n\n👉 <i>Add it in RawJobs on your computer to see who you know at your jobs.</i>",
    );
    // A second server (or a restart) never sends it again.
    s.make().resume();
    await s.make().check();
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("waits at most 10 minutes between looks, so a laptop that slept catches up", () => {
    const s = setup();
    s.reminder.set(48);
    expect(s.pending.at(-1)?.ms).toBe(10 * 60_000);
    s.reminder.set(0.1);
    expect(s.pending.at(-1)?.ms).toBe(6 * 60_000);
  });

  it("fires on the next start when RawJobs was off at the time", async () => {
    const s = setup();
    s.reminder.set(48);
    s.reminder.close();
    s.clock.t += 60 * HOUR;
    const next = s.make();
    next.resume();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    expect(next.state()?.due).toBe(true);
  });

  it("sends nothing when Telegram alerts are off, but is still due for the app", async () => {
    const s = setup({ telegram: false });
    s.reminder.set(1);
    s.clock.t += HOUR;
    await s.reminder.check();
    expect(s.send).not.toHaveBeenCalled();
    expect(s.reminder.state()?.due).toBe(true);
  });

  it("stays due once even when Telegram fails", async () => {
    const s = setup({ send: async () => Promise.reject(new Error("offline")) });
    s.reminder.set(1);
    s.clock.t += HOUR;
    await s.reminder.check();
    await s.reminder.check();
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.reminder.state()?.due).toBe(true);
  });

  it("is cancelled by connections imported after it was set (also by the Downloads watch)", async () => {
    const s = setup();
    s.reminder.set(48);
    s.clock.t += HOUR;
    expect((await s.store.import({ connections: CONNECTIONS }, { source: "downloads" })).ok).toBe(true);
    expect(s.reminder.state()).toBeNull();
    expect(existsSync(s.file)).toBe(false);
    s.clock.t += 48 * HOUR;
    await s.reminder.check();
    expect(s.send).not.toHaveBeenCalled();
  });

  it("isn't cancelled by an import from before it was set", async () => {
    const s = setup();
    await s.store.import({ connections: CONNECTIONS }, { source: "file" });
    s.clock.t += HOUR;
    s.reminder.set(48);
    expect(s.reminder.state()).not.toBeNull();
  });
});
