/** Set by the bundle build (scripts/bundle/build.ts) to the release's version. */
declare const __RAWJOBS_VERSION__: string | undefined;
/** This version, for the User-Agent: the bundle's, or package.json's when running the sources. */
export const VERSION = typeof __RAWJOBS_VERSION__ === "string" ? __RAWJOBS_VERSION__ : "0.6.0";

export function defaultUserAgent(): string {
  const repo = process.env.GITHUB_REPOSITORY;
  const home = repo ? `https://github.com/${repo}` : "self-hosted";
  return `RawJobs/${VERSION} (personal job radar; +${home})`;
}

export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    /** On a 403: who refused (server, CDN and firewall headers, the start of the body), to tell a rate limit from a block. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Headers that say who answered a 403: the server, a CDN, or a firewall in front of it. */
const REFUSAL_HEADERS = /^(server|x-cache|retry-after|cf-ray|x-amzn-waf-.*|x-amz-cf-pop)$/i;

/** A 403's headers and the start of its body, on one line. The body read has its own short clock. */
async function refusalDetail(res: Response, ctrl: AbortController, ms: number): Promise<string> {
  const headers = [...res.headers].filter(([k]) => REFUSAL_HEADERS.test(k)).map(([k, v]) => `${k}: ${v}`);
  const timer = setTimeout(() => ctrl.abort(), ms);
  const body = await res.text().catch(() => "");
  clearTimeout(timer);
  return [...headers, `body: ${body.slice(0, 120).replace(/\s+/g, " ").trim()}`].join("; ");
}

/**
 * Saved responses by URL, sent back as If-None-Match so an unchanged feed costs an empty 304.
 * A cache that keeps only the ETag (no body) gets NotModifiedError on a 304 instead. A cache with
 * load() reads the saved body only when the server answers 304 (most answers aren't).
 */
export type HttpCache = {
  get(url: string): { etag: string; body?: string } | undefined;
  set(url: string, etag: string, body: string): void;
  /** The saved body, read only on a 304. Undefined when it's gone: the URL is then fetched again in full. */
  load?(url: string): Promise<string | undefined>;
};

/** The URL answered 304 and the cache kept no body: the caller already has what it would say. */
export class NotModifiedError extends HttpError {
  override name = "NotModifiedError";
  constructor(url: string) {
    super(`not modified (${url})`, url, 304);
  }
}

/** No request made: the host kept failing for other URLs this run (with hostRests, through every rest). */
export class HostSkippedError extends HttpError {
  override name = "HostSkippedError";
}

/** No answer waited for: the scan was stopped (HttpOptions.stopped). Not the host's fault, so never counted against it. */
export class StoppedError extends HttpError {
  override name = "StoppedError";
  constructor(url: string) {
    super(`stopped (${url})`, url);
  }
}

export type HttpOptions = {
  userAgent?: string;
  timeoutMs?: number;
  /** Wait at most this long for the answer's headers (connecting included). Defaults to timeoutMs. */
  connectTimeoutMs?: number;
  /** Then at most this long for its body. Defaults to timeoutMs. */
  readTimeoutMs?: number;
  /** Extra attempts after the first, for 429 / 5xx / network errors. */
  retries?: number;
  /** Minimum gap between two requests to the same host. */
  hostDelayMs?: number;
  /** Per-host gaps that differ from hostDelayMs. Defaults to HOST_DELAYS when hostDelayMs isn't set. */
  hostDelays?: Record<string, number>;
  /** First backoff wait; doubles each retry. */
  backoffMs?: number;
  /** After this many failed requests in a row to one host, later ones fail at once (the host is down), or wait with hostRests. */
  breakAfter?: number;
  /**
   * For the app's scans: a host that failed breakAfter times in a row rests (HOST_RESTS_MS), then one request
   * tries it again; it's skipped for the run only if it keeps failing while other hosts answer.
   */
  hostRests?: boolean;
  /** For getJson(): conditional requests against saved responses. */
  cache?: HttpCache;
  /**
   * Pace each hiring system's API as a whole (paceOf), not just each host: start at the usual pace,
   * speed up a little with every answer and halve when the API pushes back (AIMD). For the app's scans.
   */
  adaptive?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Once this returns true, requests in flight are cut short and new ones, retries and waits for a
   * host's turn fail at once with StoppedError, so a stopped scan ends in seconds. Checked every STOP_POLL_MS.
   */
  stopped?: () => boolean;
};

