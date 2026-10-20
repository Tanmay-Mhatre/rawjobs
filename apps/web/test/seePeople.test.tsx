// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/Toast", () => ({ toast: vi.fn() }));
import { parseHash } from "../src/app/route";
import { CardPage, OutreachCard } from "../src/components/referral/OutreachCard";
import { PipHost } from "../src/components/referral/PipHost";
import { TalkToSomeone } from "../src/components/referral/TalkToSomeone";
import { copyText } from "../src/lib/clipboard";
import { resetNetworkStore } from "../src/lib/network";
import { nameFromProfile, profileLink, seePeopleHref } from "../src/lib/referralLinks";
import { besideFeatures, type CardJob, cardFeatures, cardHash, type LogInput, type LogResult, logPersonPatch } from "../src/lib/seePeople";
import { makeJob } from "./helpers";

const job = makeJob({ id: "greenhouse:acme:1", company: "Acme", title: "Senior Product Manager", location: "Dubai", url: "https://acme.example/jobs/1" });
const card: CardJob = { id: job.id, title: job.title, company: "Acme", place: "Dubai", url: job.url };
const SCREEN = { availLeft: 100, availTop: 20, availWidth: 1601, availHeight: 900, width: 1700, height: 1000 };
const PEOPLE = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent('"Acme" Senior Product Manager')}`;
const BLOCKED = "Your browser blocked the LinkedIn window. Allow pop-ups for RawJobs, or use the search links.";

/** A real second window for the Picture-in-Picture card; close() fires pagehide as the browser does. */
function pipWindow() {
  const hw = new HappyWindow({ url: "http://localhost/" });
  const win = hw as unknown as Window;
  let closed = false;
  Object.defineProperty(win, "closed", { get: () => closed });
  Object.defineProperty(win, "close", {
    value: () => {
      if (closed) return;
      closed = true;
      win.dispatchEvent(new hw.Event("pagehide") as unknown as Event);
    },
  });
  Object.defineProperty(win, "focus", { value: vi.fn() });
  return win;
}

function setPip(requestWindow: (o: unknown) => Promise<Window>) {
  const api = { requestWindow: vi.fn(requestWindow) };
  Object.defineProperty(window, "documentPictureInPicture", { value: api, configurable: true });
  return api.requestWindow;
}

/** An in-memory BroadcastChannel, shared by every "window" in the test. */
class Bus {
  static all = new Set<Bus>();
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    Bus.all.add(this);
  }
  postMessage(data: unknown) {
    for (const b of Bus.all) if (b !== this && b.name === this.name) queueMicrotask(() => b.onmessage?.({ data } as MessageEvent));
  }
  close() {
    Bus.all.delete(this);
  }
}

const added: LogResult = { ok: true, message: "Added Ada to this job, in To contact." };
function mountPanel(onLog = vi.fn((_: CardJob, _p: LogInput) => added)) {
  render(
    <PipHost onLog={onLog}>
      <TalkToSomeone job={job} onUpdate={vi.fn()} />
    </PipHost>,
  );
  return onLog;
}

beforeEach(() => {
  resetNetworkStore();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status: { connected: false, watch: null }, me: null }))),
  );
  Object.defineProperty(window, "screen", { value: SCREEN, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "documentPictureInPicture");
  Bus.all.clear();
  location.hash = "";
});

describe("See people helpers", () => {
  it("sizes LinkedIn to the left half of the screen, and the popup card to the right edge", () => {
    expect(besideFeatures(SCREEN)).toBe("popup,left=100,top=20,width=800,height=900");
    expect(besideFeatures({ availWidth: 1280, availHeight: 800 })).toBe("popup,left=0,top=0,width=640,height=800");
    expect(cardFeatures(SCREEN)).toBe("popup,left=1321,top=20,width=380,height=560");
  });

  it("routes the popup card with its title and company in the hash, and drops an unsafe link", () => {
    location.hash = cardHash(card);
    expect(location.hash).toMatch(/^#card\/greenhouse%3Aacme%3A1\?/);
    expect(parseHash()).toEqual({ card });
    location.hash = cardHash({ ...card, url: "javascript:alert(1)" });
    expect(parseHash()).toEqual({ card: { ...card, url: undefined } });
    location.hash = "pipeline";
    expect(parseHash()).toEqual({ tab: "pipeline" });
  });

  it("goes to the company's People page when a slug is known, else a people search", () => {
    expect(seePeopleHref({ company: "Acme", title: "Senior Product Manager" })).toBe(PEOPLE);
    expect(seePeopleHref({ company: "Acme", title: "PM", slug: "acme-corp" })).toBe("https://www.linkedin.com/company/acme-corp/people/?keywords=PM");
  });

  it("accepts only /in/ profiles on linkedin.com, cleaned", () => {
    expect(profileLink("linkedin.com/in/ada-lovelace-1a2b?trk=x#top")).toBe("https://www.linkedin.com/in/ada-lovelace-1a2b");
    expect(profileLink("https://uk.linkedin.com/in/ada/")).toBe("https://www.linkedin.com/in/ada");
    for (const bad of ["https://www.linkedin.com/company/acme", "https://www.linkedin.com/in/", "https://evil.com/in/ada", "https://linkedin.com.evil.com/in/ada", "ada lovelace", ""]) {
      expect(profileLink(bad), bad).toBeUndefined();
    }
    expect(nameFromProfile("https://www.linkedin.com/in/ada-lovelace-1a2b3c")).toBe("Ada Lovelace");
  });

  it("logs a person as To contact on LinkedIn, saving an unsaved job, once", () => {
    const { patch, result } = logPersonPatch(undefined, card, { profile: "https://www.linkedin.com/in/ada-lovelace", first: "Ada" });
    const c = patch!.contacts![0]!;
    expect(c).toMatchObject({ name: "Ada", role: "referrer", company: "Acme", linkedin: "https://www.linkedin.com/in/ada-lovelace" });
    expect(patch!.status).toBe("saved");
    expect(patch!.outreach![c.id]).toMatchObject({ stage: "to-contact", via: "linkedin" });
    expect(result).toEqual({ ok: true, message: "Saved this job and added Ada, in To contact." });
    const again = logPersonPatch({ status: "saved", updatedAt: "", contacts: [c] } as never, card, { profile: "linkedin.com/in/ada-lovelace" });
    expect(again).toEqual({ result: { ok: true, message: "Ada is already on this job." } });
    expect(logPersonPatch(undefined, card, { profile: "https://www.linkedin.com/feed/" }).patch).toBeUndefined();
  });

  it("copyText uses the window it's given: its clipboard, else its document", async () => {
    const win = pipWindow();
    const write = vi.fn(async () => {});
    Object.defineProperty(win.navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const own = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: own }, configurable: true });
    expect(await copyText("hello", win)).toBe(true);
    expect(write).toHaveBeenCalledWith("hello");
    expect(own).not.toHaveBeenCalled();

    write.mockRejectedValueOnce(new Error("blocked"));
    const exec = vi.fn(() => true);
    Object.defineProperty(win.document, "execCommand", { value: exec, configurable: true });
    expect(await copyText("again", win)).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });
});

describe("See people at {Company}", () => {
  it("opens only the card in Picture-in-Picture, with the page's styles and theme; Esc closes it and focus returns", async () => {
    const style = document.createElement("style");
    style.textContent = ".rj-test { color: red; }";
    document.head.append(style);
    document.documentElement.dataset.theme = "dark";
    const win = pipWindow();
    const requestWindow = setPip(async () => win);
    const open = vi.spyOn(window, "open");
    mountPanel();
    const button = screen.getByRole("button", { name: "See people at Acme" });
    button.focus();
    fireEvent.click(button);

    const pip = within(win.document.body as unknown as HTMLElement);
    expect(await pip.findByRole("heading", { name: "Senior Product Manager" })).toBeTruthy();
    expect(requestWindow).toHaveBeenCalledWith({ width: 380, height: 560 });
    expect(open).not.toHaveBeenCalled();
    expect(pip.getByText("Acme · Dubai")).toBeTruthy();
    expect(win.document.head.textContent).toContain(".rj-test");
    expect(win.document.documentElement.dataset.theme).toBe("dark");
    // Follows a theme change in RawJobs.
    document.documentElement.dataset.theme = "light";
    window.dispatchEvent(new Event("rawjobs:theme"));
    expect(win.document.documentElement.dataset.theme).toBe("light");

    act(() => {
      win.document.dispatchEvent(new (win as unknown as HappyWindow).KeyboardEvent("keydown", { key: "Escape" }) as unknown as Event);
    });
    expect(win.closed).toBe(true);
    await waitFor(() => expect(pip.queryByRole("heading")).toBeNull());
    expect(document.activeElement).toBe(button);
    style.remove();
  });

  it("clears the card when its window goes (pagehide)", async () => {
    const win = pipWindow();
    setPip(async () => win);
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "See people at Acme" }));
    const pip = within(win.document.body as unknown as HTMLElement);
    await pip.findByRole("heading", { name: "Senior Product Manager" });
    act(() => win.close());
    await waitFor(() => expect(pip.queryByRole("heading")).toBeNull());
  });

  it("shows Open LinkedIn in the panel when Picture-in-Picture refuses, and says when LinkedIn is blocked", async () => {
    setPip(async () => {
      throw new DOMException("No activation", "NotAllowedError");
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "See people at Acme" }));
    const inline = await screen.findByRole("button", { name: "Open LinkedIn" });
    fireEvent.click(inline);
    expect(open).toHaveBeenCalledWith(PEOPLE, "rawjobs-linkedin", "popup,left=100,top=20,width=800,height=900");
    expect(screen.getByText(BLOCKED)).toBeTruthy();
  });

  it("falls back to a small popup routed as #card/<jobId> without Picture-in-Picture", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ closed: false, close: vi.fn() } as unknown as Window);
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "See people at Acme" }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    const [url, name, features] = open.mock.calls[0]!;
    expect(String(url)).toBe(`${location.pathname}${location.search}${cardHash(card)}`);
    expect(name).toBe("rawjobs-card");
    expect(features).toBe("popup,left=1321,top=20,width=380,height=560");
    expect(screen.queryByRole("button", { name: "Open LinkedIn" })).toBeNull();
  });

  it("hides the button on an agency's posting, and outside the app's card host", () => {
    render(
      <PipHost onLog={vi.fn()}>
        <TalkToSomeone job={makeJob({ ats: "bullhorn", company: "Hays", title: "Product Manager" })} onUpdate={vi.fn()} />
      </PipHost>,
    );
    expect(screen.queryByRole("button", { name: /See people at/ })).toBeNull();
    cleanup();
    render(<TalkToSomeone job={job} onUpdate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /See people at/ })).toBeNull();
  });
});

describe("the card", () => {
  const mountCard = (onLog = vi.fn(async (_p: LogInput) => added)) => {
    render(<OutreachCard job={card} win={window} onLog={onLog} />);
    return onLog;
  };

  it("opens LinkedIn beside it on the left half of the screen, cutting the link back", () => {
    const w = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(w);
    mountCard();
    fireEvent.click(screen.getByRole("button", { name: "Open LinkedIn beside this" }));
    expect(open).toHaveBeenCalledWith(PEOPLE, "rawjobs-linkedin", "popup,left=100,top=20,width=800,height=900");
    expect(w.opener).toBeNull();
    expect(screen.getByRole("status").textContent).not.toBe(BLOCKED);
  });

  it("says when the LinkedIn window was blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mountCard();
    fireEvent.click(screen.getByRole("button", { name: "Open LinkedIn beside this" }));
    expect(screen.getByRole("status").textContent).toBe(BLOCKED);
  });

  it("logs a person only from a profile link, with the first name", async () => {
    const onLog = mountCard();
    const link = screen.getByLabelText("Their LinkedIn profile link");
    fireEvent.change(link, { target: { value: "https://www.linkedin.com/company/acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Log this person" }));
    expect(onLog).not.toHaveBeenCalled();
    expect(link.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Paste a profile link like linkedin.com/in/their-name.")).toBeTruthy();

    fireEvent.change(link, { target: { value: "linkedin.com/in/ada-lovelace?trk=x" } });
    expect(link.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(screen.getByLabelText("Their first name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Log this person" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(added.message));
    expect(onLog).toHaveBeenCalledWith({ profile: "https://www.linkedin.com/in/ada-lovelace", first: "Ada" });
  });

  it("fills the connection note with their first name, counts to 200, and copies with the card's window", async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    mountCard();
    fireEvent.change(screen.getByLabelText("Their first name"), { target: { value: "Ada" } });
    const note = screen.getByLabelText("Connection note") as HTMLTextAreaElement;
    expect(note.value).toBe("Hi Ada, I'm applying for the Senior Product Manager role at Acme and would love to hear what it's like on your team. Open to a quick chat?");
    expect(screen.getByText(`${note.value.length} / 200`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy note" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(note.value));
    expect(screen.getByRole("status").textContent).toBe("Copied the note. Paste it into LinkedIn's connection request.");
    fireEvent.click(screen.getByRole("button", { name: "Copy referral ask" }));
    await waitFor(() => expect(write).toHaveBeenLastCalledWith(expect.stringContaining("Would you be open to referring me?")));
  });

  it("in the popup, sends the person to the RawJobs tab over BroadcastChannel, which logs them", async () => {
    vi.stubGlobal("BroadcastChannel", Bus);
    vi.spyOn(window, "open").mockReturnValue({ closed: false, close: vi.fn() } as unknown as Window);
    // The RawJobs tab, with the popup card open for this job.
    const onLog = mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "See people at Acme" }));
    await waitFor(() => expect(Bus.all.size).toBe(1));

    // The popup itself.
    location.hash = cardHash(card);
    const popup = render(<CardPage />);
    const view = within(popup.container);
    fireEvent.change(view.getByLabelText("Their LinkedIn profile link"), { target: { value: "https://www.linkedin.com/in/ada-lovelace" } });
    fireEvent.click(view.getByRole("button", { name: "Log this person" }));
    await waitFor(() => expect(view.getByRole("status").textContent).toBe(added.message));
    expect(onLog).toHaveBeenCalledWith(card, { profile: "https://www.linkedin.com/in/ada-lovelace" });
  });

  it("in the popup, says when the RawJobs tab doesn't answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("BroadcastChannel", Bus);
    location.hash = cardHash(card);
    render(<CardPage />);
    fireEvent.change(screen.getByLabelText("Their LinkedIn profile link"), { target: { value: "https://www.linkedin.com/in/ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Log this person" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(screen.getByRole("status").textContent).toBe("Couldn't reach RawJobs. Keep its tab open, then try again.");
    vi.useRealTimers();
  });
});
