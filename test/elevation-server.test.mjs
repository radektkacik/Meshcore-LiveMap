import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/stats`);
      if (response.ok) return;
    } catch {
      // Startup includes opening SQLite and initiating the metrics request.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Server did not start in time");
}

test("HTTP elevation proxy caches results and falls back to a second provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-elevation-"));
  let primaryStatus = 200;
  let primaryCalls = 0;
  let fallbackCalls = 0;

  const primary = createServer((req, res) => {
    if (req.url?.startsWith("/elevation")) {
      primaryCalls += 1;
      if (primaryStatus !== 200) {
        res.writeHead(primaryStatus, { "Content-Type": "application/json" });
        res.end('{"error":true}');
        return;
      }
      const count = new URL(req.url, "http://localhost").searchParams.get("latitude").split(",").length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ elevation: Array.from({ length: count }, (_, index) => 100 + index) }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"packetsLastHour":1}');
  });
  const fallback = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      fallbackCalls += 1;
      const locations = JSON.parse(body).locations;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: locations.map((_, index) => ({ elevation: 500 + index })) }));
    });
  });

  const primaryPort = await listen(primary);
  const fallbackPort = await listen(fallback);
  const reservation = createServer();
  const appPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CORESCOPE_URL: `http://127.0.0.1:${primaryPort}`,
      ELEVATION_FALLBACK_URL: `http://127.0.0.1:${fallbackPort}/lookup`,
      ELEVATION_UPSTREAM: `http://127.0.0.1:${primaryPort}/elevation`,
      FEEDBACK_DB_PATH: join(directory, "feedback.sqlite"),
      HOST: "127.0.0.1",
      PACKET_DB_PATH: join(directory, "packets.sqlite"),
      PORT: String(appPort),
      SCORE_DB_PATH: join(directory, "metrics.sqlite"),
      UPSTREAM_TIMEOUT_MS: "100",
      VISITS_DB_PATH: join(directory, "visits.sqlite"),
    },
    stdio: "ignore",
  });

  try {
    await waitForServer(appPort, child);

    const first = await fetch(`http://127.0.0.1:${appPort}/api/elevation?latitude=50.08,50.09&longitude=14.42,14.43`);
    assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).elevation, [100, 101]);
    assert.equal(primaryCalls, 1);

    const cached = await fetch(`http://127.0.0.1:${appPort}/api/elevation?latitude=50.08,50.09&longitude=14.42,14.43`);
    assert.equal(cached.status, 200);
    assert.deepEqual((await cached.json()).elevation, [100, 101]);
    assert.equal(primaryCalls, 1);

    primaryStatus = 429;
    const fallbackResponse = await fetch(`http://127.0.0.1:${appPort}/api/elevation?latitude=51.08,51.09&longitude=15.42,15.43`);
    assert.equal(fallbackResponse.status, 200);
    assert.deepEqual((await fallbackResponse.json()).elevation, [500, 501]);
    assert.equal(fallbackCalls, 1);

    const invalid = await fetch(`http://127.0.0.1:${appPort}/api/elevation?latitude=50.08&longitude=14.42,14.43`);
    assert.equal(invalid.status, 400);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => primary.close(resolve));
    await new Promise((resolve) => fallback.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