/**
 * How long a host rests after failing breakAfter times in a row, then after each failed try. Past the last
 * it's skipped for the run, unless nothing else answered either (the network was down): then the rest repeats.
 */
const HOST_RESTS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
/** However it goes, a host is skipped for the run once it has been failing this long (a scan mustn't wait for good while offline). */
const MAX_RESTING_MS = 3_600_000;

/** A resting host: no request before `until`, then one (the probe) tries it while the others wait for it. */
type Rest = { until: number; step: number; since: number; firstAt: number; probe?: Promise<void> };

/** How often requests in flight check HttpOptions.stopped. */
const STOP_POLL_MS = 250;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_RETRY_AFTER_MS = 60_000;
/** A host that answers 429 gets this much slower, up to MAX_HOST_DELAY_MS, for the rest of the run. */
const SLOWDOWN = 2;
const MAX_HOST_DELAY_MS = 5_000;

/**
 * Hosts that serve many boards from a CDN-backed API and take a faster pace than the default.
 * Lever and SmartRecruiters stay at 1/s until measured. Any 429 slows a host down again.
 */
export const HOST_DELAYS: Record<string, number> = {
  "boards-api.greenhouse.io": 250,
  "api.ashbyhq.com": 250,
};

/**
 * An API's pace in requests a second: where it starts, the most it's ever asked, and whether each of
 * its hosts also keeps its own gap (Workday: one host per employer, many employers per wdN shard).
 */
export type PaceSpec = { key: string; start: number; ceiling: number; hostGap: boolean };
const shared = (key: string, ceiling: number, start = 1): PaceSpec => ({ key, start, ceiling, hostGap: false });
/** Hosts that serve every employer on a hiring system, paced as one. Any other host keeps its own gap only. */
const PACES: Record<string, PaceSpec> = {
  "api.smartrecruiters.com": shared("smartrecruiters", 5),
  "boards-api.greenhouse.io": shared("greenhouse", 8, 4),
  // Ashby already ran at 4/s without a 429: that stays its pace.
  "api.ashbyhq.com": shared("ashby", 4, 4),
  "api.lever.co": shared("lever", 3),
  "api.eu.lever.co": shared("lever-eu", 3),
  "apply.workable.com": shared("workable", 3),
  "recruiting.paylocity.com": shared("paylocity", 3),
  "www.paycomonline.net": shared("paycom", 3),
  "jobs.dayforcehcm.com": shared("dayforce", 3),
  "ats.rippling.com": shared("rippling", 3),
  "www.comeet.com": shared("comeet", 3),
  // Careers pages and the public API on one host; 10 requests back to back answered fine (2026-10-21).
  "join.com": shared("join", 4),
  // Slow to answer (1-6 s), so several at once; neither refused 10 requests back to back (2026-10-21).
  "open.api.manatal.com": shared("manatal", 3),
  "jobs.jobvite.com": shared("jobvite", 3),
};
/** Each Workday shard (wd1, wd5…) as a whole, on top of every employer's own 1 s gap (measured: a tenant asked faster answers 429). */
const WORKDAY_SHARD_PACE = { start: 4, ceiling: 8 };
/** The slowest an API is ever paced at, after halving. */
const MIN_RATE = 0.25;
/** After a halving, the requests already in flight land before another one counts. */
const DOWN_EVERY_MS = 2_000;
/** An answer this many times slower than the API's usual (and at least SPIKE_MS) means it's straining. */
const SPIKE_FACTOR = 4;
const SPIKE_MS = 3_000;

/** The API pace a host belongs to, if any. */
export function paceOf(host: string): PaceSpec | undefined {
  const known = PACES[host];
  if (known) return known;
  const shard = host.match(/^[^.]+\.(wd\d+)\.myworkdayjobs\.com$/)?.[1];
  return shard ? { key: `workday:${shard}`, ...WORKDAY_SHARD_PACE, hostGap: true } : undefined;
}

