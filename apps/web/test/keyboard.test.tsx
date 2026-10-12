// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pipeline } from "../src/components/Pipeline";
import { RadarPage } from "../src/components/radar/RadarPage";
import type { DataMeta, Job, Profile } from "../src/lib/data";
import { DEFAULT_FILTERS } from "../src/lib/filters";
import { GO_TO_MS, ignoreShortcut, useGoToKeys, type GoToSection } from "../src/lib/keys";
import type { UserState } from "../src/lib/userState";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const job = (o: Partial<Job> = {}): Job => ({
  id: "a",
  ats: "greenhouse",
  company: "Acme",
  title: "Senior Product Manager",
  location: "Dubai",
  workplace: "onsite",
  url: "https://acme.example/jobs/1",
  firstSeen: new Date(Date.now() - 86_400_000).toISOString(),
  lastSeen: new Date().toISOString(),
  postedAt: new Date(Date.now() - 86_400_000).toISOString(),
  status: "open",
  score: 75,
  why: { title: 30, location: 20, keywords: [], keywordPoints: 0, freshness: 10 },
  countries: ["United Arab Emirates"],
  cities: ["Dubai, United Arab Emirates"],
  seniority: "senior",
  group: `Acme|${o.id ?? "a"}`,
  hasDescription: false,
  ...o,
});

