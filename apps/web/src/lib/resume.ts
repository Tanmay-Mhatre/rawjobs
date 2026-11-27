import { useCallback, useEffect, useState } from "react";
import { getJson } from "./api";
import { canRunLocally } from "./data";
import { load, save } from "./storage";

const LOCAL_KEY = "rawjobs.resume";

export type ResumeState = { text: string; updatedAt?: string; loaded: boolean };

/**
 * The master resume. Locally it's profile/resume.md (gitignored) via the dev API;
 * on a hosted dashboard it can only live in this browser.
 */
export function useResume() {
  const [resume, setResume] = useState<ResumeState>({ text: "", loaded: false });

  const refresh = useCallback(async () => {
    if (!canRunLocally) {
      const stored = load<{ text: string; updatedAt: string } | null>(LOCAL_KEY, null);
      setResume({ text: stored?.text ?? "", updatedAt: stored?.updatedAt, loaded: true });
      return;
    }
    const r = await getJson("GET /api/setup/resume", { cache: "no-store" });
    setResume(r.ok ? { text: r.data.text ?? "", updatedAt: r.data.updatedAt, loaded: true } : { text: "", loaded: true });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveResume = useCallback(async (text: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    const updatedAt = new Date().toISOString();
    if (!canRunLocally) {
      save(LOCAL_KEY, { text, updatedAt });
      setResume({ text, updatedAt, loaded: true });
      return { ok: true };
    }
    const r = await getJson("POST /api/setup/resume", { body: JSON.stringify({ text }) });
    if (!r.ok) return { ok: false, error: r.error };
    if (!r.data.ok) return { ok: false, error: r.data.error ?? r.data.errors ?? "Couldn't save the resume." };
    setResume({ text: text.trim(), updatedAt, loaded: true });
    return { ok: true };
  }, []);

  /** Delete the saved resume (this computer, or this browser when hosted). */
  const removeResume = useCallback(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (canRunLocally) {
      const r = await getJson("DELETE /api/setup/resume");
      if (!r.ok) return { ok: false, error: r.error };
      if (!r.data.ok) return { ok: false, error: r.data.errors ?? "Couldn't remove the resume." };
    } else save(LOCAL_KEY, null);
    setResume({ text: "", loaded: true });
    return { ok: true };
  }, []);

  return { resume, saveResume, removeResume, refresh };
}