/** One API's pace as it goes: requests a second, its next free slot, and how fast it usually answers. */
type Pace = { spec: PaceSpec; rate: number; next: number; latency?: number; samples: number; downAt: number; downs: number };

/** What a client did, for logs and time estimates. */
export type HttpStats = {
  requests: number;
  notModified: number;
  failures: number;
  /** Answers that were 429 (too many requests). */
  rateLimited: number;
  /** Attempts that timed out (waiting for the headers or the body). */
  timeouts: number;
  slowedHosts: string[];
  /** Hosts that rested after failing several times in a row. */
  restedHosts: string[];
  /** Hosts skipped for the rest of the run: they kept failing while other hosts answered. */
  brokenHosts: string[];
  /** With adaptive pacing: each API's pace at the end (requests a second) and how often it was halved. */
  paces?: Record<string, { rate: number; downs: number }>;
};

/**
 * Polite HTTP for connectors: identifying User-Agent, 30s timeout, per-host spacing,
 * retries with exponential backoff on 429 and 5xx (honouring Retry-After). A 429 also slows the
 * whole host down; a host that keeps failing rests, and is skipped for the run if it doesn't come back.
 */
export class HttpClient {
  private readonly opts: Required<Omit<HttpOptions, "cache" | "stopped">> & Pick<HttpOptions, "cache" | "stopped">;
  /** Adaptive pacing per API, by paceOf()'s key. */
  private readonly paces = new Map<string, Pace>();
  /** Earliest time (ms) the next request to each host may start. */
  private readonly nextSlot = new Map<string, number>();
  /** Current gap per host, where it differs from hostDelayMs. */
  private readonly delays: Map<string, number>;
  /** Failed requests in a row per host. */
  private readonly failures = new Map<string, number>();
  private readonly rests = new Map<string, Rest>();
  private readonly givenUp = new Set<string>();
  /** When any host last answered (any status): a rest with no answer anywhere says the network was down, not the host. */
  private lastAnswerAt = 0;
  /** Aborted once `stopped` says so; every request in flight listens to it. */
  private readonly stop = new AbortController();
  private inFlight = 0;
  private stopPoll: ReturnType<typeof setInterval> | undefined;
  readonly stats: HttpStats = { requests: 0, notModified: 0, failures: 0, rateLimited: 0, timeouts: 0, slowedHosts: [], restedHosts: [], brokenHosts: [] };

  constructor(opts: HttpOptions = {}) {
    this.opts = {
      userAgent: opts.userAgent ?? defaultUserAgent(),
      timeoutMs: opts.timeoutMs ?? 30_000,
      connectTimeoutMs: opts.connectTimeoutMs ?? opts.timeoutMs ?? 30_000,
      readTimeoutMs: opts.readTimeoutMs ?? opts.timeoutMs ?? 30_000,
      retries: opts.retries ?? 3,
      hostDelayMs: opts.hostDelayMs ?? 1_000,
      hostDelays: opts.hostDelays ?? (opts.hostDelayMs === undefined ? HOST_DELAYS : {}),
      backoffMs: opts.backoffMs ?? 2_000,
      breakAfter: opts.breakAfter ?? Infinity,
      hostRests: opts.hostRests ?? false,
      cache: opts.cache,
      adaptive: opts.adaptive ?? false,
      fetchImpl: opts.fetchImpl ?? fetch,
      sleep: opts.sleep ?? realSleep,
      stopped: opts.stopped,
    };
    this.delays = new Map(Object.entries(this.opts.hostDelays));
  }

  async getJson<T = unknown>(url: string): Promise<T> {
    const cached = this.opts.cache?.get(url);
    const { res, body } = await this.requestBody(url, { headers: { accept: "application/json", ...(cached ? { "if-none-match": cached.etag } : {}) } });
    if (res.status === 304 && cached) {
      this.stats.notModified++;
      const saved = cached.body ?? (await this.opts.cache?.load?.(url));
      if (saved !== undefined) return JSON.parse(saved) as T;
      // The saved body is gone (load() forgets the URL): ask again without the ETag.
      if (this.opts.cache?.load) return this.getJson<T>(url);
      throw new NotModifiedError(url);
    }
    const etag = res.headers.get("etag");
    const value = parseJson<T>(body, url, res.headers.get("content-type"));
    if (etag && this.opts.cache) this.opts.cache.set(url, etag, body);
    return value;
  }

