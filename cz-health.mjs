import { createDecipheriv, createHash, createHmac } from "node:crypto";

export const CZ_HEALTH_SECRET = Buffer.from("26cff13d1579ccf0ccd29a2986c01c93", "hex");
const CHANNEL_HASH = 0xe0;
const MESSAGE_TYPE = 0xffc9;
const MESSAGE_VERSION = 3;
const RESET_REASONS = [
  "unknown",
  "power_on",
  "brownout",
  "reset_pin",
  "software",
  "watchdog",
  "crash",
  "wake",
  "wake_power",
  "other",
];
const SHUTDOWN_REASONS = [null, "low_voltage", "user", "boot_protect"];
const BATTERY_TYPES = [
  "auto",
  "liion",
  "lifepo4",
  "lto",
  "naion",
  "lead",
  "other",
  "lto-vlastik",
  "naion-vlastik",
];
const VOLTAGE_SOURCES = ["none", "adc", "ina", "bms"];
const TEMPERATURE_SOURCES = [null, "mcu", "sensor"];
const FLAG_BITS = {
  clock: 0x01,
  boot: 0x02,
  externalPower: 0x04,
  charging: 0x08,
  alarm: 0x10,
  manual: 0x20,
};

function readPacketPayload(raw) {
  if (!Buffer.isBuffer(raw) || raw.length < 2) return null;
  const route = raw[0] & 0x03;
  const payloadType = (raw[0] >> 2) & 0x0f;
  if (payloadType !== 6) return null;
  let offset = 1;
  if (route === 0 || route === 3) offset += 4;
  if (offset >= raw.length) return null;
  const pathByte = raw[offset];
  offset += 1;
  const hops = pathByte & 0x3f;
  const hashBytes = (pathByte >> 6) + 1;
  offset += hops * hashBytes;
  if (offset > raw.length) return null;
  return { payload: raw.subarray(offset), route, hops };
}

function decryptChannelPayload(payload) {
  if (!payload || payload.length < 19 || payload[0] !== CHANNEL_HASH) return null;
  if ((payload.length - 3) % 16 !== 0) return null;
  const ciphertext = payload.subarray(3);
  const mac = createHmac("sha256", Buffer.concat([CZ_HEALTH_SECRET, Buffer.alloc(16)]))
    .update(ciphertext)
    .digest();
  if (mac[0] !== payload[1] || mac[1] !== payload[2]) return null;
  try {
    const decipher = createDecipheriv("aes-128-ecb", CZ_HEALTH_SECRET, null);
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plain.length < 3 || plain.readUInt16LE(0) !== MESSAGE_TYPE) return null;
    const length = plain[2];
    if (!length || 3 + length > plain.length) return null;
    return plain.subarray(3, 3 + length);
  } catch {
    return null;
  }
}

