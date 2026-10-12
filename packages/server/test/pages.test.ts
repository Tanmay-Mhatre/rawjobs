import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { appPlace, desktopScene, notFoundPage, offlinePage, sectionRedirect } from "../src/pages";
import { servePages } from "../src/static";

describe("sectionRedirect", () => {
  it("sends a section named as a path to its #hash", () => {
    expect(sectionRedirect("/radar")).toBe("/#radar");
    expect(sectionRedirect("/Settings/")).toBe("/#settings");
    expect(sectionRedirect("/pipeline")).toBe("/#pipeline");
  });

  it("leaves everything else to the 404 page", () => {
    expect(sectionRedirect("/jobs/saved")).toBeNull();
    expect(sectionRedirect("/radar/x")).toBeNull();
    expect(sectionRedirect("/")).toBeNull();
  });
});

describe("the pages", () => {
  it("names the wrong address on the 404 page, escaped, with one way back", () => {
    const html = notFoundPage('/<script>alert("x")</script>');
    expect(html).toContain("No match for this address");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('href="/#radar"');
  });

  it("offers one way back at a time on the offline page", () => {
    const withLink = offlinePage({ startLink: true, platform: "win32" });
    expect(withLink).toContain("Start RawJobs");
    expect(withLink).toContain("rawjobs://open");
    // The Desktop shortcut only as the fallback, hidden until the button didn't work.
    expect(withLink).toContain('class="fallback"');
    expect(withLink).not.toContain('class="rjd-desk');

    const without = offlinePage({ startLink: false, platform: "darwin" });
    expect(without).not.toContain('id="start"');
    expect(without).toContain("Double-click RawJobs on your Desktop");
    expect(without).toContain("rjd-desk mac");
  });

  it("says where apps are in the computer's own words", () => {
    expect(appPlace("win32")).toMatch(/Start menu/);
    expect(appPlace("darwin")).toMatch(/Applications/);
    expect(appPlace("linux")).toMatch(/app menu/);
    expect(desktopScene("linux")).toContain("rjd-taskbar");
  });
});

describe("servePages", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function start(startLink = true) {
    server = createServer((rq, rs) => servePages(rq, rs, { startLink: () => startLink, platform: "win32" }));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return (server!.address() as AddressInfo).port;
  }

  function get(port: number, path: string, accept = "text/html", method = "GET") {
    return new Promise<{ status: number; headers: IncomingMessage["headers"]; text: string }>((done, fail) => {
      const r = request({ host: "127.0.0.1", port, method, path, headers: { accept } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => done({ status: res.statusCode!, headers: res.headers, text }));
      });
      r.on("error", fail);
      r.end();
    });
  }

  it("serves the service worker and the page it keeps, never cached", async () => {
    const port = await start();
    const sw = await get(port, "/sw.js", "*/*");
    expect(sw.status).toBe(200);
    expect(sw.headers["content-type"]).toMatch(/javascript/);
    expect(sw.headers["cache-control"]).toBe("no-store");
    expect(sw.text).toContain("/offline.html");
    const page = await get(port, "/offline.html");
    expect(page.status).toBe(200);
    expect(page.text).toContain("RawJobs isn't running");
    expect(page.headers["x-frame-options"]).toBe("DENY");
  });

  it("follows whether the Start link is installed", async () => {
    const port = await start(false);
    expect((await get(port, "/offline.html")).text).not.toContain('id="start"');
  });

  it("redirects a section path to its hash", async () => {
    const port = await start();
    const r = await get(port, "/radar");
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("/#radar");
  });

  it("shows the 404 page to a browser, and a plain 404 to everything else", async () => {
    const port = await start();
    const page = await get(port, "/jobs%20saved");
    expect(page.status).toBe(404);
    expect(page.text).toContain("/jobs saved");
    const script = await get(port, "/assets/missing.js", "*/*");
    expect(script.status).toBe(404);
    expect(script.text).toBe("Not found");
    const post = await get(port, "/radar", "text/html", "POST");
    expect(post.status).toBe(404);
    expect(post.text).toBe("Not found");
  });
});
