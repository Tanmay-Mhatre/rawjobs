import { vi } from "vitest";

type Part = "state" | "prefs" | "appearance" | "browser";
type Obj = Record<string, unknown>;
export type Call = { method: string; body?: unknown; ifMatch?: string };

/**
 * A stand-in for the local API's /api/tracking and /api/health, holding what's "on disk" with the
 * same revision rules as packages/core/src/tracking.ts (patchTracking): a key changed since the
 * page's base, or any key on another epoch, is a 409 with nothing applied.
 * `patch: false` plays an older server without PATCH (and without revisions).
 */
export function trackingServer(onDisk: Obj | null, opts: { patch?: boolean; status?: (method: string) => number | undefined } = {}) {
  const patchable = opts.patch !== false;
  let file: Obj | null = onDisk;
  let epoch = onDisk ? "e1" : "";
  let rev = 0;
  const revs: Partial<Record<Part, Obj>> = {};
  const calls: Call[] = [];

  /** Save as another window would (key-level, always accepted). */
  function edit(part: Part, key: string, value: unknown) {
    rev++;
    epoch ||= "e1";
    const next = { ...(file?.[part] as Obj | undefined) };
    if (value === undefined) delete next[key];
    else next[key] = value;
    file = { ...file, [part]: next };
    revs[part] = { ...revs[part], [key]: rev };
  }

  function patch(body: { changes: Partial<Record<Part, { set?: Obj; del?: string[] }>> }, ifMatch: string) {
    const m = /^"([^":]*):(\d+)"$/.exec(ifMatch);
    if (!m) return new Response("{}", { status: 400 });
    const [base, baseEpoch] = [Number(m[2]), m[1]];
    const conflicts: { part: string; key: string }[] = [];
    if (file)
      for (const [part, c] of Object.entries(body.changes))
        for (const key of [...Object.keys(c.set ?? {}), ...(c.del ?? [])]) if (baseEpoch !== epoch || ((revs[part as Part]?.[key] as number | undefined) ?? 0) > base) conflicts.push({ part, key });
    if (conflicts.length) return new Response(JSON.stringify({ ok: false, rev, epoch, tracking: file, conflicts }), { status: 409 });
    rev++;
    epoch ||= "e1";
    const next: Obj = { ...file };
    for (const [part, c] of Object.entries(body.changes) as [Part, { set?: Obj; del?: string[] }][]) {
      const p = { ...(next[part] as Obj | undefined), ...c.set };
      for (const k of c.del ?? []) delete p[k];
      next[part] = p;
      revs[part] = { ...revs[part], ...Object.fromEntries([...Object.keys(c.set ?? {}), ...(c.del ?? [])].map((k) => [k, rev])) };
    }
    file = next;
    return new Response(JSON.stringify({ ok: true, rev, epoch }));
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/health") return new Response(JSON.stringify({ ok: true, trackingRev: patchable ? rev : undefined }));
      const status = opts.status?.(method);
      if (status) {
        calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify({ ok: false }), { status });
      }
      if (method === "PATCH") {
        if (!patchable) {
          calls.push({ method });
          return new Response("Not found", { status: 404 });
        }
        const body = JSON.parse(String(init!.body)) as Parameters<typeof patch>[0];
        const ifMatch = new Headers(init!.headers).get("if-match") ?? "";
        calls.push({ method, body, ifMatch });
        return patch(body, ifMatch);
      }
      if (method === "PUT") {
        const body = JSON.parse(String(init!.body)) as Obj;
        calls.push({ method, body });
        rev++;
        file = { ...file, ...body };
        return new Response(JSON.stringify({ ok: true }));
      }
      calls.push({ method });
      return new Response(JSON.stringify(patchable ? { tracking: file, rev, epoch } : { tracking: file }));
    }),
  );
  return {
    calls,
    saves: () => calls.filter((c) => c.method === "PATCH" || c.method === "PUT"),
    file: () => file,
    edit,
  };
}
