import assert from "node:assert/strict";
import { createCipheriv, createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CZ_HEALTH_SECRET, decodeCzHealth } from "../cz-health.mjs";
import { createCzHealthStore } from "../cz-health-store.mjs";

const OBSERVED_AT = Date.parse("2026-11-06T17:58:55Z");

// Real v3 packets captured from the live Analyzer feed.
const DAY_LIFEPO4 = "1940e08ae0ee140df8540ad4686f2fbd5a636ad94f93e1108207b95614e2aa6b60e70208ae42b4376d69373ad8e12712a8f583087257137278da1817182215653c061e80fd";
const DAY_SENSOR = "1940e065d98d067bfbaec1ee42b6885cde16974d6d46ae25fbf57771c907107190f94601e57d9efe2aa5c6f48d45e52c226881991cd05ffe5ef26116aa24e1fa76a6ba7679";
const SUMMARY = "19437AD31EFA3342E06CA499F68EE90BD14281171106FD887E9F23EC7F4128FB6619DAD9FE51ABAC6F521B3FC2C6F7499BF4E7E495D65484B933D84CBF555BC8DAF98B94309D2FB8233582";
const CONFIG = "19440B36E6214F7C3342E00C5A373AFAD2EBE8C97FFFF3BB905D86B533CF71E98541151EAF3C5B9953D1E61814D0AE1F8D6004C90FFF58C5C1FC74678BD8BD7F262061B4E720482408A14AEFF1D97DA88BDEA53FDA376C899D37762250";
const V1_PACKET = "1941adade046ffc10d3e2f1b92a57e41f47fae80f5683c8c90f6b7ad7fd55c63eae16b64ca5b555fd715e04f65c83c5835afe391abab61563136cd7f8310c2acfe481fbaaae5f4";

function buildHealthPacket(body, {
  kind = 3,
  version = 3,
  flags = 0x01,
  prefix = "0123456789abcdef",
  observedAt = OBSERVED_AT,
  uptimeSeconds = 60,
} = {}) {
  const message = Buffer.alloc(23);
  message.write("CH", 0, "ascii");
  message[2] = version;
  message[3] = kind;
  message[4] = 1;
  Buffer.from(prefix, "hex").copy(message, 5);
  message.writeUInt32LE(Math.floor(observedAt / 1000), 13);
  message.writeUInt32LE(uptimeSeconds, 17);
  message[21] = 0x01;
  message[22] = flags;
  const fullMessage = Buffer.concat([message, body, Buffer.alloc(16)]);
  const plain = Buffer.alloc(3 + fullMessage.length);
  plain.writeUInt16LE(0xffc9, 0);
  plain[2] = fullMessage.length;
  fullMessage.copy(plain, 3);
  const padding = (16 - (plain.length % 16)) % 16;
  const padded = Buffer.concat([plain, Buffer.alloc(padding)]);
  const cipher = createCipheriv("aes-128-ecb", CZ_HEALTH_SECRET, null);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const mac = createHmac("sha256", Buffer.concat([CZ_HEALTH_SECRET, Buffer.alloc(16)]))
    .update(ciphertext)
    .digest();
  const payload = Buffer.concat([Buffer.from([0xe0, mac[0], mac[1]]), ciphertext]);
  return Buffer.concat([Buffer.from([0x19, 0x41, 0xaa, 0xbb]), payload]).toString("hex");
}

function tlv(tag, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
}

test("CzHealth decoder parses v3 DAY with battery, temperature, current and humidity", () => {
  const health = decodeCzHealth(DAY_LIFEPO4, OBSERVED_AT);
  assert.ok(health);
  assert.equal(health.kind, "day");
  assert.equal(health.prefix, "adadc4537ddb3cfc");
  assert.deepEqual(health.battery, [{ t: 1793987633000, mv: 3312, source: "ina" }]);
  assert.deepEqual(health.temperature, [{ t: 1793987633000, c: 21 }]);
  assert.deepEqual(health.current, [{ t: 1793987633000, ma: -43 }]);
  assert.deepEqual(health.humidity, []);
  assert.equal(health.latestBatteryMv, 3312);
  assert.equal(health.latestTemperatureC, 21);
  assert.equal(health.latestCurrentMa, -43);
  assert.equal(health.latestHumidityPct, null);
  assert.equal(health.batteryType, "lifepo4");
  assert.equal(health.batteryCells, 1);
  assert.equal(health.latestVoltageSource, "ina");
  assert.equal(health.temperatureSource, "mcu");
  assert.equal(health.uptimeSeconds, 517);
  assert.equal(health.resetReason, "power_on");
  assert.equal(health.clock, true);
});

