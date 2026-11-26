import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cspReportLine, plainPolicy, policy, scriptHashes, serverPagesPolicy, webPolicy } from "../src/csp";
import { notFoundPage, offlinePage } from "../src/pages";

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

describe("scriptHashes", () => {
  it("hashes each inline script's exact text and skips scripts with src", () => {
    const html = `<head><script>var a=1;</script><script type="module" src="/assets/x.js"></script><script nonce="n">\n  b()\n</script></head>`;
    expect(scriptHashes(html)).toEqual([sha("var a=1;"), sha("\n  b()\n")]);
  });

  it("matches the browser's hash of the dashboard's theme script (apps/web/index.html)", () => {
    const html = readFileSync(resolve(__dirname, "../../../apps/web/index.html"), "utf8");
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(scriptHashes(html)).toEqual([sha(inline)]);
  });
});

describe("policy", () => {
  it("allows only this server's scripts plus the given hashes, and reports to the API", () => {
    const p = policy([sha("x")]);
    expect(p).toContain(`script-src 'self' ${sha("x")}`);
    expect(p).not.toMatch(/unsafe-eval|unsafe-inline'[^;]*script/);
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("connect-src 'self' http://127.0.0.1:* http://localhost:*");
    expect(p).toContain("report-uri /api/csp-report");
    expect(plainPolicy()).toContain("script-src 'self';");
  });

  it("allows the dashboard's inline scripts as built, and nothing for a folder without one", () => {
    const web = mkdtempSync(join(tmpdir(), "rawjobs-csp-"));
    writeFileSync(join(web, "index.html"), "<script>theme()</script><script type=module src=/a.js></script>");
    expect(webPolicy(web)).toContain(sha("theme()"));
    const empty = join(web, "none");
    mkdirSync(empty);
    expect(webPolicy(empty)).toContain("script-src 'self';");
  });

  it("allows every inline script the server's own pages carry, and no other", () => {
    const p = serverPagesPolicy();
    for (const page of [offlinePage({ startLink: true, platform: "win32" }), offlinePage({ startLink: false, platform: "linux" }), notFoundPage("/<script>x()</script>")]) {
      for (const h of scriptHashes(page)) expect(p).toContain(h);
    }
    expect(p).not.toContain(sha("x()"));
  });
});

describe("cspReportLine", () => {
  it("makes one short line from a report", () => {
    const body = JSON.stringify({
      "csp-report": { "document-uri": "http://127.0.0.1:4317/#radar", "blocked-uri": "inline", "effective-directive": "script-src-elem", "source-file": "http://127.0.0.1:4317/", "line-number": 12 },
    });
    expect(cspReportLine(body)).toBe("CSP blocked inline by script-src-elem on / at http://127.0.0.1:4317/:12");
  });

  it("ignores what isn't a report, and keeps a hostile one to a single short line", () => {
    expect(cspReportLine("nope")).toBeNull();
    expect(cspReportLine("{}")).toBeNull();
    const line = cspReportLine(JSON.stringify({ "csp-report": { "blocked-uri": `a\nRawJobs: fake${"x".repeat(500)}` } }))!;
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThanOrEqual(300);
  });
});
