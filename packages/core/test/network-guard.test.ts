import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HttpClient, HttpError } from "../src/http";
import { isPrivateAddress, PrivateAddressError, privateAddressReason, privateHost, publicOnlyLookup } from "../src/network-guard";

let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/hop") res.writeHead(302, { location: `http://inside.test:${port}/` }).end();
    else res.writeHead(200, { "content-type": "text/plain" }).end("hello");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));
afterEach(() => {
  delete process.env.RAWJOBS_ALLOW_PRIVATE;
});

/** A fake DNS: each name to one address. */
const fakeDns = (names: Record<string, string>) => (host: string, _o: { all: true }, cb: (err: NodeJS.ErrnoException | null, a: { address: string; family: number }[]) => void) => {
  const ip = names[host];
  if (ip) cb(null, [{ address: ip, family: 4 }]);
  else cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" }), []);
};
const agentFor = (names: Record<string, string>, blocked?: (ip: string) => boolean) => new Agent({ connect: { lookup: publicOnlyLookup(fakeDns(names), blocked) } });
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

describe("network guard", () => {
  it("refuses a name that resolves to 127.0.0.1", async () => {
    const dispatcher = agentFor({ "a.test": "127.0.0.1" });
    const err = await failure(undiciFetch(`http://a.test:${port}/`, { dispatcher }));
    expect(privateAddressReason(err)).toMatch(/a\.test points to a private address/);
    await dispatcher.close();
  });

  it("refuses a redirect to a private host", async () => {
    // The test server's own 127.0.0.1 stands in for a public address here; inside.test is 10.0.0.1.
    const dispatcher = agentFor({ "outside.test": "127.0.0.1", "inside.test": "10.0.0.1" }, (ip) => ip !== "127.0.0.1" && isPrivateAddress(ip));
    expect(await (await undiciFetch(`http://outside.test:${port}/`, { dispatcher })).text()).toBe("hello");
    const err = await failure(undiciFetch(`http://outside.test:${port}/hop`, { dispatcher }));
    expect(privateAddressReason(err)).toMatch(/inside\.test points to a private address/);
    await dispatcher.close();
  });

  it("allows public addresses", async () => {
    const lookup = publicOnlyLookup(fakeDns({ "example.test": "93.184.216.34" }));
    const one = await new Promise<unknown[]>((done) => lookup("example.test", {}, (...args) => done(args)));
    expect(one).toEqual([null, "93.184.216.34", 4]);
    const all = await new Promise<unknown[]>((done) => lookup("example.test", { all: true }, (...args) => done(args)));
    expect(all).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
    expect(privateHost(new URL("https://93.184.216.34/"))).toBeNull();
    expect(privateHost(new URL("https://boards.greenhouse.io/acme"))).toBeNull();
  });

  it("refuses literal private IPs and localhost before connecting", async () => {
    const http = new HttpClient({ retries: 3, breakAfter: 1, sleep: async () => {} });
    for (const url of [
      "http://10.0.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://169.254.169.254/latest/meta-data/",
      `http://127.0.0.1:${port}/`,
      `http://localhost:${port}/`,
      "http://app.localhost/",
    ]) {
      const err = await failure(http.getText(url));
      expect(err, url).toBeInstanceOf(HttpError);
      expect((err as HttpError).code, url).toBe("EPRIVATE");
    }
    // Permanent, and not the host's fault: nothing went out, nothing counts towards the host breaker.
    expect(http.stats.requests).toBe(0);
    expect(http.stats.failures).toBe(0);
    expect(http.stats.brokenHosts).toEqual([]);
  });

  it("doesn't retry a refused address or count it against the host", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new TypeError("fetch failed", { cause: new PrivateAddressError("a.test points to a private address; not fetched.") });
    }) as typeof fetch;
    const http = new HttpClient({ fetchImpl, retries: 3, breakAfter: 1, sleep: async () => {} });
    const err = await failure(http.getText("https://a.test/jobs"));
    expect(err).toMatchObject({ code: "EPRIVATE", message: "blocked: a.test points to a private address; not fetched. (https://a.test/jobs)" });
    await failure(http.getText("https://a.test/jobs"));
    expect(calls).toBe(2);
    expect(http.stats.failures).toBe(0);
    expect(http.stats.brokenHosts).toEqual([]);
  });

  it("RAWJOBS_ALLOW_PRIVATE=1 allows them", async () => {
    process.env.RAWJOBS_ALLOW_PRIVATE = "1";
    const http = new HttpClient({ retries: 0 });
    expect(await http.getText(`http://127.0.0.1:${port}/`)).toBe("hello");
  });

  it("isPrivateAddress table", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "224.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "87.201.244.163", "2606:4700::1", "::ffff:808:808"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
