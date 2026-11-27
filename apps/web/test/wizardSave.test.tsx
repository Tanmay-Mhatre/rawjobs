// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, type Draft, type SaveResult } from "../src/lib/setup";

const saveConfig = vi.fn(async (_config: unknown): Promise<SaveResult> => ({ ok: true, path: "rawjobs.config.local.yaml" }));
vi.mock("../src/lib/setup", async (orig) => ({ ...(await orig<typeof import("../src/lib/setup")>()), saveConfig: (c: unknown) => saveConfig(c) }));
vi.mock("../src/lib/data", async (orig) => ({ ...(await orig<typeof import("../src/lib/data")>()), canRunLocally: true }));

const { Review } = await import("../src/setup/Wizard");

const draft: Draft = { ...emptyDraft(), include: ["product manager"], places: ["dubai"], remote: true, minScore: 70 };
const renderReview = () =>
  render(<Review draft={draft} update={vi.fn()} goStep={vi.fn()} startScan={vi.fn(async () => {})} onSaved={vi.fn(async () => {})} onFinish={vi.fn()} hasResume={false} footer={(p) => p} />);
const save = () => fireEvent.click(screen.getByRole("button", { name: /Save and scan|Start scanning|Save/ }));

beforeEach(() => saveConfig.mockReset());
afterEach(cleanup);

describe("Wizard save errors", () => {
  it("fetch rejects → Couldn't reach RawJobs, with Try again that saves again", async () => {
    saveConfig.mockResolvedValue({ ok: false, errors: "Failed to fetch", issues: [], cause: "offline" });
    renderReview();
    save();
    expect(await screen.findByText(/^Couldn't reach RawJobs to save your setup\. Your answers are kept in this browser\./)).toBeTruthy();
    expect(screen.queryByText(/Check the steps above/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(2));
  });

  it("a server failure offers Try again and Copy details, without blaming the steps", async () => {
    saveConfig.mockResolvedValue({ ok: false, errors: "HTTP 500", issues: [], cause: "server" });
    renderReview();
    save();
    expect(await screen.findByText(/^RawJobs couldn't save your setup\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeTruthy();
  });

  it("{ok:false, errors} from the server's check keeps the old copy, with no Try again", async () => {
    saveConfig.mockResolvedValue({ ok: false, errors: "titles: required", issues: [] });
    renderReview();
    save();
    expect(await screen.findByText("Couldn't save your setup. Check the steps above, then try again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText("titles: required")).toBeTruthy();
  });
});
