import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decodeCzHealth } from "../cz-health.mjs";
import { createCzHealthStore } from "../cz-health-store.mjs";

const SAMPLE_PACKET = "1941adade046ffc10d3e2f1b92a57e41f47fae80f5683c8c90f6b7ad7fd55c63eae16b64ca5b555fd715e04f65c83c5835afe391abab61563136cd7f8310c2acfe481fbaaae5f4";
const OBSERVED_AT = 1_793_777_100_000;

test("CzHealth decoder parses the reference DAY packet", () => {
  const health = decodeCzHealth(SAMPLE_PACKET, OBSERVED_AT);
  assert.ok(health);
  assert.equal(health.kind, "day");
  assert.equal(health.prefix, "26ed041b9573c63f");
  assert.equal(health.route, 1);
  assert.equal(health.hops, 1);
  assert.deepEqual(health.battery, [{ t: 1_793_776_881_000, mv: 3766 }]);
  assert.deepEqual(health.temperature, [{ t: 1_793_776_881_000, c: 27.5 }]);
  assert.equal(health.latestBatteryMv, 3766);
  assert.equal(health.latestTemperatureC, 27.5);
  assert.equal(health.temperatureSource, "mcu");
  assert.equal(health.uptimeSeconds, 192);
  assert.equal(health.resetReason, "unknown");
  assert.equal(health.shutdownReason, null);
  assert.equal(health.clock, true);
  assert.deepEqual(health.flags, {
    clock: true,
    boot: true,
    externalPower: true,
    charging: false,
    alarm: false,
    manual: true,
  });
});

test("CzHealth decoder rejects corrupted channel MACs", () => {
  const corrupted = `${SAMPLE_PACKET.slice(0, -2)}${SAMPLE_PACKET.endsWith("00") ? "01" : "00"}`;
  assert.equal(decodeCzHealth(corrupted, OBSERVED_AT), null);
});

test("CzHealth store decorates nodes and returns sample history", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const health = decodeCzHealth(SAMPLE_PACKET, OBSERVED_AT);
    assert.ok(health);
    assert.ok(store.record(health, { packetHash: "packet-1" }));
    assert.equal(store.record(health, { packetHash: "packet-2" }), store.record(health, { packetHash: "packet-3" }));

    const publicKey = `${health.prefix}${"0".repeat(48)}`;
    const [node] = store.decorateNodes([{ public_key: publicKey, name: "Test" }], OBSERVED_AT);
    assert.equal(node.name, "Test");
    assert.equal(node.health.batteryMv, 3766);
    assert.equal(node.health.batteryStatus, "ok");
    assert.equal(node.health.temperatureC, 27.5);
    assert.equal(node.health.externalPower, true);
    assert.equal(node.health.charging, false);

    const history = store.history(publicKey, 7, OBSERVED_AT);
    assert.equal(history.days, 7);
    assert.equal(history.samples.battery.length, 1);
    assert.equal(history.samples.battery[0].value, 3766);
    assert.equal(history.samples.temperature.length, 1);
    assert.equal(history.samples.temperature[0].value, 27.5);
    assert.equal(history.latest.batteryMv, 3766);
    assert.equal(store.count(), 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CzHealth store marks old latest values as stale", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const health = decodeCzHealth(SAMPLE_PACKET, OBSERVED_AT);
    store.record(health);
    const publicKey = `${health.prefix}${"0".repeat(48)}`;
    const [node] = store.decorateNodes([{ public_key: publicKey }], OBSERVED_AT + 3 * 24 * 60 * 60 * 1000);
    assert.equal(node.health.stale, true);
    assert.equal(node.health.batteryStatus, "stale");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CzHealth store accepts SUMMARY packets without sample arrays", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const observedAt = OBSERVED_AT + 60_000;
    const health = {
      baseAt: observedAt,
      battery: { avg: 4000, last: 4020, max: 4050, min: 3950 },
      flags: {},
      kind: "summary",
      latestBatteryMv: 4020,
      latestTemperatureC: 23.5,
      messageKey: "summary-packet-1",
      observedAt,
      prefix: "0123456789abcdef",
      temperature: { last: 23.5, max: 25, min: 22 },
      temperatureSource: "mcu",
    };
    assert.ok(store.record(health));
    const publicKey = `${health.prefix}${"0".repeat(48)}`;
    const history = store.history(publicKey, 1, observedAt);
    assert.equal(history.samples.battery.length, 1);
    assert.equal(history.samples.battery[0].value, 4020);
    assert.equal(history.samples.temperature.length, 1);
    assert.equal(history.samples.temperature[0].value, 23.5);
    assert.equal(history.latest.batteryMv, 4020);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
