// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/pipeline/Composer";

afterEach(cleanup);

const now = new Date("2026-10-20T15:00:00");
const contacts = [{ id: "p1", name: "Priya" }];

describe("Composer", () => {
  it("logs a sent email with the next follow-up in 7 days, and says so", () => {
    const onLog = vi.fn();
    const onAnnounce = vi.fn();
    render(<Composer contacts={contacts} onLog={onLog} onAnnounce={onAnnounce} now={now} initial={{ contactId: "p1", followUp: true }} />);
    fireEvent.change(screen.getByLabelText("What was said"), { target: { value: "  Following up  " } });
    fireEvent.click(screen.getByRole("button", { name: "Log email" }));
    expect(onLog).toHaveBeenCalledTimes(1);
    const [activity, opts] = onLog.mock.calls[0]!;
    expect(activity).toMatchObject({ channel: "email", dir: "sent", contactId: "p1", text: "Following up", followUp: true, at: now.toISOString() });
    expect(opts).toEqual({ followUpDays: 7 });
    expect(onAnnounce.mock.calls[0]![0]).toMatch(/^Logged email\. Next follow-up \D*27\D*\.$/);
  });

  it("logs a received touch with no follow-up, and a note with no direction", () => {
    const onLog = vi.fn();
    render(<Composer contacts={contacts} onLog={onLog} now={now} hasFollowUp />);
    fireEvent.click(screen.getByRole("radio", { name: "Received" }));
    expect(screen.getByText("Logging a reply clears the follow-up date.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log email" }));
    expect(onLog.mock.calls[0]![0]).toMatchObject({ channel: "email", dir: "received" });
    expect(onLog.mock.calls[0]![1]).toEqual({ followUpDays: undefined });

    fireEvent.click(screen.getByRole("radio", { name: "Note" }));
    expect(screen.queryByRole("radio", { name: "Sent" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(onLog.mock.calls[1]![0].dir).toBeUndefined();
  });

  it("moves through channels with arrow keys and logs with Ctrl+Enter", () => {
    const onLog = vi.fn();
    render(<Composer contacts={contacts} onLog={onLog} now={now} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Email" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "LinkedIn" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByLabelText("What was said"), { key: "Enter", ctrlKey: true });
    expect(onLog.mock.calls[0]![0]).toMatchObject({ channel: "linkedin" });
  });
});
