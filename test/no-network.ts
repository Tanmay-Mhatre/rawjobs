/**
 * Tests never reach the network: any fetch a test didn't stub fails loudly instead of trying a real
 * site (or, in the web tests, the page's own origin, which nothing serves). Servers a test starts
 * itself, on 127.0.0.1 or [::1], stay reachable.
 */
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, "http://localhost:3000/");
  if (url.hostname === "127.0.0.1" || url.hostname === "[::1]") return realFetch(input, init);
  throw new Error(`A test fetched ${url.href} without stubbing fetch (stub it, or pass a fetchImpl).`);
}) as typeof fetch;
