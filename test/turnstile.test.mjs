import assert from "node:assert/strict";
import test from "node:test";
import { createTurnstile, requiresTurnstile } from "../turnstile.mjs";

const settings = { enabled: true, siteKey: "public-test-key", secretKey: "private-test-key", hostname: "mapa.meshcore.cz" };
const request = { headers: { "x-turnstile-token": "fresh-test-token" } };

test("Turnstile disabled preserves current writes; enabled requires complete configuration", async () => {
  const off = createTurnstile();
  assert.deepEqual(off.publicConfig(), { enabled: false, siteKey: "" });
  assert.deepEqual(await off.verify({ headers: {} }, "127.0.0.1"), { ok: true });
  assert.throws(() => createTurnstile({ enabled: true }), /requires/);
});

test("Turnstile protects public writes without changing reads or authenticated administration", () => {
  for (const path of ["/api/photos", "/api/photos/report", "/api/comments", "/api/feedback", "/api/node-info", `/api/photos/${"a".repeat(36)}/vote`]) {
    assert.equal(requiresTurnstile("POST", path), true);
    assert.equal(requiresTurnstile("GET", path), false);
  }
  for (const path of ["/api/recent", "/api/telegram/webhook", "/admin/login", "/api/node-info/delete", `/api/photos/${"a".repeat(36)}/manage`]) {
    assert.equal(requiresTurnstile("POST", path), false);
  }
});

test("Turnstile rejects missing tokens without contacting Cloudflare and never exposes the secret", async () => {
  const service = createTurnstile({ ...settings, fetchImpl: () => { throw new Error("must not fetch"); } });
  assert.equal((await service.verify({ headers: {} }, "127.0.0.1")).status, 403);
  assert.equal((await service.verify({ headers: { "x-turnstile-token": "x".repeat(2049) } }, "127.0.0.1")).status, 403);
  assert.equal(JSON.stringify(service.publicConfig()).includes(settings.secretKey), false);
});

test("Turnstile checks success, hostname and action with Cloudflare", async () => {
  for (const [result, expected] of [
    [{ success: true, hostname: settings.hostname, action: "map_write" }, true],
    [{ success: false, hostname: settings.hostname, action: "map_write" }, false],
    [{ success: true, hostname: "foreign.example", action: "map_write" }, false],
    [{ success: true, hostname: settings.hostname, action: "other" }, false],
    [{ success: true }, false],
  ]) {
    const service = createTurnstile({ ...settings, fetchImpl: async (url, options) => {
      assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      assert.equal(options.body.get("secret"), settings.secretKey);
      assert.equal(options.body.get("remoteip"), "127.0.0.1");
      return { ok: true, json: async () => result };
    } });
    assert.equal((await service.verify(request, "127.0.0.1")).ok, expected);
  }
});

test("Turnstile fails closed when verification is unavailable", async () => {
  const service = createTurnstile({ ...settings, fetchImpl: async () => { throw new Error("offline"); } });
  const result = await service.verify(request, "127.0.0.1");
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});
