import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { careersLinks, findBoards, urlsInHtml } from "../src/catalog/find-boards";

const page = (name: string) => readFileSync(new URL(`./fixtures/pages/${name}`, import.meta.url), "utf8");

describe("findBoards", () => {
  it("finds boards in links, script src and script text, the most-mentioned first", () => {
    const boards = findBoards(page("careers-embed.html"), "https://acme-markets.com/en/careers");
    expect(boards.map((b) => b.key)).toEqual(["workday:acme|wd3|external", "greenhouse:acmemarkets", "comeet:a1.b2c"]);
    expect(boards.every((b) => b.supported)).toBe(true);
    expect(boards[1]).toMatchObject({ evidence: "https://boards.greenhouse.io/embed/job_board/js?for=acmemarkets" });
  });

  it("ignores links to the hiring systems' own websites", () => {
    expect(findBoards(page("home.html"), "https://acme-markets.com/")).toEqual([]);
  });

  it("takes a Teamtailor careers site on the company's own domain from its assets", () => {
    const html = '<link rel="stylesheet" href="https://assets.teamtailor-cdn.com/assets/careersite.css">';
    expect(findBoards(html, "https://careers.acme.com/jobs")[0]).toMatchObject({ key: "teamtailor:careers.acme.com", supported: true });
    expect(findBoards(html, "https://acme.teamtailor.com/jobs").map((b) => b.key)).toEqual(["teamtailor:acme"]);
  });

  it("treats a page that redirected onto a board as that board", () => {
    expect(findBoards("<html></html>", "https://jobs.lever.co/acme")[0]).toMatchObject({ key: "lever:acme", supported: true });
  });
});

describe("careersLinks", () => {
  it("keeps careers-looking links on the same site or its subdomains", () => {
    expect(careersLinks(page("home.html"), "https://www.acme-markets.com/")).toEqual(["https://careers.acme-markets.com/", "https://www.acme-markets.com/en/careers"]);
  });
});

describe("urlsInHtml", () => {
  it("resolves relative links and skips mailto and anchors", () => {
    const urls = urlsInHtml(page("home.html"), "https://acme-markets.com/");
    expect(urls).toContain("https://acme-markets.com/en/careers");
    expect(urls.some((u) => u.startsWith("mailto:"))).toBe(false);
  });
});

describe("Comeet embeds and hints", () => {
  it("reads the company uid from a COMEET.init script", () => {
    const html = `<script>window.comeetInit = function () { COMEET.init({ "token": "ABC", "company-uid": "41.009" }); };</script><script src="//www.comeet.co/careers-api/api.js"></script>`;
    expect(findBoards(html, "https://www.acme.com/careers/")[0]).toMatchObject({ ats: "comeet", slug: "41.009", key: "comeet:41.009", supported: false });
  });

  it("names the hiring systems a page mentions", async () => {
    const { atsHints } = await import("../src/catalog/find-boards");
    expect(atsHints(`<div class="comeet-container"></div><a href="https://acme.wd3.myworkdayjobs.com/x">x</a>`)).toEqual(["comeet", "workday"]);
    expect(atsHints("<p>Join us</p>")).toEqual([]);
  });
});
