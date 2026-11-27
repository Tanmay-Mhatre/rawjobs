import { describe, expect, it } from "vitest";
import { lintText, RULES, SITE_RULES } from "./lint";

const rules = (line: string) => lintText(line, "x.tsx").map((f) => f.rule);

describe("design lint", () => {
  it("flags colors that bypass the tokens", () => {
    expect(rules(`<div className="bg-blue-500 text-white" />`)).toEqual(["palette"]);
    expect(rules(`color: #ff5a1f;`)).toEqual(["hex"]);
    expect(rules(`background: rgb(0 0 0 / 0.35);`)).toEqual(["color-fn"]);
    expect(rules(`var(--sand-11)`)).toEqual(["primitive"]);
  });

  it("flags solid fills used as text, but not their -text variants", () => {
    expect(rules(`className="text-danger hover:text-success"`)).toEqual(["solid-text"]);
    expect(rules(`className="text-success-text text-danger-text text-warning-text"`)).toEqual([]);
  });

  it("flags pre-RawJobs names and Tailwind sizes, radii and shadows that no longer exist", () => {
    expect(rules(`className="bg-surface-2 text-fg border-line-strong"`)).toEqual(["old-color"]);
    expect(rules(`className="text-sm font-medium"`)).toEqual(["text-size"]);
    expect(rules(`className="rounded-xl shadow-lg"`)).toEqual(["radius", "shadow"]);
    expect(rules(`className="rounded-md rounded-dot shadow-l2 type-label text-muted bg-raised"`)).toEqual([]);
  });

  it("keeps orange to its four jobs: no accent fills, borders, text or checkbox colors in app code", () => {
    expect(rules(`className="border-accent bg-accent-subtle text-accent-text"`)).toEqual(["accent"]);
    expect(rules(`className="hover:bg-accent text-on-accent"`)).toEqual(["accent"]);
    expect(rules(`className="size-4 accent-accent"`)).toEqual(["accent"]);
    expect(rules(`className="size-4 accent-ink bg-ink text-raised border-control"`)).toEqual([]);
  });

  it("allows uppercase nowhere (source tags get theirs from rj-source)", () => {
    expect(rules(`className="type-meta font-semibold uppercase tracking-wide"`)).toEqual(["uppercase"]);
    expect(rules(`className="sm:uppercase"`)).toEqual(["uppercase"]);
    expect(rules(`const t = name.toUpperCase(); className="normal-case"`)).toEqual([]);
  });

  it("leaves URLs, hash routes and opted-out lines alone", () => {
    expect(rules(`href="#add" href="#/radar" "https://x.test/#abc"`)).toEqual([]);
    expect(rules(`fill="#151412" // design-lint-ignore: logo asset`)).toEqual([]);
    expect(rules(`{/* design-lint-ignore-next-line: disabled */}\n<b className="opacity-50" />\n<i className="opacity-50" />`)).toEqual(["opacity-text"]);
  });

  it("keeps z-index and durations on the tokens", () => {
    expect(rules(`className="sticky top-0 z-30"`)).toEqual(["z-raw"]);
    expect(rules(`className="fixed z-[70]"`)).toEqual(["z-raw"]);
    expect(rules(`className="transition duration-150"`)).toEqual(["duration-raw"]);
    expect(rules(`className="transition-[opacity] duration-[250ms]"`)).toEqual(["duration-raw"]);
    expect(rules(`className="sticky z-sticky md:z-menu transition duration-quick duration-base ease-enter"`)).toEqual([]);
  });

  it("lets the type style set the weight", () => {
    expect(rules(`<h2 className="type-subheading font-semibold">`)).toEqual(["weight-override"]);
    expect(rules(`<h1 className="type-heading tracking-tight font-medium">`)).toEqual(["weight-override"]);
    expect(rules(`<h2 className="type-title">`)).toEqual([]);
    expect(rules(`<p className="type-label font-medium">`)).toEqual([]);
  });

  it("keeps buttons on the design system's variant names", () => {
    expect(rules(`<Button variant="outline">`)).toEqual(["old-button"]);
    expect(rules(`<Button size="sm" variant="ghost" onClick={close}>`)).toEqual(["old-button"]);
    expect(rules(`<Button variant={done ? "ghost" : "primary"}>`)).toEqual(["old-button"]);
    expect(rules(`<Button variant="quiet">`)).toEqual([]);
    expect(rules(`<Button variant={done ? "quiet" : "secondary"}>`)).toEqual([]);
  });

  it("flags opacity used to mute text, but not 0, 90 or 100", () => {
    expect(rules(`className={cx("rj-row", muted && "opacity-60")}`)).toEqual(["opacity-text"]);
    expect(rules(`className="disabled:opacity-40"`)).toEqual(["opacity-text"]);
    expect(rules(`className="opacity-0 group-hover:opacity-100 opacity-90"`)).toEqual([]);
  });

  it("checks the marketing site's plain CSS for accent, durations and px type", () => {
    const site = (line: string) => lintText(line, "index.html", [...RULES, ...SITE_RULES]).map((f) => f.rule);
    expect(site(`.token { background: var(--accent-solid); color: var(--on-accent); }`)).toEqual(["site-accent"]);
    expect(site(`.st { color: var(--accent-mark); } .cursor { background: var(--brand-signal); }`)).toEqual([]);
    expect(site(`.x { animation: rise 520ms var(--ease-enter); }`)).toEqual(["site-duration"]);
    expect(site(`.x { animation: rise var(--duration-slow) var(--ease-enter); animation-delay: calc(var(--i) * 40ms); }`)).toEqual([]);
    expect(site(`.x { font: 600 44px/1.1 var(--font-sans); }`)).toEqual(["site-font-px"]);
    expect(site(`.x { font: var(--text-section); letter-spacing: -0.03em; }`)).toEqual([]);
    expect(site(`.x { text-transform: uppercase; }`)).toEqual(["uppercase"]);
  });
});