function clampCount(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function temperatureFromCode(code) {
  return code === -128 ? null : 20 + code / 2;
}

function sourceName(value) {
  return VOLTAGE_SOURCES[value] ?? null;
}

function formatFlags(flags) {
  return Object.fromEntries(
    Object.entries(FLAG_BITS).map(([name, bit]) => [name, Boolean(flags & bit)]),
  );
}

function baseTime(message, observedAt) {
  const flags = message[22] || 0;
  const deviceTime = message.readUInt32LE(13);
  const clock = Boolean(flags & FLAG_BITS.clock) && deviceTime > 0;
  const baseSeconds = clock ? deviceTime : Math.floor(observedAt / 1000);
  return {
    baseAt: baseSeconds * 1000,
    deviceTime: clock ? deviceTime * 1000 : null,
    flags,
    clock,
  };
}

function parseDay(body, baseAt) {
  let offset = 0;
  if (body.length < 5) return null;

  const count = clampCount(body[offset], 48);
  offset += 1;
  const ageMinutes = body[offset];
  offset += 1;
  const baseMv = body.readUInt16LE(offset);
  offset += 2;
  const stepMv = body[offset];
  offset += 1;
  if (count == null) return null;

  const newest = baseAt - ageMinutes * 60_000;
  if (body.length < offset + count) return null;
  const battery = [];
  for (let index = 0; index < count; index += 1) {
    const code = body[offset + index];
    if (code === 0xff) continue;
    battery.push({
      t: newest - (count - 1 - index) * 1_800_000,
      mv: baseMv + code * stepMv,
      sourceIndex: index,
    });
  }
  offset += count;

  if (body.length < offset + 1) return null;
  const temperatureByte = body[offset];
  offset += 1;
  const temperatureSource = TEMPERATURE_SOURCES[(temperatureByte >> 6) & 0x03] || null;
  const temperatureCount = clampCount(temperatureByte & 0x3f, 12);
  if (temperatureCount == null || body.length < offset + temperatureCount) return null;
  const temperature = [];
  for (let index = 0; index < temperatureCount; index += 1) {
    const value = temperatureFromCode(body.readInt8(offset + index));
    if (value == null) continue;
    temperature.push({ t: newest - (temperatureCount - 1 - index) * 7_200_000, c: value });
  }
  offset += temperatureCount;

  if (body.length < offset + 1) return null;
  const currentCount = clampCount(body[offset], 12);
  offset += 1;
  if (currentCount == null) return null;
  let currentStep = null;
  const current = [];
  if (currentCount > 0) {
    if (body.length < offset + 1 + currentCount) return null;
    currentStep = body[offset];
    offset += 1;
    for (let index = 0; index < currentCount; index += 1) {
      const code = body.readInt8(offset + index);
      if (code === -128) continue;
      current.push({ t: newest - (currentCount - 1 - index) * 7_200_000, ma: code * currentStep });
    }
    offset += currentCount;
  }

  if (body.length < offset + 1) return null;
  const humidityCount = clampCount(body[offset], 12);
  offset += 1;
  if (humidityCount == null || body.length < offset + humidityCount) return null;
  const humidity = [];
  for (let index = 0; index < humidityCount; index += 1) {
    const value = body[offset + index];
    if (value === 0xff) continue;
    if (value > 100) return null;
    humidity.push({ t: newest - (humidityCount - 1 - index) * 7_200_000, pct: value });
  }
  offset += humidityCount;

  if (body.length < offset + 2) return null;
  const batteryType = BATTERY_TYPES[body[offset]] ?? null;
  offset += 1;
  const batteryCells = body[offset] >= 1 && body[offset] <= 16 ? body[offset] : null;
  offset += 1;

  const sourceBytes = Math.ceil(count / 4);
  if (body.length < offset + sourceBytes) return null;
  const voltageSources = [];
  for (let index = 0; index < count; index += 1) {
    const sourceByte = body[offset + Math.floor(index / 4)];
    voltageSources.push(sourceName((sourceByte >> ((index % 4) * 2)) & 0x03));
  }
  offset += sourceBytes;
  if (offset !== body.length) return null;

  const latestBattery = battery.at(-1) || null;
  const latestTemperature = temperature.at(-1) || null;
  const latestCurrent = current.at(-1) || null;
  const latestHumidity = humidity.at(-1) || null;
  return {
    battery: battery.map(({ sourceIndex, ...sample }) => ({
      ...sample,
      source: voltageSources[sourceIndex] ?? null,
    })),
    batteryCells,
    batteryType,
    current,
    currentStep,
    humidity,
    latestBatteryMv: latestBattery?.mv ?? null,
    latestCurrentMa: latestCurrent?.ma ?? null,
    latestHumidityPct: latestHumidity?.pct ?? null,
    latestTemperatureC: latestTemperature?.c ?? null,
    latestVoltageSource: voltageSources[latestBattery?.sourceIndex] ?? null,
    voltageSource: voltageSources[latestBattery?.sourceIndex] ?? null,
    temperature,
    temperatureSource,
    voltageSources,
  };
}

function parseSummary(body) {
  if (body.length !== 20) return null;
  const valueOrNull = (value) => (value === 0 ? null : value);
  const temperatureValue = (value) => temperatureFromCode(value);
  const humidityValue = (value) => (value === 0xff ? null : value > 100 ? null : value);
  const batteryType = BATTERY_TYPES[body[16]] ?? null;
  const batteryCells = body[17] >= 1 && body[17] <= 16 ? body[17] : null;
  const voltageSource = sourceName(body[18]);
  const battery = {
    min: valueOrNull(body.readUInt16LE(1)),
    avg: valueOrNull(body.readUInt16LE(3)),
    max: valueOrNull(body.readUInt16LE(5)),
    last: valueOrNull(body.readUInt16LE(7)),
  };
  const temperature = {
    min: temperatureValue(body.readInt8(10)),
    max: temperatureValue(body.readInt8(11)),
    last: temperatureValue(body.readInt8(12)),
  };
  const humidity = {
    min: humidityValue(body[13]),
    max: humidityValue(body[14]),
    last: humidityValue(body[15]),
  };
  return {
    battery: [],
    batteryCells,
    batteryType,
    current: [],
    currentStep: null,
    humidity: [],
    latestBatteryMv: battery.last,
    latestCurrentMa: null,
    latestHumidityPct: humidity.last,
    latestTemperatureC: temperature.last,
    latestVoltageSource: voltageSource,
    voltageSource,
    samples: body[0],
    summary: {
      battery,
      batteryCells,
      batteryType,
      humidity,
      samples: body[0],
      sourceMask: body[19],
      temperature,
      temperatureSource: TEMPERATURE_SOURCES[body[9]] || null,
      voltageSource,
    },
    temperature: [],
    temperatureSource: TEMPERATURE_SOURCES[body[9]] || null,
    voltageSources: [],
  };
}

function parseConfig(body) {
  if (body.length < 3) return null;
  const incomplete = Boolean(body[0] & 0x01);
  const seen = { 1: false, 2: false };
  const regions = { home: null, default: null, flood: [], incomplete };
  let offset = 1;
  while (offset < body.length) {
    if (offset + 2 > body.length) return null;
    const tag = body[offset];
    offset += 1;
    const length = body[offset];
    offset += 1;
    if (offset + length > body.length) return null;
    const value = body.subarray(offset, offset + length);
    offset += length;

    if (tag === 1 || tag === 2) {
      if (seen[tag]) return null;
      seen[tag] = true;
      const name = value.toString("utf8");
      if (tag === 1) regions.home = name || null;
      else regions.default = name || null;
    } else if (tag === 3) {
      const name = value.toString("utf8");
      if (name) regions.flood.push(name);
    }
  }
  if (!seen[1] || !seen[2]) return null;
  return { regions };
}

export function decodeCzHealth(rawHex, observedAt = Date.now()) {
  try {
    if (typeof rawHex !== "string" || rawHex.length % 2) return null;
    const raw = Buffer.from(rawHex, "hex");
    if (raw.length < 2 || raw.toString("hex") !== rawHex.toLowerCase()) return null;
    const packet = readPacketPayload(raw);
    if (!packet) return null;
    const message = decryptChannelPayload(packet.payload);
    if (!message || message.length < 40) return null;
    if (message[0] !== 0x43 || message[1] !== 0x48 || message[2] !== MESSAGE_VERSION) return null;
    const kind = message[3] === 1 ? "day" : message[3] === 2 ? "summary" : message[3] === 3 ? "config" : null;
    if (!kind) return null;
    const prefix = message.subarray(5, 13).toString("hex");
    if (!/^[0-9a-f]{16}$/.test(prefix)) return null;
    const { baseAt, deviceTime, flags, clock } = baseTime(message, observedAt);
    const uptimeSeconds = message.readUInt32LE(17);
    const resetCode = message[21] & 0x0f;
    const shutdownCode = message[21] >> 4;
    const body = message.subarray(23, message.length - 16);
    const parsed = kind === "day"
      ? parseDay(body, baseAt)
      : kind === "summary"
        ? parseSummary(body)
        : parseConfig(body);
    if (!parsed) return null;
    return {
      ...parsed,
      baseAt,
      bootAt: baseAt - uptimeSeconds * 1000,
      deviceTime,
      flags: formatFlags(flags),
      hops: packet.hops,
      kind,
      messageKey: createHash("sha256").update(message).digest("hex"),
      observedAt,
      prefix,
      resetReason: RESET_REASONS[resetCode] || "other",
      route: packet.route,
      shutdownReason: SHUTDOWN_REASONS[shutdownCode] || null,
      uptimeSeconds,
      clock,
    };
  } catch {
    return null;
  }
}