  async postJson<T = unknown>(url: string, body: unknown): Promise<T> {
    const { res, body: text } = await this.requestBody(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseJson<T>(text, url, res.headers.get("content-type"));
  }

  async getText(url: string): Promise<string> {
    return (await this.requestBody(url, {})).body;
  }

  /**
   * The response with its body already read. The read is part of the attempt: a body that stalls
   * past the timeout is retried, counts towards the host's failures and says "timed out after Ns".
   */
  async requestBody(url: string, init: RequestInit): Promise<{ res: Response; body: string }> {
    const { res, body } = await this.send(url, init, true);
    return { res, body: body ?? "" };
  }

  /** The response with its body unread: the caller's read isn't retried, so prefer requestBody(). */
  async request(url: string, init: RequestInit): Promise<Response> {
    return (await this.send(url, init, false)).res;
  }

  private async send(url: string, init: RequestInit, readBody: boolean): Promise<{ res: Response; body?: string }> {
    const host = new URL(url).host;
    if (this.isStopped()) throw new StoppedError(url);
    const probe = await this.waitOutRest(host, url);
    this.track(1);
    try {
      const out = await this.attempt(url, init, host, readBody);
      this.lastAnswerAt = Date.now();
      this.failures.delete(host);
      this.rests.delete(host);
      return out;
    } catch (err) {
      if (err instanceof StoppedError) throw err;
      const status = (err as HttpError).status;
      if (status !== undefined) this.lastAnswerAt = Date.now();
      if (status === undefined || status === 429 || status >= 500) {
        this.stats.failures++;
        const n = (this.failures.get(host) ?? 0) + 1;
        this.failures.set(host, n);
        // Requests already in flight when the host began resting don't make it rest again.
        if (probe || (n >= this.opts.breakAfter && !this.rests.has(host))) this.rest(host);
      } else if (probe) {
        // A 4xx is about this URL, not the host: it answered, so its rest is over.
        this.failures.delete(host);
        this.rests.delete(host);
      }
      throw err;
    } finally {
      probe?.();
      this.track(-1);
    }
  }

  /**
   * Wait while the host rests. Returns a release when this request is the one that tries it again (the
   * others wait for its answer); throws HostSkippedError once the host is skipped for the run.
   */
  private async waitOutRest(host: string, url: string): Promise<(() => void) | undefined> {
    for (;;) {
      if (this.givenUp.has(host))
        throw new HostSkippedError(this.opts.hostRests ? `skipped: ${host} kept failing (${url})` : `skipped: ${host} failed ${this.opts.breakAfter} times in a row (${url})`, url);
      const rest = this.rests.get(host);
      if (!rest) return undefined;
      if (rest.until > Date.now()) {
        await this.pause(rest.until - Date.now(), url);
        if (this.rests.get(host) !== rest) continue;
      }
      if (rest.probe) {
        await rest.probe;
        if (this.isStopped()) throw new StoppedError(url);
        continue;
      }
      let release = () => {};
      rest.probe = new Promise<void>((done) => {
        release = () => {
          rest.probe = undefined;
          done();
        };
      });
      return release;
    }
  }

  /** The host failed breakAfter times in a row, or failed its try after a rest: it rests (longer), or is skipped for the run (at once without hostRests). */
  private rest(host: string): void {
    const prev = this.rests.get(host);
    const now = Date.now();
    // Nothing anywhere answered since the last rest began: the network is down, not this host, so the rest doesn't grow.
    const step = !prev ? 0 : this.lastAnswerAt < prev.since ? prev.step : prev.step + 1;
    const firstAt = prev?.firstAt ?? now;
    if (!this.opts.hostRests || step >= HOST_RESTS_MS.length || now - firstAt >= MAX_RESTING_MS) {
      this.rests.delete(host);
      this.givenUp.add(host);
      this.stats.brokenHosts.push(host);
      return;
    }
    this.rests.set(host, { until: now + HOST_RESTS_MS[step]!, step, since: now, firstAt });
    if (!this.stats.restedHosts.includes(host)) this.stats.restedHosts.push(host);
  }

  /** True once `stopped` has said so (it's asked again only until then). */
  private isStopped(): boolean {
    if (!this.stop.signal.aborted && this.opts.stopped?.()) {
      this.stop.abort();
      clearInterval(this.stopPoll);
    }
    return this.stop.signal.aborted;
  }

  /** Count requests in flight: `stopped` is polled only while there are some. */
  private track(n: 1 | -1): void {
    this.inFlight += n;
    if (!this.opts.stopped) return;
    if (this.inFlight === 0) {
      clearInterval(this.stopPoll);
      this.stopPoll = undefined;
    } else if (!this.stopPoll && !this.stop.signal.aborted) {
      this.stopPoll = setInterval(() => this.isStopped(), STOP_POLL_MS);
      this.stopPoll.unref?.();
    }
  }

  /** sleep(), in short steps when it can be stopped; throws StoppedError once it is. */
  private async pause(ms: number, url: string): Promise<void> {
    if (!this.opts.stopped) return this.opts.sleep(ms);
    for (let left = ms; left > 0; left -= STOP_POLL_MS) {
      if (this.isStopped()) throw new StoppedError(url);
      await this.opts.sleep(Math.min(left, STOP_POLL_MS));
    }
    if (this.isStopped()) throw new StoppedError(url);
  }

  private async attempt(url: string, init: RequestInit, host: string, readBody: boolean): Promise<{ res: Response; body?: string }> {
    const { retries, backoffMs } = this.opts;
    let lastError: HttpError | undefined;
    /** After a 429 the host's own slot holds the pause (see slowDown), so the retry doesn't wait twice. */
    let hostPaused = false;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0 && !hostPaused) await this.pause(backoffMs * 2 ** (attempt - 1), url);
      hostPaused = false;
      await this.waitForHost(host, url);
      this.stats.requests++;
      const pace = this.paceFor(host);
      const sent = Date.now();
      let res: Response;
      let body: string | undefined;
      // Two clocks: one for the headers (a host that doesn't answer fails fast), then one for the body.
      const ctrl = new AbortController();
      let waited = this.opts.connectTimeoutMs;
      const expire = (ms: number) => setTimeout(() => ctrl.abort(new DOMException(`timed out after ${ms / 1000}s`, "TimeoutError")), ms);
      let timer = expire(waited);
      const onStop = () => ctrl.abort(new StoppedError(url));
      this.stop.signal.addEventListener("abort", onStop);
      try {
        res = await this.opts.fetchImpl(url, {
          ...init,
          headers: { "user-agent": this.opts.userAgent, ...(init.headers as Record<string, string>) },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (pace) this.paced(pace, res.status, Date.now() - sent);
        waited = this.opts.readTimeoutMs;
        timer = expire(waited);
        // The timeout covers the body too: read it here, so a stalled body is retried like a stalled answer.
        if (readBody && res.ok) body = await res.text();
      } catch (err) {
        clearTimeout(timer);
        if (ctrl.signal.reason instanceof StoppedError) throw ctrl.signal.reason;
        const e = err as Error;
        const timedOut = e.name === "TimeoutError" || (ctrl.signal.reason as Error | undefined)?.name === "TimeoutError";
        if (timedOut) this.stats.timeouts++;
        // An API that stops answering in time is straining as much as one that says 429.
        if (pace && timedOut) this.paceDown(pace);
        const reason = timedOut ? `timed out after ${waited / 1000}s` : e.message;
        lastError = new HttpError(`${reason} (${url})`, url);
        continue;
      } finally {
        this.stop.signal.removeEventListener("abort", onStop);
      }
      // A caller reading the body itself (request()) keeps the read clock, but it mustn't hold the process open.
      if (readBody) clearTimeout(timer);
      else timer.unref?.();
      if (res.ok || res.status === 304) return { res, body };
      lastError = new HttpError(`HTTP ${res.status} (${url})`, url, res.status);
      // Paylocity says "slow down" with a 403: retried like a 429 when pacing.
      const pushback = res.status === 429 || (pace?.spec.key === "paylocity" && res.status === 403);
      if (!pushback && res.status < 500) {
        if (res.status === 403) throw new HttpError(lastError.message, url, 403, await refusalDetail(res, ctrl, 5_000));
        // 4xx won't fix itself; free the connection now rather than when it's collected.
        await res.body?.cancel().catch(() => {});
        throw lastError;
      }
      if (pushback) {
        this.stats.rateLimited++;
        this.slowDown(host, parseRetryAfter(res.headers.get("retry-after")) ?? backoffMs * 2 ** attempt);
        hostPaused = true;
      }
      await res.body?.cancel().catch(() => {});
    }
    throw lastError ?? new HttpError(`request failed (${url})`, url);
  }

  /**
   * Reserve the next free slot for this host (and for its API, when pacing), then wait for it. Safe
   * for parallel callers. A host paced as part of its API keeps no gap of its own, only pauses.
   */
  private async waitForHost(host: string, url: string): Promise<void> {
    const now = Date.now();
    const pace = this.paceFor(host);
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0, pace?.next ?? 0);
    this.nextSlot.set(host, slot + (pace && !pace.spec.hostGap ? 0 : (this.delays.get(host) ?? this.opts.hostDelayMs)));
    if (pace) pace.next = slot + 1000 / pace.rate;
    if (slot > now) await this.pause(slot - now, url);
  }

