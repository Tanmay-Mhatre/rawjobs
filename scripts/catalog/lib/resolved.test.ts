import { describe, expect, it } from "vitest";
import type { Resolved } from "../resolve";
import { keepBoardOnError } from "./resolved";

const base = { name: "Acme", website: "https://acme.example", industries: [], pages: 1, resolved_at: "2026-10-26T04:00:00Z" };
const found: Resolved = { ...base, status: "board", board: { ats: "greenhouse", slug: "acme", key: "greenhouse:acme", supported: true }, also: ["lever:acme"], resolved_at: "2026-07-01T00:00:00Z" };
const error: Resolved = { ...base, status: "error", error: "timeout", pages: 0 };

describe("keepBoardOnError", () => {
  it("keeps the board found before when a re-resolve errors", () => {
    expect(keepBoardOnError(found, error)).toEqual({ ...error, board: found.board, also: found.also });
  });
  it("takes any other new result as it is", () => {
    const none: Resolved = { ...base, status: "none" };
    expect(keepBoardOnError(found, none)).toBe(none);
    expect(keepBoardOnError(undefined, error)).toBe(error);
    expect(keepBoardOnError({ ...base, status: "none" }, error)).toBe(error);
  });
});
