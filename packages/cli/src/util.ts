import { ATS_TYPES } from "@rawjobs/core";

/** A company's own hiring system, not a job board (JOB_BOARDS): boards are never shared or put in the directory. */
export const isAts = (ats: string | undefined) => (ATS_TYPES as readonly string[]).includes(ats ?? "");

export function readStdin(): Promise<string> {
  return new Promise((done, fail) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (text += d));
    process.stdin.on("end", () => done(text));
    process.stdin.on("error", fail);
  });
}