  private paceFor(host: string): Pace | undefined {
    if (!this.opts.adaptive) return undefined;
    const spec = paceOf(host);
    if (!spec) return undefined;
    let pace = this.paces.get(spec.key);
    if (!pace) {
      pace = { spec, rate: spec.start, next: 0, samples: 0, downAt: 0, downs: 0 };
      this.paces.set(spec.key, pace);
    }
    return pace;
  }

  /**
   * An answer came: a push-back (429, 503, Paylocity's 403) or an answer far slower than usual halves
   * the API's pace; any other answer raises it by a twentieth of its ceiling.
   */
  private paced(pace: Pace, status: number, ms: number): void {
    const usual = pace.latency;
    pace.latency = usual === undefined ? ms : usual * 0.8 + ms * 0.2;
    pace.samples++;
    // A shared API slowing down is straining; a Workday shard's employers answer at their own speeds, so only push-backs count there.
    const spike = !pace.spec.hostGap && usual !== undefined && pace.samples > 5 && ms > Math.max(usual * SPIKE_FACTOR, SPIKE_MS);
    if (status === 429 || status === 503 || (status === 403 && pace.spec.key === "paylocity") || spike) this.paceDown(pace);
    else if (status < 500) pace.rate = Math.min(pace.spec.ceiling, pace.rate + pace.spec.ceiling / 20);
    this.notePace(pace);
  }

