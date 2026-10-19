import { beforeEach, describe, expect, it } from "vitest";
import { engage } from "../src/connectors/engage";
import { herp } from "../src/connectors/herp";
import { hrmos, jpEmployment, jpSalary } from "../src/connectors/hrmos";
import { clearRobotsCache, parseRobots, robotsAllowsPath } from "../src/robots";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string, status = 200) => new Response(body, { status });
const ctx = (http: ReturnType<typeof fakeHttp>["http"], partial?: () => void) => ({ http, now: new Date(), partial });
const ld = (data: object) => `<html><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", ...data })}</script></html>`;
const ref = (ats: CompanyRef["ats"], slug: string, name: string) => ({ name, enabled: true, ats, slug }) as CompanyRef;
const u = (s: string) => new URL(s);

beforeEach(() => clearRobotsCache());

describe("hrmos", () => {
  const mf = ref("hrmos", "moneyforward", "マネーフォワード");
  const card = (id: string, title: string, loc: string, tags = ["正社員"]) =>
    `<li class="pg-list-cassette jsc-joblist-cassette"> <a href="https://hrmos.co/pages/moneyforward/jobs/${id}"> <div class="pg-list-cassette-detail"> <h2>${title}</h2> <ul class="sg-tags cf"> ${tags.map((t) => `<li>${t}</li>`).join(" ")} <li class="sg-tag-location">${loc}</li> </ul> </div> </a> </li>`;
  const page = (total: number, cards: string[]) =>
    `<h2 class="pg-count"> 全 ${total} 件中 ${cards.length} 件 を表示しています </h2> <ul> ${cards.join("")} </ul> <nav><ol><li class="sg-button">アルバイト</li></ol></nav>`;

  it("detects the company from list and job links", () => {
    expect(hrmos.detect(u("https://hrmos.co/pages/moneyforward/jobs"))).toEqual({ ats: "hrmos", slug: "moneyforward" });
    expect(hrmos.detect(u("https://hrmos.co/pages/visional/jobs/0000381"))).toEqual({ ats: "hrmos", slug: "visional" });
    expect(hrmos.detect(u("https://hrmos.co/about"))).toBeNull();
    expect(hrmos.detect(u("https://example.com/pages/x/jobs"))).toBeNull();
  });

  it("pages by 100 until the count is reached, keeping Japanese intact", async () => {
    const first = Array.from({ length: 100 }, (_, i) => card(`a${i}`, `職種${i}`, "東京都港区芝浦3-1-21"));
    const { http, calls } = fakeHttp((url) => {
      if (url.endsWith("/robots.txt")) return text("Not found", 404);
      if (url.endsWith("?page=2")) return text(page(101, [card("0000265", "【プロダクトデザイナー（UI/UX）】_東京", "", ["契約社員"])]));
      return text(page(101, first));
    });
    const raw = await hrmos.fetch(mf, ctx(http));
    expect(calls.slice(1)).toEqual(["https://hrmos.co/pages/moneyforward/jobs", "https://hrmos.co/pages/moneyforward/jobs?page=2"]);
    expect(raw).toHaveLength(101);
    expect(hrmos.normalize(raw[0]!, mf)).toMatchObject({
      id: "hrmos:moneyforward:a0",
      title: "職種0",
      location: "東京都港区芝浦3-1-21",
      country: "Japan",
      employmentType: "full-time",
      url: "https://hrmos.co/pages/moneyforward/jobs/a0",
    });
    const last = hrmos.normalize(raw[100]!, mf);
    expect(last).toMatchObject({ title: "【プロダクトデザイナー（UI/UX）】_東京", location: "", employmentType: "contract" });
    expect(last.country).toBeUndefined();
    expect(hrmos.vagueLocation!(raw[100]!)).toBe(true);
  });

  it("stops at the page cap and says the read is partial", async () => {
    const full = Array.from({ length: 100 }, (_, i) => i);
    const { http } = fakeHttp((url) => {
      if (url.endsWith("/robots.txt")) return text("", 404);
      const p = Number(new URL(url).searchParams.get("page") ?? 1);
      return text(
        page(
          5000,
          full.map((i) => card(`${p}-${i}`, "x", "大阪府")),
        ),
      );
    });
    let partial = false;
    const raw = await hrmos.fetch(
      mf,
      ctx(http, () => (partial = true)),
    );
    expect(raw).toHaveLength(2000);
    expect(partial).toBe(true);
  });

  it("calls a missing company a closed board", async () => {
    const { http } = fakeHttp(() => text("ページが見つかりませんでした", 404));
    await expect(hrmos.fetch(mf, ctx(http))).rejects.toThrow(/board not found/);
  });

  it("reads description, date and a missing address from the job's JSON-LD", async () => {
    const page = ld({
      datePosted: "2025-10-02T05:14:16.000Z",
      description: "<h3>ビジョナル株式会社について</h3><p>HR Tech領域</p>",
      jobLocation: [{ address: { streetAddress: "渋谷2-15-1", addressLocality: "［渋谷本社］東京都渋谷区", addressRegion: null } }],
    });
    const { http, calls } = fakeHttp(() => text(page));
    const d = await hrmos.describe!({ id: "0000381", title: "特許スペシャリスト", location: "", tags: [] }, mf, ctx(http));
    expect(calls).toEqual(["https://hrmos.co/pages/moneyforward/jobs/0000381"]);
    expect(d).toMatchObject({ location: "［渋谷本社］東京都渋谷区", country: "Japan", postedAt: "2025-10-02T05:14:16.000Z" });
    expect(typeof d === "string" ? d : d.description).toContain("ビジョナル株式会社について");
  });

  it("reads Japanese pay and employment labels", () => {
    expect(jpSalary("月給&ensp;270,000円～")).toEqual({ min: 270000, currency: "JPY", period: "month" });
    expect(jpSalary("年収 400万円～600万円")).toEqual({ min: 4_000_000, max: 6_000_000, currency: "JPY", period: "year" });
    expect(jpEmployment(["デザイナー", "正社員"])).toBe("full-time");
    expect(jpEmployment(["正社員", "アルバイト"])).toBeUndefined();
  });
});

