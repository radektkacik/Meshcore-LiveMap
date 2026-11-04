import { createDecipheriv, createHash, createHmac } from "node:crypto";

export const CZ_HEALTH_SECRET = Buffer.from("26cff13d1579ccf0ccd29a2986c01c93", "hex");
const CHANNEL_HASH = 0xe0;
const MESSAGE_TYPE = 0xffc9;
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
  if (body.length < 2) return null;
  const count = clampCount(body[0], 48);
  const ageMinutes = body[1];
  if (count == null || body.length < 5 + count + 1) return null;
  const base = body.readUInt16LE(2);
  const step = body[4];
  const newest = baseAt - ageMinutes * 60_000;
  const battery = [];
  for (let index = 0; index < count; index += 1) {
    const code = body[5 + index];
    if (code === 0xff) continue;
    battery.push({
      t: newest - (count - 1 - index) * 1_800_000,
      mv: base + code * step,
    });
  }

  let offset = 5 + count;
  const tempByte = body[offset];
  offset += 1;
  const sourceCode = (tempByte >> 6) & 0x03;
  const slots = clampCount(tempByte & 0x3f, 12);
  if (slots == null || body.length < offset + slots + 1) return null;
  const temperature = [];
  for (let index = 0; index < slots; index += 1) {
    const value = temperatureFromCode(body.readInt8(offset + index));
    if (value == null) continue;
    temperature.push({
      t: newest - (slots - 1 - index) * 7_200_000,
      c: value,
    });
  }
  offset += slots;

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
      current.push({
        t: newest - (currentCount - 1 - index) * 7_200_000,
        ma: code * currentStep,
      });
    }
  }

  return {
    battery,
    current,
    currentStep,
    latestBatteryMv: battery.at(-1)?.mv ?? null,
    latestCurrentMa: current.at(-1)?.ma ?? null,
    latestTemperatureC: temperature.at(-1)?.c ?? null,
    temperature,
    temperatureSource: ["mcu", "sensor"][sourceCode - 1] || null,
  };
}

function parseSummary(body) {
  if (body.length < 13) return null;
  const batteryMin = body.readUInt16LE(1) || null;
  const batteryAvg = body.readUInt16LE(3) || null;
  const batteryMax = body.readUInt16LE(5) || null;
  const batteryLast = body.readUInt16LE(7) || null;
  const sourceCode = body[9];
  const temperatureMin = temperatureFromCode(body.readInt8(10));
  const temperatureMax = temperatureFromCode(body.readInt8(11));
  const temperatureLast = temperatureFromCode(body.readInt8(12));
  return {
    battery: {
      min: batteryMin,
      avg: batteryAvg,
      max: batteryMax,
      last: batteryLast,
    },
    samples: body[0],
    temperature: {
      min: temperatureMin,
      max: temperatureMax,
      last: temperatureLast,
    },
    temperatureSource: ["mcu", "sensor"][sourceCode - 1] || null,
    latestBatteryMv: batteryLast,
    latestTemperatureC: temperatureLast,
    latestCurrentMa: null,
  };
}

export function decodeCzHealth(rawHex, observedAt = Date.now()) {
  try {
    if (typeof rawHex !== "string" || rawHex.length % 2) return null;
    const raw = Buffer.from(rawHex, "hex");
    if (raw.length < 2 || raw.toString("hex") !== rawHex.toLowerCase()) return null;
    const packet = readPacketPayload(raw);
    if (!packet) return null;
    const message = decryptChannelPayload(packet.payload);
    if (!message || message.length < 23) return null;
    if (message[0] !== 0x43 || message[1] !== 0x48 || message[2] !== 1) return null;
    const kind = message[3] === 1 ? "day" : message[3] === 2 ? "summary" : null;
    if (!kind) return null;
    const prefix = message.subarray(5, 13).toString("hex");
    if (!/^[0-9a-f]{16}$/.test(prefix)) return null;
    const { baseAt, deviceTime, flags, clock } = baseTime(message, observedAt);
    const uptimeSeconds = message.readUInt32LE(17);
    const resetCode = message[21] & 0x0f;
    const shutdownCode = message[21] >> 4;
    const body = message.subarray(23, message.length - 16);
    const parsed = kind === "day" ? parseDay(body, baseAt) : parseSummary(body);
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
