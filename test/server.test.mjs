import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function rawRequest(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ body, status: response.statusCode }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/stats`);
      if (response.ok) return;
    } catch {
      // Startup includes opening SQLite and initiating the metrics request.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start in time");
}

test("HTTP server handles malformed URLs, upstream timeout and SSE limits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-server-"));
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3z1wAAAABJRU5ErkJggg==", "base64");
  let nodesFail = false;
  const upstream = createServer((req, res) => {
    if (req.url?.startsWith("/terrarium/")) {
      res.writeHead(200, { "Content-Type": "image/png" }).end(tinyPng);
      return;
    }
    if (req.url?.startsWith("/api/nodes")) {
      if (nodesFail) {
        res.writeHead(502, { "Content-Type": "application/json" }).end('{"error":"down"}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"nodes":[]}');
      return;
    }
    if (req.url === "/api/stats?slow=1") {
      setTimeout(() => res.writeHead(200).end("{}"), 500);
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"packetsLastHour":1}');
  });
  const upstreamPort = await listen(upstream);
  const reservation = createServer();
  const appPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CORESCOPE_URL: `http://127.0.0.1:${upstreamPort}`,
      HOST: "127.0.0.1",
      MAX_PACKET_STREAMS: "1",
      NODES_CACHE_PATH: join(directory, "nodes-cache.json"),
      PACKET_DB_PATH: join(directory, "packets.sqlite"),
      FEEDBACK_DB_PATH: join(directory, "feedback.sqlite"),
      FEEDBACK_TOKEN: "test-token",
      PORT: String(appPort),
      SCORE_DB_PATH: join(directory, "metrics.sqlite"),
      VISITS_DB_PATH: join(directory, "visits.sqlite"),
      TERRAIN_UPSTREAM: `http://127.0.0.1:${upstreamPort}/terrarium`,
      UPSTREAM_TIMEOUT_MS: "100",
    },
    stdio: "ignore",
  });

  let firstStream;
  try {
    await waitForServer(appPort, child);
    const secured = await fetch(`http://127.0.0.1:${appPort}/api/stats`);
    assert.equal(secured.headers.get("x-content-type-options"), "nosniff");
    assert.equal(secured.headers.get("x-frame-options"), "DENY");
    assert.match(secured.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.match(secured.headers.get("permissions-policy") || "", /geolocation=\(\)/);
    assert.equal(secured.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.equal((await rawRequest(appPort, "/%")).status, 400);
    const terrainTile = await fetch(`http://127.0.0.1:${appPort}/api/terrain/11/1/1.png`);
    assert.equal(terrainTile.status, 200);
    assert.equal(terrainTile.headers.get("content-type"), "image/png");
    assert.match(terrainTile.headers.get("cache-control") || "", /immutable/);
    assert.ok((await terrainTile.arrayBuffer()).byteLength > 0);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/terrain/11/9999/1.png`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/terrain/20/1/1.png`)).status, 400);
    const nodesFresh = await fetch(`http://127.0.0.1:${appPort}/api/nodes?limit=2000`);
    assert.equal(nodesFresh.status, 200);
    nodesFail = true;
    const nodesStale = await fetch(`http://127.0.0.1:${appPort}/api/nodes?limit=2000`);
    assert.equal(nodesStale.status, 200);
    assert.equal(nodesStale.headers.get("x-data-stale"), "1");
    assert.ok(Array.isArray((await nodesStale.json()).nodes));
    nodesFail = false;
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/stats`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/stats?slow=1`)).status, 504);
    const historyResponse = await fetch(`http://127.0.0.1:${appPort}/api/history?since=0`);
    assert.equal(historyResponse.status, 200);
    const historyBody = await historyResponse.json();
    assert.ok(Array.isArray(historyBody.packets));
    const defaultHistory = await fetch(`http://127.0.0.1:${appPort}/api/history`);
    assert.equal(defaultHistory.status, 200);
    const defaultHistoryBody = await defaultHistory.json();
    assert.ok(defaultHistoryBody.since > Date.now() - 2 * 24 * 60 * 60 * 1000);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/node-history?key=short`)).status, 400);
    const nodeHistory = await fetch(`http://127.0.0.1:${appPort}/api/node-history?key=${"a".repeat(64)}&days=7`);
    assert.equal(nodeHistory.status, 200);
    assert.ok(Array.isArray((await nodeHistory.json()).samples));
    const visitsResponse = await fetch(`http://127.0.0.1:${appPort}/api/visit-stats?days=7`);
    assert.equal(visitsResponse.status, 200);
    const visitsBody = await visitsResponse.json();
    assert.ok(Array.isArray(visitsBody.series));

    const feedbackPost = await fetch(`http://127.0.0.1:${appPort}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "bug", message: "Testovací zpráva" }),
    });
    assert.equal(feedbackPost.status, 200);
    assert.equal((await feedbackPost.json()).ok, true);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/feedback`)).status, 404);
    const feedbackList = await fetch(`http://127.0.0.1:${appPort}/api/feedback?token=test-token`);
    assert.equal(feedbackList.status, 200);
    const feedbackBody = await feedbackList.json();
    assert.equal(feedbackBody.count, 1);
    assert.equal(feedbackBody.entries[0].message, "Testovací zpráva");

    firstStream = request({ host: "127.0.0.1", port: appPort, path: "/events/packets" });
    let streamBody = "";
    await new Promise((resolve, reject) => {
      firstStream.once("response", (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk) => { streamBody += chunk; });
        resolve();
      });
      firstStream.once("error", reject);
      firstStream.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.match(streamBody, /event: status/);
    assert.match(streamBody, /"viewers":1/);
    assert.match(streamBody, /"time":\d+/);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/events/packets`)).status, 503);
    assert.equal(child.exitCode, null);
  } finally {
    firstStream?.destroy();
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
