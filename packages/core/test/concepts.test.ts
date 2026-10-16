import { describe, expect, it } from "vitest";
import { aliasesOf, conceptsVersion, namesTopic, setConcepts, topicMentions } from "../src/concepts";

describe("topic matching by meaning", () => {
  it("counts word forms of a topic", () => {
    expect(namesTopic("Owns monthly forecasts and budgets", "forecasting")).toBe(true);
    expect(namesTopic("You'll own pricing", "price")).toBe(true);
    expect(namesTopic("Payment flows", "payments")).toBe(true);
    expect(namesTopic("Defined our strategies", "strategy")).toBe(true);
    expect(namesTopic("A process, many processes", "process")).toBe(true);
  });

  it("counts the words that prove a topic, and says which one matched", () => {
    expect(topicMentions("Build our PSP integrations and acquiring stack", "payments")).toEqual({ n: 1, via: "PSP" });
    expect(namesTopic("Launch card issuing in the UK", "cards")).toBe(true);
    expect(namesTopic("Experience with Kafka and dbt", "data engineering")).toBe(true);
  });

  it("only points one way: a broad word never proves a narrow one", () => {
    expect(namesTopic("A fast-growing payments company", "acquiring")).toBe(false);
    expect(namesTopic("A fintech", "payments")).toBe(false);
  });

  it("matches one-word aliases with a capital only as written", () => {
    expect(namesTopic("You react quickly to incidents", "frontend")).toBe(false);
    expect(namesTopic("We build in React", "frontend")).toBe(true);
    expect(namesTopic("see example.com/psp/docs", "payments")).toBe(false);
  });

  it("doesn't count a topic right after a negation", () => {
    expect(namesTopic("No crypto experience needed", "crypto")).toBe(false);
    expect(namesTopic("Not a sales role", "sales")).toBe(false);
    expect(namesTopic("Crypto experience is a must", "crypto")).toBe(true);
  });

  it("takes the weekly list on top of the built-in one, and goes back without it", () => {
    setConcepts({ version: "2026-10-19", concepts: { payments: ["payment orchestration"], "new topic": ["shiny tool"] } });
    expect(conceptsVersion()).toBe("2026-10-19");
    expect(aliasesOf("payments")).toContain("PSP");
    expect(namesTopic("Lead payment orchestration", "payments")).toBe(true);
    expect(namesTopic("We use a shiny tool", "new topic")).toBe(true);
    setConcepts();
    expect(conceptsVersion()).toBe("base");
    expect(namesTopic("We use a shiny tool", "new topic")).toBe(false);
  });
});
