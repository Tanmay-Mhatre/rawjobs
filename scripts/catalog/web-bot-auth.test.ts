import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { HttpClient } from "@rawjobs/core";
import { describe, expect, it } from "vitest";
import { DIRECTORY_CONTENT_TYPE, feedSigner, loadBotKey, signDirectory, signRequest, thumbprint } from "./lib/web-bot-auth";

// The published RFC 9421 Ed25519 test key, which Cloudflare's docs and research site also use. Test only.
const TEST_JWK = { kty: "OKP", crv: "Ed25519", d: "n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU", x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs" } as const;
const TEST_PEM = createPrivateKey({ key: TEST_JWK, format: "jwk" }).export({ type: "pkcs8", format: "pem" }).toString();
const TEST_PUBLIC = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: TEST_JWK.x }, format: "jwk" });
const CLOUDFLARE_KEYID = "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";

/** Checks `signature` (sig1=:…:) over the base built from `lines` and the Signature-Input's params. */
function verifies(lines: string[], signatureInput: string, signature: string): boolean {
  const params = signatureInput.replace(/^\w+=/, "");
  const base = [...lines, `"@signature-params": ${params}`].join("\n");
  const sig = Buffer.from(signature.replace(/^\w+=:|:$/g, ""), "base64");
  return verify(null, Buffer.from(base), TEST_PUBLIC, sig);
}

describe("web bot auth", () => {
  it("keyid is the JWK thumbprint Cloudflare's docs give for the test key", async () => {
    expect(await thumbprint({ kty: "OKP", crv: "Ed25519", x: TEST_JWK.x })).toBe(CLOUDFLARE_KEYID);
    const key = await loadBotKey(TEST_PEM);
    expect(key.keyid).toBe(CLOUDFLARE_KEYID);
    expect(key.jwk).toEqual({ kty: "OKP", crv: "Ed25519", x: TEST_JWK.x });
  });

  it("builds the signature base the way Cloudflare does (its own signed directory, 22 Nov 2026)", () => {
    // Read from http-message-signatures-example.research.cloudflare.com/.well-known/http-message-signatures-directory
    const input = 'binding0=("@authority";req);created=1795364494;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=1795364794;tag="http-message-signatures-directory"';
    const signature = "binding0=:LbxeXvkRAKeBSgwkL97+V0aDSmJ2NXBRe93dvMZr9U08htn7Ubs4pQv9IZlBayY2mpCg4ZcPURRz4+1WbSc3DA==:";
    expect(verifies(['"@authority";req: http-message-signatures-example.research.cloudflare.com'], input, signature)).toBe(true);
  });

  it("signs a request over @authority and signature-agent, tagged web-bot-auth", async () => {
    const key = await loadBotKey(TEST_PEM);
    const now = Date.UTC(2026, 10, 22);
    const h = await signRequest(key, "https://Acme.wd5.myworkdayjobs.com/wday/cxs/acme/careers/jobs", "https://www.rawjobs.workers.dev/", now);
    expect(h["signature-agent"]).toBe('"https://www.rawjobs.workers.dev"');
    const created = now / 1000;
    expect(h["signature-input"]).toMatch(
      new RegExp(`^sig1=\\("@authority" "signature-agent"\\);created=${created};keyid="${CLOUDFLARE_KEYID}";alg="ed25519";expires=${created + 300};nonce="[A-Za-z0-9+/]{86}==";tag="web-bot-auth"$`),
    );
    const lines = ['"@authority": acme.wd5.myworkdayjobs.com', `"signature-agent": "https://www.rawjobs.workers.dev"`];
    expect(verifies(lines, h["signature-input"]!, h.signature!)).toBe(true);
    expect(verifies(['"@authority": other.example', lines[1]!], h["signature-input"]!, h.signature!)).toBe(false);
  });

  it("refuses a Signature-Agent that isn't https", async () => {
    const key = await loadBotKey(TEST_PEM);
    await expect(signRequest(key, "https://a.example/", "http://www.rawjobs.workers.dev")).rejects.toThrow(/https/);
  });

  it("signs the key directory for the host serving it", async () => {
    const key = await loadBotKey(TEST_PEM);
    const { body, headers } = await signDirectory(key, "www.rawjobs.workers.dev", Date.UTC(2026, 10, 22));
    expect(JSON.parse(body)).toEqual({ keys: [{ kty: "OKP", crv: "Ed25519", x: TEST_JWK.x, kid: CLOUDFLARE_KEYID }] });
    expect(body).not.toContain(TEST_JWK.d);
    expect(headers["content-type"]).toBe(DIRECTORY_CONTENT_TYPE);
    expect(headers["signature-input"]).toMatch(/^sig1=\("@authority";req\);.*tag="http-message-signatures-directory";created=\d+;expires=\d+$/);
    expect(verifies(['"@authority";req: www.rawjobs.workers.dev'], headers["signature-input"]!, headers.signature!)).toBe(true);
  });

  it("signs the feed only in GitHub Actions with the key set", async () => {
    expect(await feedSigner({})).toBeUndefined();
    expect(await feedSigner({ WEB_BOT_AUTH_KEY: TEST_PEM })).toBeUndefined();
    expect(await feedSigner({ GITHUB_ACTIONS: "true", WEB_BOT_AUTH_KEY: "" })).toBeUndefined();
    const sign = await feedSigner({ GITHUB_ACTIONS: "true", WEB_BOT_AUTH_KEY: TEST_PEM });
    expect((await sign!("https://a.example/x"))["signature-agent"]).toBe('"https://www.rawjobs.workers.dev"');
    const custom = await feedSigner({ GITHUB_ACTIONS: "true", WEB_BOT_AUTH_KEY: TEST_PEM, WEB_BOT_AUTH_AGENT: "https://rawjobs.example/" });
    expect((await custom!("https://a.example/x"))["signature-agent"]).toBe('"https://rawjobs.example"');
    await expect(feedSigner({ GITHUB_ACTIONS: "true", WEB_BOT_AUTH_KEY: "not a key" })).rejects.toThrow();
  });

  it("HttpClient signs every attempt afresh and keeps its User-Agent", async () => {
    const seen: Record<string, string>[] = [];
    const answers = [new Response("", { status: 503 }), new Response("{}", { status: 200 })];
    const sign = await feedSigner({ GITHUB_ACTIONS: "true", WEB_BOT_AUTH_KEY: TEST_PEM });
    const http = new HttpClient({
      userAgent: "RawJobs-feed/test",
      hostDelayMs: 0,
      backoffMs: 0,
      sleep: async () => {},
      sign,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen.push(init?.headers as Record<string, string>);
        return answers.shift()!;
      }) as unknown as typeof fetch,
    });
    expect(http.signing).toBe(true);
    await http.getJson("https://a.example/jobs");
    expect(seen).toHaveLength(2);
    for (const h of seen) {
      expect(h["user-agent"]).toBe("RawJobs-feed/test");
      expect(h["signature-input"]).toContain('tag="web-bot-auth"');
    }
    expect(seen[0]!.signature).not.toBe(seen[1]!.signature);
    expect(new HttpClient().signing).toBe(false);
  });
});