describe("herp", () => {
  const co = ref("herp", "herpinc", "株式会社HERP");
  const list = `<div class="requisition-list-card"><a class="with-heading requisition-list-card__header-anchor" href="/v1/herpinc/Qq1f9ppQHV9w"><h2 class="requisition-list-card__header heading">GT01_求職者向けサービスオペレーション_責任者候補_Business</h2></a><div class="requisition-list-card__title">サブタイトル</div></div><a class="requisition-list-card__header-anchor" href="/v1/herpinc/-Z20OVrOz6m8"><h2 class="heading">NW02_学生インターン(エンジニア職)</h2></a>`;

  it("detects the company", () => {
    expect(herp.detect(u("https://herp.careers/v1/herpinc"))).toEqual({ ats: "herp", slug: "herpinc" });
    expect(herp.detect(u("https://herp.careers/v1/herpinc/Qq1f9ppQHV9w"))).toEqual({ ats: "herp", slug: "herpinc" });
    expect(herp.detect(u("https://herp.careers/ref/abc"))).toBeNull();
  });

  it("reads every job from the one list page, with bare job links", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? text("User-agent: *\nDisallow: /ref/\nDisallow: /*?viaCareers=\nDisallow: /apply$\n") : text(list)));
    const raw = await herp.fetch(co, ctx(http));
    expect(calls).toEqual(["https://herp.careers/robots.txt", "https://herp.careers/v1/herpinc"]);
    expect(raw.map((r) => herp.normalize(r, co)).map((j) => [j.id, j.title, j.url])).toEqual([
      ["herp:herpinc:Qq1f9ppQHV9w", "GT01_求職者向けサービスオペレーション_責任者候補_Business", "https://herp.careers/v1/herpinc/Qq1f9ppQHV9w"],
      ["herp:herpinc:-Z20OVrOz6m8", "NW02_学生インターン(エンジニア職)", "https://herp.careers/v1/herpinc/-Z20OVrOz6m8"],
    ]);
    expect(herp.vagueLocation!(raw[0]!)).toBe(true);
    const rules = parseRobots("User-agent: *\nDisallow: /*?viaCareers=\nDisallow: /apply$\n");
    expect(robotsAllowsPath(rules, "/v1/herpinc/Qq1f9ppQHV9w")).toBe(true);
  });

  it("fills place, date and description from the job's JSON-LD", async () => {
    const page = ld({
      datePosted: "2026-10-08T05:26:40.000Z",
      description: "<h2>仕事概要</h2><p>「採用を変え、日本を強く。」</p>",
      jobLocation: { "@type": "Place", address: "五反田 本社オフィス（リモートワーク可）  ※勤務地の変更範囲：会社の定める場所" },
    });
    const { http } = fakeHttp(() => text(page));
    const d = await herp.describe!({ id: "Qq1f9ppQHV9w", title: "GT01" }, co, ctx(http));
    expect(d).toMatchObject({ location: "五反田 本社オフィス（リモートワーク可）", postedAt: "2026-10-08T05:26:40.000Z" });
    expect(typeof d === "string" ? d : d.description).toContain("「採用を変え、日本を強く。」");
  });
});

