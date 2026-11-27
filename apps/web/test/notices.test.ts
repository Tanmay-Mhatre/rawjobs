import { describe, expect, it } from "vitest";
import { localDay, type Notice, pickNotices, PRIORITY } from "../src/app/notices";

const n = (id: string, priority: number, extra: Partial<Notice> = {}): Notice => ({ id, priority, tone: "info", render: () => id, ...extra });
const TODAY = "2026-11-27";
const calm = { hadUrgent: false };
const ids = (r: ReturnType<typeof pickNotices>) => [r.shown?.id, ...r.more.map((m) => m.id)];

describe("pickNotices", () => {
  it("sorts by priority", () => {
    const r = pickNotices([n("failing", PRIORITY.failingCompanies), null, n("reconnecting", PRIORITY.reconnecting), n("telegram", PRIORITY.telegramFailed)], calm, TODAY, null);
    expect(ids(r)).toEqual(["reconnecting", "telegram", "failing"]);
  });

  it("breaks a tie by the newest, and skips notices with nothing to show", () => {
    const r = pickNotices([n("old", 6, { at: 1 }), n("new", 6, { at: 2 }), n("dialog-only", 1, { render: null })], calm, TODAY, null);
    expect(ids(r)).toEqual(["new", "old"]);
  });

  it("suppresses low items in a session with urgent", () => {
    const low = [n("reminder", PRIORITY.reminder), n("checklist", PRIORITY.checklist)];
    expect(ids(pickNotices([n("missed", PRIORITY.scheduledMissed), ...low], calm, TODAY, null))).toEqual(["missed"]);
    // The urgent one is gone, but it showed in this session: the low ones still wait.
    expect(pickNotices(low, { hadUrgent: true }, TODAY, null).shown).toBeNull();
    // Not urgent (P7-P8) doesn't hold them back.
    expect(ids(pickNotices([n("telegram", PRIORITY.telegramFailed), ...low], calm, TODAY, null))).toEqual(["telegram", "reminder"]);
  });

  it("one low item per day", () => {
    const low = [n("reminder", PRIORITY.reminder), n("checklist", PRIORITY.checklist), n("promo", PRIORITY.telegramPromo)];
    expect(ids(pickNotices(low, calm, TODAY, null))).toEqual(["reminder"]);
    // Today went to the checklist: it stays the one, however many others come up.
    expect(ids(pickNotices(low, calm, TODAY, `${TODAY}|checklist`))).toEqual(["checklist"]);
    // Today's one was dismissed: no other low notice until tomorrow.
    expect(pickNotices(low.slice(0, 1), calm, TODAY, `${TODAY}|checklist`).shown).toBeNull();
    // Another day: a new one may show.
    expect(ids(pickNotices(low, calm, TODAY, "2026-11-26|checklist"))).toEqual(["reminder"]);
  });

  it("names the local day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
  });
});