describe("ignoreShortcut", () => {
  const key = (target: EventTarget | null, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey", boolean>> = {}) => ({ metaKey: false, ctrlKey: false, altKey: false, target, ...mods });

  it("lets plain keys on the page through", () => {
    expect(ignoreShortcut(key(document.body))).toBe(false);
    expect(ignoreShortcut(key(document.createElement("button")))).toBe(false);
  });

  it("ignores keys typed into fields and editable text", () => {
    for (const tag of ["input", "textarea", "select"]) expect(ignoreShortcut(key(document.createElement(tag)))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.append(inner);
    document.body.append(editable);
    expect(ignoreShortcut(key(inner))).toBe(true);
    editable.remove();
  });

  it("ignores keys with Ctrl, Cmd or Alt held", () => {
    expect(ignoreShortcut(key(document.body, { ctrlKey: true }))).toBe(true);
    expect(ignoreShortcut(key(document.body, { metaKey: true }))).toBe(true);
    expect(ignoreShortcut(key(document.body, { altKey: true }))).toBe(true);
  });
});

describe("Pipeline [ / ] moves (design/components/Pipeline)", () => {
  const j = job();
  function Harness({ onMove }: { onMove?: (status: string) => void }) {
    const [user, setUser] = useState<UserState>({
      a: { status: "saved", updatedAt: new Date().toISOString(), snapshot: { title: j.title, company: j.company, url: j.url, location: j.location, score: j.score } },
    });
    return (
      <Pipeline
        user={user}
        jobsById={new Map([[j.id, j]])}
        min={65}
        onOpen={() => {}}
        onMove={(id, entry, status) => {
          onMove?.(status);
          setUser((u) => ({ ...u, [id]: { ...entry, status } }));
        }}
        goRadar={() => {}}
      />
    );
  }
  const title = () => screen.getByRole("button", { name: j.title });
  const column = (name: string) => screen.getByRole("heading", { name: new RegExp(`^${name}`) }).closest("section")!;

  it("describes the keys on the card title", () => {
    render(<Harness />);
    expect(title().getAttribute("aria-describedby")).toBe("pipeline-move-help");
    expect(document.getElementById("pipeline-move-help")?.textContent).toBe("Press [ or ] to move this job to the previous or next stage.");
  });

  it("] moves the focused card to the next column, announces it, and keeps focus on it", async () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const u = userEvent.setup();
    title().focus();
    await u.keyboard("]");
    expect(onMove).toHaveBeenCalledWith("applied");
    expect(column("Applied").contains(title())).toBe(true);
    expect(document.activeElement).toBe(title());
    expect(screen.getByRole("status").textContent).toBe(`Moved ${j.title} to Applied`);

    await u.keyboard("[["); // "[[" is a literal [ in user-event
    expect(column("Saved").contains(title())).toBe(true);
    expect(document.activeElement).toBe(title());
    expect(screen.getByRole("status").textContent).toBe(`Moved ${j.title} to Saved`);
  });

  it("stops at the first column and ignores modifier keys", async () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const u = userEvent.setup();
    title().focus();
    await u.keyboard("[[");
    await u.keyboard("{Control>}]{/Control}");
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

const profile = {
  name: "Me",
  titles: { include: ["product manager"], exclude: [] },
  seniority_boost: [],
  locations: { include: ["Dubai"], remote_ok: [], remote_exclude: [], workplace: [] },
  industries: [],
  past_employers: [],
  keywords: {},
  min_score: 65,
} as unknown as Profile;
const meta = { version: 1, generatedAt: new Date().toISOString(), profile, companies: [], runs: [] } as DataMeta;
const noop = () => {};
const renderRadar = (onStatus: (job: Job, status: string) => void = noop, extra: ReactNode = null) =>
  render(
    <>
      {extra}
      <RadarPage
        jobs={[job({ id: "a" }), job({ id: "b", company: "Beta", score: 40 })]}
        meta={meta}
        user={{}}
        prefs={{ views: [], hiddenCompanies: [], hideRules: [] }}
        onOpenOverlay={noop}
        overlayOpen={false}
        onStatus={onStatus}
        onUpdate={noop}
        onApply={noop}
        onSaveView={() => ({ id: "v", name: "", filters: DEFAULT_FILTERS, sort: "best" })}
        onRenameView={noop}
        onDeleteView={noop}
        onRestoreView={noop}
        onHideCompany={noop}
        onSetRule={noop}
        isYours={() => false}
        companyCount={0}
        onCompanies={noop}
        onEditProfile={noop}
      />
    </>,
  );
describe("Radar 1-6 pick the views", () => {
  const selectedTab = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent ?? "";

  it("each number picks the view in its tab position (first scan: no New view)", () => {
    renderRadar();
    expect(selectedTab()).toMatch(/^All/);
    act(() => void fireEvent.keyDown(window, { key: "3" }));
    expect(selectedTab()).toMatch(/^Strong/);
    act(() => void fireEvent.keyDown(window, { key: "1" }));
    expect(selectedTab()).toMatch(/^All/);
  });

  it("not while typing in search", () => {
    renderRadar();
    const search = screen.getByRole("searchbox", { name: "Search jobs" });
    act(() => void fireEvent.keyDown(search, { key: "3" }));
    expect(selectedTab()).toMatch(/^All/);
  });
});

describe("g then a letter goes to a section", () => {
  const GoTo = ({ onGo, canGo = () => true }: { onGo: (s: GoToSection) => void; canGo?: () => boolean }) => {
    useGoToKeys(onGo, canGo);
    return null;
  };
  const press = (key: string, target: EventTarget = window) => act(() => void fireEvent.keyDown(target, { key }));
  afterEach(() => vi.useRealTimers());

  it("g r, g p, g c and g s go to Radar, Pipeline, Companies and Settings", () => {
    const onGo = vi.fn();
    render(<GoTo onGo={onGo} />);
    for (const k of ["r", "p", "c", "s"]) {
      press("g");
      press(k);
    }
    expect(onGo.mock.calls.map((c) => c[0])).toEqual(["radar", "pipeline", "companies", "settings"]);
  });

  it("a letter without g, or after the window closes, does nothing", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const onGo = vi.fn();
    render(<GoTo onGo={onGo} />);
    press("s");
    press("g");
    vi.setSystemTime(Date.now() + GO_TO_MS + 1);
    press("s");
    press("g");
    press("j");
    press("s");
    expect(onGo).not.toHaveBeenCalled();
  });

  it("not while typing, with Ctrl held, or when canGo says no", () => {
    const onGo = vi.fn();
    let allowed = true;
    render(<GoTo onGo={onGo} canGo={() => allowed} />);
    const input = document.createElement("input");
    document.body.append(input);
    press("g", input);
    press("s", input);
    press("g");
    act(() => void fireEvent.keyDown(window, { key: "s", ctrlKey: true }));
    allowed = false;
    press("g");
    press("s");
    input.remove();
    expect(onGo).not.toHaveBeenCalled();
  });

  it("on the Radar, g s goes to Settings without also saving the selected job", () => {
    const onGo = vi.fn();
    const onStatus = vi.fn();
    renderRadar(onStatus, <GoTo onGo={onGo} />);
    press("g");
    press("s");
    expect(onGo).toHaveBeenCalledWith("settings");
    expect(onStatus).not.toHaveBeenCalled();
    press("s");
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "saved");
  });
});
