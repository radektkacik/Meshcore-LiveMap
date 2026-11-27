import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("isolated ingest announces status and keeps the web process independent", async () => {
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
    const status = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ingest did not report status")), 10_000);
      child.on("message", (message) => {
        if (message?.type !== "status") return;
        clearTimeout(timer);
        resolve(message);
      });
    });
    assert.equal(status.enabled, true);
    assert.equal(status.state.connected, false);
    assert.equal(status.state.reconnects, 0);
    assert.ok(readFileSync(join(directory, "packets.sqlite")).length > 0);
    assert.ok(readFileSync(join(directory, "health.sqlite")).length > 0);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
