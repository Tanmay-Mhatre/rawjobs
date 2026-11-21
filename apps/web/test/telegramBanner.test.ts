import { describe, expect, it } from "vitest";
import { telegramBannerMode } from "../src/components/TelegramBanner";
import type { TelegramStatus } from "../src/lib/automation";

const off: TelegramStatus = { ok: true, token: null, bot: null, connected: false, enabled: false, fromEnv: false };
const now = Date.parse("2026-11-21T10:00:00Z");
const fresh = { notNow: 0, until: 0 };

describe("telegramBannerMode", () => {
  it("shows the full banner when Telegram isn't connected", () => {
    expect(telegramBannerMode(off, fresh, now)).toBe("full");
    // A token without a chat is still not connected.
    expect(telegramBannerMode({ ...off, token: "1:A…", bot: "my_bot" }, fresh, now)).toBe("full");
  });

  it("shows nothing while Telegram is connected, unknown or failed to load", () => {
    expect(telegramBannerMode({ ...off, token: "1:A…", connected: true, enabled: true }, fresh, now)).toBeNull();
    expect(telegramBannerMode(undefined, fresh, now)).toBeNull();
    expect(telegramBannerMode(null, fresh, now)).toBeNull();
    expect(telegramBannerMode({ ...off, ok: false, error: "RawJobs isn't running" }, fresh, now)).toBeNull();
  });

  it("hides after Not now until the snooze ends, then the second time turns quiet", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(telegramBannerMode(off, { notNow: 1, until: now + week }, now)).toBeNull();
    expect(telegramBannerMode(off, { notNow: 1, until: now + week }, now + week)).toBe("full");
    expect(telegramBannerMode(off, { notNow: 2, until: now + week }, now + week)).toBe("slim");
  });

  it("never shows again once the quiet line is closed", () => {
    expect(telegramBannerMode(off, { notNow: 2, until: 0, closed: true }, now)).toBeNull();
  });
});
