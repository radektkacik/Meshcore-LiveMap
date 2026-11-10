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

function buildV4HealthPacket(body, {
  kind = 1,
  flags = 0x01,
  prefix = "0123456789abcdef",
  observedAt = OBSERVED_AT,
  deviceTime = null,
  uptimeSeconds = 60,
  resetByte = 0x01,
} = {}) {
  const message = Buffer.alloc(21);
  message[0] = 4;
  message[1] = kind;
  message[2] = 1;
  Buffer.from(prefix, "hex").copy(message, 3);
  message.writeUInt32LE(deviceTime == null ? Math.floor(observedAt / 1000) : deviceTime, 11);
  message.writeUInt32LE(uptimeSeconds, 15);
  message[19] = resetByte;
  message[20] = flags;
  const fullMessage = Buffer.concat([message, body, Buffer.alloc(8)]);
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

test("CzHealth decoder parses the exact v4 DAY reference example", () => {
  const body = Buffer.from("01001d00a00f010000026aff010000320100", "hex");
  const health = decodeCzHealth(buildV4HealthPacket(body), OBSERVED_AT);
  assert.ok(health);
  assert.equal(health.formatVersion, 4);
  assert.equal(health.kind, "day");
  assert.equal(health.prefix, "0123456789abcdef");
  const newest = Math.floor(OBSERVED_AT / 1000) * 1000;
  assert.deepEqual(health.battery, [{ t: newest, mv: 4000, source: "adc" }]);
  assert.deepEqual(health.temperature, [{ t: newest, c: 21 }]);
  assert.deepEqual(health.current, [{ t: newest, ma: -150 }]);
  assert.deepEqual(health.humidity, [{ t: newest, pct: 50 }]);
  assert.equal(health.batteryType, "auto");
  assert.equal(health.batteryCells, 1);
  assert.equal(health.temperatureSource, "mcu");
  assert.equal(health.latestBatteryMv, 4000);
  assert.equal(health.latestTemperatureC, 21);
  assert.equal(health.latestCurrentMa, -150);
  assert.equal(health.latestHumidityPct, 50);
  assert.equal(health.latestVoltageSource, "adc");
  assert.equal(health.currentStep, 1);
});

test("CzHealth decoder falls back to receive time for bad v4 clocks", () => {
  const body = Buffer.from("01001d00a00f010000026aff010000320100", "hex");
  const health = decodeCzHealth(
    buildV4HealthPacket(body, { deviceTime: 1, observedAt: OBSERVED_AT }),
    OBSERVED_AT,
  );
  assert.ok(health);
  assert.equal(health.clock, false);
  assert.equal(health.clockFlag, true);
  assert.equal(health.deviceTime, 1000);
  assert.equal(health.baseAt, Math.floor(OBSERVED_AT / 1000) * 1000);
  assert.equal(health.battery[0].t, Math.floor(OBSERVED_AT / 1000) * 1000);
});

test("CzHealth decoder parses v4 CONFIG tag 4 with unknown TLV and snapshot states", () => {
  const example = decodeCzHealth(buildV4HealthPacket(Buffer.from("000402a12a", "hex"), { kind: 3 }), OBSERVED_AT);
  assert.ok(example);
  assert.equal(example.formatVersion, 4);
  assert.equal(example.kind, "config");
  assert.equal(example.regionsPresent, true);
  assert.deepEqual(example.regions, { home: "*", default: null, flood: ["*"], incomplete: false });

  const unknown = decodeCzHealth(
    buildV4HealthPacket(Buffer.from("0063036e65770402a12a", "hex"), { kind: 3 }),
    OBSERVED_AT,
  );
  assert.ok(unknown);
  assert.deepEqual(unknown.regions, example.regions);

  const empty = decodeCzHealth(buildV4HealthPacket(Buffer.from("000400", "hex"), { kind: 3 }), OBSERVED_AT);
  assert.ok(empty);
  assert.equal(empty.regionsPresent, true);
  assert.deepEqual(empty.regions, { home: null, default: null, flood: [], incomplete: false });

  const absent = decodeCzHealth(buildV4HealthPacket(Buffer.from("0063036e6577", "hex"), { kind: 3 }), OBSERVED_AT);
  assert.ok(absent);
  assert.equal(absent.regionsPresent, false);
  assert.equal(absent.regions, null);
});

test("CzHealth decoder rejects invalid v4 CONFIG region snapshots", () => {
  const badLength = Buffer.from([0, 4, 1, 0]);
  const duplicateNames = Buffer.from([0, 4, 4, 0x21, 0x61, 0x21, 0x61]);
  const multipleHome = Buffer.from([0, 4, 4, 0x21, 0x61, 0x21, 0x62]);
  const invalidUtf8 = Buffer.from([0, 4, 2, 0x21, 0xff]);
  const blockWithLegacy = Buffer.from([0, 4, 2, 0x21, 0x61, 1, 1, 0x68]);
  for (const body of [badLength, duplicateNames, multipleHome, invalidUtf8, blockWithLegacy]) {
    assert.equal(decodeCzHealth(buildV4HealthPacket(body, { kind: 3 }), OBSERVED_AT), null);
  }
});

test("CzHealth decoder parses v4 SUMMARY without creating sample history", () => {
  const body = Buffer.alloc(20);
  body[0] = 3;
  body.writeUInt16LE(3900, 1);
  body.writeUInt16LE(4000, 3);
  body.writeUInt16LE(4100, 5);
  body.writeUInt16LE(4050, 7);
  body[9] = 2;
  body.writeInt8(10, 10);
  body.writeInt8(20, 11);
  body.writeInt8(15, 12);
  body[13] = 30;
  body[14] = 70;
  body[15] = 55;
  body[16] = 1;
  body[17] = 2;
  body[18] = 1;
  body[19] = 2;
  const health = decodeCzHealth(buildV4HealthPacket(body, { kind: 2 }), OBSERVED_AT);
  assert.ok(health);
  assert.equal(health.formatVersion, 4);
  assert.deepEqual(health.battery, []);
  assert.deepEqual(health.temperature, []);
  assert.deepEqual(health.summary.battery, { min: 3900, avg: 4000, max: 4100, last: 4050 });
  assert.deepEqual(health.summary.temperature, { min: 25, max: 30, last: 27.5 });
  assert.deepEqual(health.summary.humidity, { min: 30, max: 70, last: 55 });
  assert.equal(health.batteryType, "liion");
  assert.equal(health.batteryCells, 2);
  assert.equal(health.latestVoltageSource, "adc");
});

test("CzHealth decoder handles v4 six-bit voltage steps, mixed sources and missing values", () => {
  const stepBody = Buffer.from("01000100a00f2c010480", "hex");
  const stepped = decodeCzHealth(buildV4HealthPacket(stepBody), OBSERVED_AT);
  assert.ok(stepped);
  assert.deepEqual(stepped.battery.map((sample) => sample.mv), [4300]);
  assert.deepEqual(stepped.temperature, []);

  const mixedBody = Buffer.concat([
    Buffer.from([5, 0, 0x41, 0xf1]), // n=5, age=0, MCU + mixed sources, 16 cells
    Buffer.from("a00f0100", "hex"),
    Buffer.from("00000000", "hex"), // five voltage codes: 0,0,0,0,0
    Buffer.from([0x80, 0x80]), // two temperature slots, both unavailable
    Buffer.from([0x39, 0x01]), // source pairs: adc,ina,bms,none (last slot adc)
  ]);
  const mixed = decodeCzHealth(buildV4HealthPacket(mixedBody), OBSERVED_AT);
  assert.ok(mixed);
  assert.equal(mixed.batteryCells, 16);
  assert.deepEqual(mixed.voltageSources, ["adc", "ina", "bms", "none", "adc"]);
  assert.deepEqual(mixed.battery.map((sample) => sample.source), ["adc", "ina", "bms", "none", "adc"]);
  assert.deepEqual(mixed.temperature, []);

  const currentBody = Buffer.concat([
    Buffer.from([1, 0, 0x05, 0x00]),
    Buffer.from("a00f0100", "hex"),
    Buffer.from([0x00, 0x80]), // voltage 4000 mV, temperature unavailable
    Buffer.from("00000100", "hex"), // current base 0, step 1
    Buffer.from([0x00]), // zero current
  ]);
  const zeroCurrent = decodeCzHealth(buildV4HealthPacket(currentBody), OBSERVED_AT);
  assert.ok(zeroCurrent);
  assert.deepEqual(zeroCurrent.current, [{ t: Math.floor(OBSERVED_AT / 1000) * 1000, ma: 0 }]);
  assert.equal(zeroCurrent.latestCurrentMa, 0);
});

test("CzHealth decoder rejects invalid v4 six-bit padding and reserved flags", () => {
  const badVoltagePadding = Buffer.from("01000100a00f01000180", "hex");
  assert.equal(decodeCzHealth(buildV4HealthPacket(badVoltagePadding), OBSERVED_AT), null);
  const reservedFlags = Buffer.from("01008100a00f01000080", "hex");
  assert.equal(decodeCzHealth(buildV4HealthPacket(reservedFlags), OBSERVED_AT), null);
  assert.equal(decodeCzHealth(buildV4HealthPacket(Buffer.from("01000100a00f01000080", "hex"), { flags: 0x81 }), OBSERVED_AT), null);
});

test("CzHealth store keeps v3 and v4 messages side by side", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const v3 = decodeCzHealth(DAY_LIFEPO4, OBSERVED_AT);
    assert.ok(v3);
    const v4 = decodeCzHealth(
      buildV4HealthPacket(Buffer.from("01001d00a00f2c0104026aff010000320100", "hex"), {
        prefix: v3.prefix,
        observedAt: OBSERVED_AT + 60_000,
      }),
      OBSERVED_AT + 60_000,
    );
    assert.ok(v4);
    store.record(v3);
    store.record(v4);
    const publicKey = `${v3.prefix}${"0".repeat(48)}`;
    const [node] = store.decorateNodes([{ public_key: publicKey }], OBSERVED_AT + 60_000);
    assert.equal(node.health.formatVersion, 4);
    assert.equal(node.health.batteryMv, 4300);
    const history = store.history(publicKey, 7, OBSERVED_AT + 60_000);
    assert.equal(history.samples.battery.length, 2);
    assert.ok(history.samples.battery.some((sample) => sample.value === 3312));
    assert.ok(history.samples.battery.some((sample) => sample.value === 4300));
    assert.equal(store.count(), 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CzHealth store preserves CONFIG regions when a v4 message has no region block", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const prefix = "0123456789abcdef";
    const withRegions = decodeCzHealth(
      buildV4HealthPacket(Buffer.from("000402a12a", "hex"), { kind: 3, prefix }),
      OBSERVED_AT,
    );
    const withoutRegions = decodeCzHealth(
      buildV4HealthPacket(Buffer.from("0063036e6577", "hex"), {
        kind: 3,
        prefix,
        observedAt: OBSERVED_AT + 60_000,
      }),
      OBSERVED_AT + 60_000,
    );
    assert.ok(withRegions);
    assert.ok(withoutRegions);
    store.record(withRegions);
    store.record(withoutRegions);
    const publicKey = `${prefix}${"0".repeat(48)}`;
    const config = store.config(publicKey);
    assert.equal(config.regionsPresent, false);
    assert.deepEqual(config.regions, { home: "*", default: null, flood: ["*"], incomplete: false });
    const [node] = store.decorateNodes([{ public_key: publicKey }], OBSERVED_AT + 60_000);
    assert.equal(node.health, undefined);
    assert.equal(node.healthConfig.regionsPresent, false);
    assert.equal(node.healthConfig.regions.home, "*");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
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
    assert.equal(node.health.batteryStatus, "ok");
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

test("CzHealth store applies chemistry and series cell thresholds", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-health-"));
  const store = createCzHealthStore(join(directory, "health.sqlite"));
  try {
    const cases = [
      { batteryType: "liion", batteryCells: 1, mv: 4100, expected: "full" },
      { batteryType: "liion", batteryCells: 2, mv: 7200, expected: "ok" },
      { batteryType: "lifepo4", batteryCells: 1, mv: 3312, expected: "ok" },
      { batteryType: "lifepo4", batteryCells: 2, mv: 5800, expected: "critical" },
      { batteryType: "lto", batteryCells: 1, mv: 2500, expected: "ok" },
      { batteryType: "lead", batteryCells: 1, mv: 2000, expected: "warn" },
      { batteryType: "auto", batteryCells: 1, mv: 4100, expected: "full" },
      { batteryType: "auto", batteryCells: 1, mv: 3700, expected: "ok" },
      { batteryType: "auto", batteryCells: 1, mv: 3450, expected: "warn" },
      { batteryType: "auto", batteryCells: 1, mv: 3300, expected: "critical" },
      { batteryType: "liion", batteryCells: null, mv: 4000, expected: null },
      { batteryType: "liion", batteryCells: 1, mv: 4000, source: "none", expected: null },
    ];
    const nodes = cases.map((entry, index) => {
      const prefix = String(index + 1).padStart(16, "0");
      store.record({
        baseAt: OBSERVED_AT,
        battery: [],
        batteryCells: entry.batteryCells,
        batteryType: entry.batteryType,
        clock: true,
        current: [],
        flags: {},
        humidity: [],
        kind: "day",
        latestBatteryMv: entry.mv,
        latestCurrentMa: null,
        latestHumidityPct: null,
        latestTemperatureC: null,
        latestVoltageSource: entry.source || "adc",
        messageKey: `status-${index}`,
        observedAt: OBSERVED_AT,
        prefix,
        temperature: [],
      });
      return { public_key: `${prefix}${"0".repeat(48)}` };
    });
    const decorated = store.decorateNodes(nodes, OBSERVED_AT);
    assert.deepEqual(decorated.map((node) => node.health.batteryStatus), cases.map((entry) => entry.expected));
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
