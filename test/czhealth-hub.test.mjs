import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCzHealthHubStore } from "../czhealth-hub-store.mjs";
import { createCzHealthHubSync, retryAfterMs } from "../czhealth-hub-sync.mjs";
import { smoothHealthDips } from "../src/health-chart-utils.js";

function withStore(callback) {
  const dir = mkdtempSync(join(tmpdir(), "czhub-test-"));
  const path = join(dir, "hub.sqlite");
  const store = createCzHealthHubStore(path);
  try { return callback(store, path); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

const prefix = "26ed041b9573c63f";
const now = Date.parse("2026-11-20T05:00:00Z");
const change = (overrides = {}) => ({
  id: 1, trusted: true, repeater: prefix, received_at: "2026-11-20T04:00:05Z",
  device_time: "2026-11-20T04:00:00Z", version: 5, msg_type: "day",
  decoded: { uptime_s: 100, flags: ["charging"], temp_source: "sensor" },
  samples: [{ time: "2026-11-20T04:00:00Z", battery_mv: 3890, temp_c: null,
    current_ma: null, humidity_pct: null, battery_type: "liion", battery_cells: 1, voltage_source: "ina" }],
  ...overrides,
});
const page = (changes, cursor, more = false) => ({ changes, next_cursor: cursor, more });

test("hub page is idempotent, persists cursor and preserves nullable values", () => withStore((store, path) => {
  store.applyPage(page([change()], 1));
  store.applyPage(page([change()], 2));
  const key = `${prefix}${"0".repeat(48)}`;
  const history = store.history(key, 7, now);
  assert.equal(store.count(), 1);
  assert.equal(store.cursor(), 2);
  assert.equal(history.latest.batteryMv, 3890);
  assert.equal(history.latest.temperatureC, null);
  assert.equal(history.latest.charging, true);
  assert.equal(history.samples.temperature.length, 0);
  const reopened = createCzHealthHubStore(path);
  try { assert.equal(reopened.cursor(), 2); } finally { reopened.close(); }
}));

test("invalid change rolls back both rows and cursor; revoked messages leave samples", () => withStore((store) => {
  store.applyPage(page([change()], 1));
  assert.throws(() => store.applyPage(page([change({ id: 2 }), { id: 3, trusted: true }], 2)));
  assert.equal(store.cursor(), 1);
  assert.equal(store.count(), 1);
  store.applyPage(page([{ id: 1, trusted: false }], 3));
  assert.equal(store.count(), 0);
  assert.equal(store.history(prefix, 7, now).samples.battery[0].value, 3890);
}));

test("sample updates, summary, stats, regions and prefix collisions", () => withStore((store) => {
  store.applyPage(page([
    change(),
    change({ id: 2, msg_type: "config", received_at: "2026-11-20T04:10:00Z", device_time: null,
      decoded: { home_region: "CZ", flood_regions: ["A"], regions_present: true, firmware_version: "RC10" }, samples: [] }),
    change({ id: 3, msg_type: "config", received_at: "2026-11-20T04:20:00Z", device_time: null,
      decoded: { regions_present: false, board_name: "board" }, samples: [] }),
    change({ id: 4, msg_type: "stats", received_at: "2026-11-20T04:30:00Z", device_time: null,
      decoded: { period_min: 1440, tx_airtime_s: 10, unwanted: "not stored" }, samples: [] }),
    change({ id: 5, msg_type: "summary", received_at: "2026-11-20T04:40:00Z", device_time: null,
      decoded: { battery_mv: { last: 4000 } }, samples: [] }),
  ], 5));
  const key = `${prefix}${"0".repeat(48)}`;
  const data = store.history(key, 7, now);
  assert.equal(data.config.regions.home, "CZ");
  assert.equal(data.latest.boardName, "board");
  assert.equal(data.latest.batteryMv, 4000);
  assert.equal(data.latest.stats.tx_airtime_s, 10);
  assert.equal(data.latest.stats.unwanted, undefined);
  const nodes = store.decorateNodes([{ public_key: key }, { public_key: `${prefix}${"1".repeat(48)}` }], now);
  assert.equal(nodes[0].health, undefined);
}));

test("sample revisions overwrite exact timestamp and unmeasured voltage has no rating", () => withStore((store) => {
  const item = change();
  store.applyPage(page([item], 1));
  store.applyPage(page([change({ id: 2, samples: [{ ...item.samples[0], battery_mv: 3700, voltage_source: "none" }] })], 2));
  const history = store.history(prefix, 7, now);
  assert.equal(history.samples.battery.length, 1);
  assert.equal(history.latest.batteryMv, 3700);
  assert.equal(history.latest.batteryStatus, null);
}));

test("revoking the newest report restores previous metadata without deleting samples", () => withStore((store) => {
  store.applyPage(page([
    change(),
    change({ id: 2, received_at: "2026-11-20T04:30:00Z", device_time: "2026-11-20T04:30:00Z",
      decoded: { uptime_s: 500, reset: "watchdog", flags: [] }, samples: [] }),
  ], 2));
  assert.equal(store.history(prefix, 7, now).latest.resetReason, "watchdog");
  store.applyPage(page([{ id: 2, trusted: false }], 3));
  assert.equal(store.history(prefix, 7, now).latest.resetReason, null);
  assert.equal(store.history(prefix, 7, now).samples.battery.length, 1);
}));

test("public key must match its repeater prefix", () => withStore((store) => {
  assert.throws(() => store.applyPage(page([change({ public_key: "f".repeat(64) })], 1)));
  assert.equal(store.cursor(), 0);
}));

test("chart smoothing removes short downward dips, not peaks or long changes", () => {
  const input = [4000, 3900, 4000, 4100, 4000].map((value, time) => ({ time: time * 1000, value }));
  assert.deepEqual(smoothHealthDips(input, "battery", 2000).map((item) => item.value), [4000, 4000, 4000, 4100, 4000]);
  const long = [4000, 3900, 3900, 3900, 4000].map((value, time) => ({ time: time * 1000, value }));
  assert.deepEqual(smoothHealthDips(long, "battery", 2000), long);
  assert.deepEqual(smoothHealthDips(input, "battery", 500), input);
  const pair = [4000, 3900, 3900, 4000].map((value, time) => ({ time: time * 1000, value }));
  assert.deepEqual(smoothHealthDips(pair, "battery", 2000).map((point) => point.value), [4000, 4000, 4000, 4000]);
  const current = [50, -100, 50].map((value, time) => ({ time: time * 1000, value }));
  assert.deepEqual(smoothHealthDips(current, "current", 2000).map((point) => point.value), [50, 50, 50]);
});

test("retry-after supports seconds and dates", () => {
  assert.equal(retryAfterMs("120", now), 120000);
  assert.equal(retryAfterMs(new Date(now + 5000).toUTCString(), now), 5000);
});

test("hub synchronizer fetches pages and resumes at committed cursor", async () => {
  const pages = [page([change()], 1, true), page([], 2)];
  const seen = [], logs = [];
  let cursor = 0;
  const store = { cursor: () => cursor, applyPage(value) { cursor = value.next_cursor; } };
  const sync = createCzHealthHubSync({ store, apiKey: "secret", clientId: "id", clientSecret: "secret2",
    logger: { warn: (message) => logs.push(message) },
    fetchImpl: async (url, options) => {
      seen.push({ cursor: url.searchParams.get("cursor"), auth: options.headers.Authorization });
      return new Response(JSON.stringify(pages.shift()), { headers: { "Content-Type": "application/json" } });
    },
  });
  sync.start();
  for (let i = 0; i < 100 && cursor !== 2; i += 1) await new Promise((resolve) => setImmediate(resolve));
  sync.stop();
  assert.deepEqual(seen.map((entry) => entry.cursor), ["0", "1"]);
  assert.equal(cursor, 2);
  assert.equal(logs.length, 0);
});

test("hub HTTP errors never log secrets or change cursor", async () => {
  const logs = [], calls = [];
  const store = { cursor: () => 3, applyPage() { throw new Error("should not write"); } };
  const sync = createCzHealthHubSync({ store, apiKey: "super-secret", clientId: "client", clientSecret: "another-secret",
    logger: { warn: (message) => logs.push(message) },
    fetchImpl: async (url) => { calls.push(url.href); return new Response("<html>private</html>", { status: 403 }); },
  });
  sync.start();
  for (let i = 0; i < 50 && !logs.length; i += 1) await new Promise((resolve) => setImmediate(resolve));
  sync.stop();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /403/);
  assert.doesNotMatch(JSON.stringify({ logs, calls }), /super-secret|another-secret|private/);
});

test("rate limiting honors retry-after without an immediate retry", async () => {
  let calls = 0;
  const logs = [];
  const store = { cursor: () => 0, applyPage() { throw new Error("should not write"); } };
  const sync = createCzHealthHubSync({ store, apiKey: "key", clientId: "id", clientSecret: "secret",
    logger: { warn: (message) => logs.push(message) },
    fetchImpl: async () => { calls += 1; return new Response("", { status: 429, headers: { "Retry-After": "600" } }); },
  });
  sync.start();
  for (let i = 0; i < 50 && !logs.length; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await sync.run();
  sync.stop();
  assert.equal(calls, 1);
  assert.equal(sync.getState().lastError, "rate-limit");
});
