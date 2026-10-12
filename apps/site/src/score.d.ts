// Types for score.js (plain JS, so build.mjs can inline it into the page without a bundler).
export type DemoState = { titles: string[]; seniority: "head" | "lead" | ""; places: string[]; kw: string[]; industry: "mine" | "unknown" | "other" };
export type DemoJob = { title: string; location: string; workplace: "onsite" | "hybrid" | "remote"; description: string };
export type DemoResult = { gated: "title" | "place" } | { gated?: undefined; total: number; t: number; p: number; k: number; i: number; matched: string[]; noKw?: boolean };
export const DEMO_JOB: DemoJob;
export const SENIORITY_POINTS: Record<DemoState["seniority"], number>;
export const INDUSTRY_POINTS: Record<DemoState["industry"], number>;
export function demoScore(state: DemoState, job?: DemoJob): DemoResult;
