import type { ChildProcess } from "node:child_process";

/**
 * The directory search process behind Companies → Browse all (`rawjobs directory search --serve`): one
 * kept running while the page uses it, so the 250k-company directory is read and indexed once, outside
 * this server's own thread. It's stopped after `idleMs` without a request, which frees its memory (a few
 * hundred MB), and started again by the next one.
 */
export function directorySearch(start: () => ChildProcess, opts: { idleMs?: number; timeoutMs?: number } = {}) {
  const idleMs = opts.idleMs ?? 10 * 60_000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let child: ChildProcess | null = null;
  let buffer = "";
  let nextId = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, { done: (v: unknown) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const failAll = (err: Error) => {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.fail(err);
    }
  };

  function running(): ChildProcess {
    if (child && child.exitCode === null && !child.killed) return child;
    const c = start();
    child = c;
    buffer = "";
    c.stdout!.setEncoding("utf8");
    c.stdout!.on("data", (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        let m: { id?: number; ok?: boolean; answer?: unknown; error?: string };
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        const p = typeof m.id === "number" ? pending.get(m.id) : undefined;
        if (!p) continue;
        clearTimeout(p.timer);
        pending.delete(m.id!);
        if (m.ok) p.done(m.answer);
        else p.fail(new Error(m.error || "The directory search failed."));
      }
      restIdle();
    });
    // Its warnings aren't answers: drained so a full pipe never stalls it.
    c.stderr?.resume();
    // A process stopped on purpose (stop()) already failed its requests: only the current one's matter.
    c.on("error", (err) => {
      if (child !== c) return;
      child = null;
      failAll(err);
    });
    c.on("exit", () => {
      if (child !== c) return;
      child = null;
      failAll(new Error("The directory search stopped."));
    });
    c.stdin!.on("error", () => {});
    return c;
  }

  function restIdle() {
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (pending.size) return restIdle();
      void stop();
    }, idleMs);
    idle.unref?.();
  }

  /** Ask the search process; rejects when it fails, stops or takes longer than `timeoutMs`. */
  function ask<T = unknown>(op: "search" | "names" | "warm", body: Record<string, unknown> = {}): Promise<T> {
    const c = running();
    const id = ++nextId;
    restIdle();
    return new Promise<T>((done, fail) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error("The directory search took too long."));
      }, timeoutMs);
      pending.set(id, { done: done as (v: unknown) => void, fail, timer });
      c.stdin!.write(`${JSON.stringify({ ...body, id, op })}\n`);
    });
  }

  /** End the search process (idle, or the server is stopping); resolves once it has exited. */
  function stop(): Promise<void> {
    clearTimeout(idle);
    const c = child;
    child = null;
    failAll(new Error("The directory search stopped."));
    if (!c || c.exitCode !== null || c.signalCode !== null) return Promise.resolve();
    return new Promise<void>((done) => {
      const kill = setTimeout(() => c.kill(), 2000);
      c.once("exit", () => {
        clearTimeout(kill);
        done();
      });
      c.stdin?.end();
    });
  }

  return { ask, stop, running: () => !!child };
}
