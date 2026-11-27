import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("unreachable MQTT in an ingest child does not hold the web process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-ingest-"));
  const child = fork(join(process.cwd(), "ingest.mjs"), [], {
    env: {
      ...process.env,
      CZ_HEALTH_SOURCE: "local",
      CZ_HEALTH_DB_PATH: join(directory, "health.sqlite"),
      PACKET_DB_PATH: join(directory, "packets.sqlite"),
      MQTT_URL: "wss://127.0.0.1:1/feed",
      MQTT_USERNAME: "test",
      MQTT_PASSWORD: "test",
      MQTT_RECONNECT_MS: "1000",
      MQTT_RECONNECT_MAX_MS: "2000",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    const ticks = [];
    const timer = setInterval(() => ticks.push(Date.now()), 50);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    clearInterval(timer);
    assert.ok(ticks.length >= 30, `expected a responsive parent event loop, got ${ticks.length} ticks`);
    const gaps = ticks.slice(1).map((time, index) => time - ticks[index]);
    assert.ok(Math.max(...gaps) < 500, `parent stalled for ${Math.max(...gaps)} ms`);
    assert.ok(child.connected);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