describe("engage", () => {
  const co = ref("engage", "engageagent", "株式会社エンゲージ");
  const card = (id: number, title: string, pay: string, area: string) =>
    `<dd class="dataArea"> <a class="linkKoma js_acceptLink" href="/engageagent/work_${id}/?via_recruit_page=1" target="_parent" rel="nofollow"> <div class="headArea jobTitle"> <h2 class="catch">${title}</h2> </div> <div class="jobDataArea"> <dl class="dataSet"> <dt class="label label--income"><span class="text"></span></dt> <dd class="data"> <span class="index">${pay}<br/></span> </dd> </dl> <dl class="dataSet"> <dt class="label label--area"><span class="text"></span></dt> <dd class="data"> <span class="index">${area}<br/></span> </dd> </dl> <div class="date">最終更新日：2026/10/16<br/></div> </div> </a> </dd>`;

  it("detects companies but not en-gage.net's own pages", () => {
    expect(engage.detect(u("https://en-gage.net/engageagent/"))).toEqual({ ats: "engage", slug: "engageagent" });
    expect(engage.detect(u("https://en-gage.net/ensaiyo/work_18089418/"))).toEqual({ ats: "engage", slug: "ensaiyo" });
    for (const path of ["/user/search/desc/18087982/", "/search/", "/about/", "/"]) expect(engage.detect(u(`https://en-gage.net${path}`))).toBeNull();
  });

  it("reads every job from the company page; its robots.txt has nothing for us", async () => {
    const robotsTxt = "User-agent: Googlebot\nDisallow: /user/apply/\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /search/\n";
    const page =
      card(18102501, "【未経験OK】カーブスのインストラクター／日祝休み", "月給&ensp;270,000円～", "千葉県八千代市") +
      card(18089418, "『engage』の法人営業／完全フルリモート", "月給&ensp;260,000円～", "フルリモート（完全在宅）");
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? text(robotsTxt) : text(page)));
    const raw = await engage.fetch(co, ctx(http));
    expect(calls).toEqual(["https://en-gage.net/robots.txt", "https://en-gage.net/engageagent/"]);
    const [a, b] = raw.map((r) => engage.normalize(r, co));
    expect(a).toMatchObject({
      id: "engage:engageagent:18102501",
      title: "【未経験OK】カーブスのインストラクター／日祝休み",
      location: "千葉県八千代市",
      country: "Japan",
      salary: { min: 270000, currency: "JPY", period: "month" },
      url: "https://en-gage.net/engageagent/work_18102501/",
    });
    expect(b).toMatchObject({ location: "フルリモート（完全在宅）", workplace: "remote" });
  });

  it("reads date and description from the job's JSON-LD", async () => {
    const page = ld({
      datePosted: "2026-09-03T11:10:44+09:00",
      description: "未経験OK<br/><p>■ 仕事内容</p>",
      jobLocation: { address: { addressCountry: "JP", addressRegion: "北海道", addressLocality: "札幌市中央区" } },
    });
    const { http, calls } = fakeHttp(() => text(page));
    const d = await engage.describe!({ id: "18087982", title: "インストラクター", location: "", pay: "" }, co, ctx(http));
    expect(calls).toEqual(["https://en-gage.net/engageagent/work_18087982/"]);
    expect(d).toMatchObject({ location: "札幌市中央区, 北海道, Japan", country: "Japan", postedAt: "2026-09-03T02:10:44.000Z" });
    expect(typeof d === "string" ? d : d.description).toContain("仕事内容");
  });
});