test("CzHealth decoder parses v3 DAY sensor temperature and zero humidity", () => {
  const health = decodeCzHealth(DAY_SENSOR, OBSERVED_AT);
  assert.ok(health);
  assert.equal(health.prefix, "68b76d583edd44b6");
  assert.equal(health.latestTemperatureC, 22.5);
  assert.equal(health.temperatureSource, "sensor");
  assert.deepEqual(health.humidity, [{ t: 1793985256000, pct: 52 }]);
  assert.equal(health.latestHumidityPct, 52);
  assert.equal(health.latestCurrentMa, -65);
  assert.equal(health.latestVoltageSource, "ina");
});

test("CzHealth decoder parses v3 SUMMARY without creating history", () => {
  const health = decodeCzHealth(SUMMARY, OBSERVED_AT);
  assert.ok(health);
  assert.equal(health.kind, "summary");
  assert.deepEqual(health.battery, []);
  assert.deepEqual(health.temperature, []);
  assert.deepEqual(health.humidity, []);
  assert.equal(health.summary.samples, 2);
  assert.deepEqual(health.summary.battery, { min: 4185, avg: 4185, max: 4185, last: 4185 });
  assert.deepEqual(health.summary.temperature, { min: 7, max: 7.5, last: 7 });
  assert.deepEqual(health.summary.humidity, { min: null, max: null, last: null });
  assert.equal(health.batteryType, "auto");
  assert.equal(health.batteryCells, 1);
  assert.equal(health.voltageSource, "adc");
  assert.equal(health.summary.sourceMask, 2);
});

test("CzHealth decoder parses v3 CONFIG and preserves region order", () => {
  const health = decodeCzHealth(CONFIG, OBSERVED_AT);
  assert.ok(health);
  assert.equal(health.kind, "config");
  assert.equal(health.prefix, "d9479fa620ffcfa3");
  assert.deepEqual(health.regions, {
    home: "*",
    default: null,
    flood: ["*", "#cz", "#cz-jmk", "#cz-brno", "cs"],
    incomplete: false,
  });
  assert.equal(health.latestBatteryMv, undefined);
});

test("CzHealth decoder rejects the old v1 format and corrupted MACs", () => {
  assert.equal(decodeCzHealth(V1_PACKET, OBSERVED_AT), null);
  const corrupted = `${DAY_LIFEPO4.slice(0, -2)}${DAY_LIFEPO4.endsWith("00") ? "01" : "00"}`;
  assert.equal(decodeCzHealth(corrupted, OBSERVED_AT), null);
});

test("CzHealth decoder rejects invalid body lengths and values", () => {
  const validDay = Buffer.from("0100e40c010041020000010101", "hex");
  assert.ok(decodeCzHealth(buildHealthPacket(validDay, { kind: 1 }), OBSERVED_AT));
  assert.equal(decodeCzHealth(buildHealthPacket(Buffer.concat([validDay, Buffer.from([0])]), { kind: 1 }), OBSERVED_AT), null);
  assert.equal(decodeCzHealth(buildHealthPacket(Buffer.from([0x01]), { kind: 2 }), OBSERVED_AT), null);
});

test("CzHealth decoder skips unknown CONFIG tags and handles incomplete lists", () => {
  const body = Buffer.concat([
    Buffer.from([0x01]),
    tlv(99, Buffer.from("future")),
    tlv(1, Buffer.from("home")),
    tlv(2, Buffer.alloc(0)),
    tlv(3, Buffer.from("*")),
  ]);
  const health = decodeCzHealth(buildHealthPacket(body), OBSERVED_AT);
  assert.ok(health);
  assert.deepEqual(health.regions, {
    home: "home",
    default: null,
    flood: ["*"],
    incomplete: true,
  });
});

test("CzHealth decoder rejects missing, duplicate and truncated CONFIG tags", () => {
  const missingDefault = Buffer.concat([Buffer.from([0]), tlv(1, Buffer.from("home"))]);
  const duplicateHome = Buffer.concat([Buffer.from([0]), tlv(1, Buffer.from("a")), tlv(1, Buffer.from("b")), tlv(2, Buffer.alloc(0))]);
  const truncated = Buffer.concat([Buffer.from([0]), tlv(1, Buffer.from("home")), Buffer.from([2, 5, 0x61])]);
  assert.equal(decodeCzHealth(buildHealthPacket(missingDefault), OBSERVED_AT), null);
  assert.equal(decodeCzHealth(buildHealthPacket(duplicateHome), OBSERVED_AT), null);
  assert.equal(decodeCzHealth(buildHealthPacket(truncated), OBSERVED_AT), null);
});

