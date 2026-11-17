import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createHttpRequestHandler } from "../http-server.mjs";
import { createTurnstile } from "../turnstile.mjs";

async function withServer(runtime, run) {
  const handler = createHttpRequestHandler({
    getNodesCache: () => null,
    getStatsCache: () => null,
    securityHeaders: {},
    requestBase: "http://localhost",
    writeAllowedHosts: new Set(["127.0.0.1"]),
    writeAllowedOrigins: new Set(["https://mapa.meshcore.cz"]),
    clientIp: (request) => request.socket.remoteAddress,
    sendJson: (response, status, body, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", ...headers });
      response.end(JSON.stringify(body));
    },
    ...runtime,
  });
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => response.writeHead(500).end());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("enabled Turnstile rejects spoofed-origin writes without touching the data store", async () => {
  let writes = 0;
  const turnstile = createTurnstile({
    enabled: true, siteKey: "site", secretKey: "secret", hostname: "mapa.meshcore.cz",
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, hostname: "mapa.meshcore.cz", action: "map_write" }) }),
  });
  await withServer({
    turnstile,
    checkNodeInfo: () => ({ ok: true }),
    readBody: async () => JSON.stringify({ key: "a".repeat(64), text: "Testovací info" }),
    nodeInfoStore: { submit: () => { writes += 1; return { status: "published", info: {} }; } },
    notifyNodeInfo: () => {},
  }, async (base) => {
    const rejected = await fetch(`${base}/api/node-info`, { method: "POST", headers: { Origin: "https://mapa.meshcore.cz" } });
    assert.equal(rejected.status, 403);
    assert.equal(writes, 0);
    const accepted = await fetch(`${base}/api/node-info`, {
      method: "POST", headers: { Origin: "https://mapa.meshcore.cz", "X-Turnstile-Token": "verified-once" },
    });
    assert.equal(accepted.status, 200);
    assert.equal(writes, 1);
    const config = await fetch(`${base}/api/security/config`).then((response) => response.json());
    assert.deepEqual(config, { enabled: true, siteKey: "site" });
  });
});

test("SSE per-IP capacity rejects an extra connection and releases it after disconnect", async () => {
  const streams = new Set();
  await withServer({
    turnstile: createTurnstile(),
    checkLiveRead: () => ({ ok: true }),
    packetStreams: streams,
    maxPacketStreams: 100,
    maxPacketStreamsPerIp: 1,
    visitStore: { recordVisit: () => {}, updatePeak: () => {} },
    broadcastStatus: () => { for (const stream of streams) stream.response.write("event: status\ndata: {}\n\n"); },
  }, async (base) => {
    const headers = { Origin: "https://mapa.meshcore.cz" };
    const first = await fetch(`${base}/events/packets?replay=0`, { headers });
    assert.equal(first.status, 200);
    assert.equal(streams.size, 1);
    const second = await fetch(`${base}/events/packets?replay=0`, { headers });
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "60");
    await first.body.cancel();
    for (let tries = 0; streams.size && tries < 50; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(streams.size, 0);
    const third = await fetch(`${base}/events/packets?replay=0`, { headers });
    assert.equal(third.status, 200);
    await third.body.cancel();
  });
});
