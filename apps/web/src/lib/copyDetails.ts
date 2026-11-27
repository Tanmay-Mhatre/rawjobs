import { toast } from "../components/Toast";
import { copyText } from "./clipboard";

/** What a failure's "Copy details" puts on the clipboard: for a bug report, never shown in the page. */
export type FailureDetails = { action: string; cause: string; errors: string };

/** The details as text: what was being done, why it failed, the raw error and when. */
export function detailsText(d: FailureDetails, at: Date = new Date()): string {
  return JSON.stringify({ ...d, at: at.toISOString() }, null, 2);
}

/** Copy a failure's details, then say so in a toast. Never throws. */
export async function copyDetails(d: FailureDetails): Promise<void> {
  let ok = false;
  try {
    ok = await copyText(detailsText(d));
  } catch {
    ok = false;
  }
  toast({ message: ok ? "Copied the details" : "Couldn't copy the details. Your browser blocked the clipboard." });
}