test("CzHealth store decorates v3 sensor data and history", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const health = decodeCzHealth(DAY_LIFEPO4, OBSERVED_AT);
    assert.ok(health);
    assert.ok(store.record(health, { packetHash: "packet-1" }));
    assert.ok(store.record(health, { packetHash: "packet-2" }));

    const publicKey = `${health.prefix}${"0".repeat(48)}`;
    const [node] = store.decorateNodes([{ public_key: publicKey, name: "Test" }], OBSERVED_AT);
    assert.equal(node.name, "Test");
    assert.equal(node.health.batteryMv, 3312);
    assert.equal(node.health.batteryType, "lifepo4");
    assert.equal(node.health.batteryCells, 1);
    assert.equal(node.health.voltageSource, "ina");
    assert.equal(node.health.batteryStatus, null);
    assert.equal(node.health.temperatureC, 21);
    assert.equal(node.health.humidityPct, null);

    const history = store.history(publicKey, 7, OBSERVED_AT);
    assert.equal(history.samples.battery.length, 1);
    assert.equal(history.samples.battery[0].value, 3312);
    assert.equal(history.samples.temperature.length, 1);
    assert.equal(history.samples.current.length, 1);
    assert.equal(history.samples.humidity.length, 0);
    assert.equal(history.latest.batteryMv, 3312);
    assert.equal(store.count(), 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CzHealth store keeps SUMMARY ranges without adding samples", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const health = decodeCzHealth(SUMMARY, OBSERVED_AT);
    assert.ok(health);
    store.record(health);
    const publicKey = `${health.prefix}${"0".repeat(48)}`;
    const history = store.history(publicKey, 1, OBSERVED_AT);
    assert.equal(history.samples.battery.length, 0);
    assert.equal(history.samples.temperature.length, 0);
    assert.equal(history.latest.batteryMv, 4185);
    assert.deepEqual(history.latest.summary.battery, { min: 4185, avg: 4185, max: 4185, last: 4185 });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CzHealth store keeps CONFIG separate from sensor measurements", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const health = decodeCzHealth(CONFIG, OBSERVED_AT);
    assert.ok(health);
    store.record(health);
    const publicKey = `${health.prefix}${"0".repeat(48)}`;
    const [node] = store.decorateNodes([{ public_key: publicKey }], OBSERVED_AT);
    assert.equal(node.health, undefined);
    assert.equal(node.healthConfig.regions.home, "*");
    assert.deepEqual(node.healthConfig.regions.flood, ["*", "#cz", "#cz-jmk", "#cz-brno", "cs"]);
    const history = store.history(publicKey, 7, OBSERVED_AT);
    assert.equal(history.latest, null);
    assert.equal(history.config.regions.home, "*");
    assert.equal(history.samples.battery.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CzHealth store does not move a measurement timestamp backwards", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const health = decodeCzHealth(DAY_SENSOR, OBSERVED_AT);
    assert.ok(health);
    const publicKey = `${health.prefix}${"0".repeat(48)}`;
    store.record({ ...health, observedAt: OBSERVED_AT + 60_000 }, { packetHash: "later" });
    store.record({ ...health, observedAt: OBSERVED_AT }, { packetHash: "older" });
    const history = store.history(publicKey, 1, OBSERVED_AT + 60_000);
    assert.equal(history.latest.observedAt, new Date(OBSERVED_AT + 60_000).toISOString());
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CzHealth store keeps the last sensor time when CONFIG arrives", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const day = decodeCzHealth(DAY_SENSOR, OBSERVED_AT);
    const configBody = Buffer.concat([
      Buffer.from([0]),
      tlv(1, Buffer.from("home")),
      tlv(2, Buffer.alloc(0)),
      tlv(3, Buffer.from("*")),
    ]);
    const config = decodeCzHealth(
      buildHealthPacket(configBody, { prefix: day.prefix }),
      OBSERVED_AT + 60_000,
    );
    assert.ok(day);
    assert.ok(config);
    store.record(day);
    store.record(config);
    const publicKey = `${day.prefix}${"0".repeat(48)}`;
    const [node] = store.decorateNodes([{ public_key: publicKey }], OBSERVED_AT + 60_000);
    assert.equal(node.health.observedAt, new Date(OBSERVED_AT).toISOString());
    assert.ok(node.healthConfig);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CzHealth store ignores old v1 rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    assert.equal(decodeCzHealth(V1_PACKET, OBSERVED_AT), null);
    const [node] = store.decorateNodes([{ public_key: `${"26ed041b9573c63f"}${"0".repeat(48)}` }], OBSERVED_AT);
    assert.equal(node.health, undefined);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
