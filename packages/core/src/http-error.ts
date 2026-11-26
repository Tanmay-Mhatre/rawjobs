/**
 * The errors HttpClient throws, with no imports, so code the web app also loads (connectors via
 * @rawjobs/core/detect, robots) can check for them without pulling in http.ts and its Node-only
 * network guard (node:dns, undici).
 */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    /** On a 403: who refused (server, CDN and firewall headers, the start of the body), to tell a rate limit from a block. */
    readonly detail?: string,
    /** "EPRIVATE": the host is a private address (network-guard.ts). Permanent, like a 4xx. */
    readonly code?: string,
  ) {
    super(message);
  }
}

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