  private paceDown(pace: Pace): void {
    const now = Date.now();
    if (now - pace.downAt < DOWN_EVERY_MS) return;
    pace.downAt = now;
    pace.downs++;
    pace.rate = Math.max(MIN_RATE, pace.rate / 2);
    pace.next = Math.max(pace.next, now + 1000 / pace.rate);
    this.notePace(pace);
  }

  private notePace(pace: Pace): void {
    this.stats.paces ??= {};
    this.stats.paces[pace.spec.key] = { rate: Math.round(pace.rate * 100) / 100, downs: pace.downs };
  }

  /** A 429: every request to the host waits out the pause, and the host's pace halves from now on. */
  private slowDown(host: string, pauseMs: number): void {
    this.nextSlot.set(host, Math.max(this.nextSlot.get(host) ?? 0, Date.now() + pauseMs));
    const delay = this.delays.get(host) ?? this.opts.hostDelayMs;
    this.delays.set(host, Math.min(Math.max(delay, 250) * SLOWDOWN, MAX_HOST_DELAY_MS));
    if (!this.stats.slowedHosts.includes(host)) this.stats.slowedHosts.push(host);
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.min(Math.max(0, at - Date.now()), MAX_RETRY_AFTER_MS);
}

/** JSON, or an HttpError naming the page: an HTML error page otherwise shows up as just "Unexpected token '<'". */
function parseJson<T>(body: string, url: string, contentType: string | null): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(`not JSON (${contentType ?? "no content type"}): ${body.slice(0, 60).replace(/\s+/g, " ")} (${url})`, url);
  }
}
