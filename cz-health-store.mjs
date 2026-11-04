import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 2 * DAY_MS;
const SAMPLE_BUCKET_MS = 10 * 60 * 1000;

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function batteryStatus(mv, observedAt, now) {
  if (!Number.isFinite(mv)) return null;
  if (now - observedAt > STALE_MS) return "stale";
  if (mv >= 3600) return "ok";
  if (mv >= 3400) return "warn";
  return "critical";
}

function latestHealth(row, now = Date.now()) {
  if (!row) return null;
  const observedAt = Number(row.observed_at) || 0;
  const flags = safeJson(row.flags_json, {});
  return {
    prefix: row.prefix,
    kind: row.kind,
    batteryMv: row.battery_mv == null ? null : Number(row.battery_mv),
    batteryStatus: batteryStatus(Number(row.battery_mv), observedAt, now),
    temperatureC: row.temperature_c == null ? null : Number(row.temperature_c),
    temperatureSource: row.temperature_source || null,
    currentMa: row.current_ma == null ? null : Number(row.current_ma),
    charging: Boolean(flags.charging),
    externalPower: Boolean(flags.externalPower),
    alarm: Boolean(flags.alarm),
    uptimeS: row.uptime_s == null ? null : Number(row.uptime_s),
    bootAt: row.boot_at ? new Date(Number(row.boot_at)).toISOString() : null,
    resetReason: row.reset_reason || null,
    shutdownReason: row.shutdown_reason || null,
    observedAt: observedAt ? new Date(observedAt).toISOString() : null,
    deviceTime: row.device_time ? new Date(Number(row.device_time)).toISOString() : null,
    ageSec: observedAt ? Math.max(0, Math.floor((now - observedAt) / 1000)) : null,
    stale: Boolean(observedAt) && now - observedAt > STALE_MS,
  };
}

export function createCzHealthStore(dbPath, {
  retentionMs = 90 * DAY_MS,
} = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_key TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      node_key TEXT,
      kind TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      base_at INTEGER,
      device_time INTEGER,
      uptime_s INTEGER,
      boot_at INTEGER,
      reset_reason TEXT,
      shutdown_reason TEXT,
      flags_json TEXT,
      battery_mv INTEGER,
      temperature_c REAL,
      temperature_source TEXT,
      current_ma REAL,
      packet_hash TEXT,
      raw_hex TEXT
    );
    CREATE INDEX IF NOT EXISTS health_messages_prefix_time
      ON health_messages (prefix, observed_at);
    CREATE TABLE IF NOT EXISTS health_samples (
      prefix TEXT NOT NULL,
      metric TEXT NOT NULL,
      sampled_at INTEGER NOT NULL,
      value REAL NOT NULL,
      source TEXT,
      message_id INTEGER,
      PRIMARY KEY (prefix, metric, sampled_at)
    );
    CREATE INDEX IF NOT EXISTS health_samples_prefix_metric_time
      ON health_samples (prefix, metric, sampled_at);
    CREATE TABLE IF NOT EXISTS health_latest (
      prefix TEXT PRIMARY KEY,
      kind TEXT,
      observed_at INTEGER,
      base_at INTEGER,
      device_time INTEGER,
      uptime_s INTEGER,
      boot_at INTEGER,
      reset_reason TEXT,
      shutdown_reason TEXT,
      flags_json TEXT,
      battery_mv INTEGER,
      temperature_c REAL,
      temperature_source TEXT,
      current_ma REAL,
      message_key TEXT
    );
  `);

  const insertMessage = db.prepare(`
    INSERT INTO health_messages (
      message_key, prefix, node_key, kind, observed_at, base_at, device_time,
      uptime_s, boot_at, reset_reason, shutdown_reason, flags_json,
      battery_mv, temperature_c, temperature_source, current_ma, packet_hash, raw_hex
    ) VALUES (
      @message_key, @prefix, @node_key, @kind, @observed_at, @base_at, @device_time,
      @uptime_s, @boot_at, @reset_reason, @shutdown_reason, @flags_json,
      @battery_mv, @temperature_c, @temperature_source, @current_ma, @packet_hash, @raw_hex
    )
    ON CONFLICT(message_key) DO UPDATE SET
      observed_at = excluded.observed_at,
      raw_hex = COALESCE(excluded.raw_hex, health_messages.raw_hex)
  `);
  const selectMessage = db.prepare("SELECT id FROM health_messages WHERE message_key = ?");
  const upsertSample = db.prepare(`
    INSERT INTO health_samples (prefix, metric, sampled_at, value, source, message_id)
    VALUES (@prefix, @metric, @sampled_at, @value, @source, @message_id)
    ON CONFLICT(prefix, metric, sampled_at) DO UPDATE SET
      value = excluded.value,
      source = excluded.source,
      message_id = excluded.message_id
  `);
  const upsertLatest = db.prepare(`
    INSERT INTO health_latest (
      prefix, kind, observed_at, base_at, device_time, uptime_s, boot_at,
      reset_reason, shutdown_reason, flags_json, battery_mv, temperature_c,
      temperature_source, current_ma, message_key
    ) VALUES (
      @prefix, @kind, @observed_at, @base_at, @device_time, @uptime_s, @boot_at,
      @reset_reason, @shutdown_reason, @flags_json, @battery_mv, @temperature_c,
      @temperature_source, @current_ma, @message_key
    )
    ON CONFLICT(prefix) DO UPDATE SET
      kind = excluded.kind,
      observed_at = excluded.observed_at,
      base_at = excluded.base_at,
      device_time = excluded.device_time,
      uptime_s = excluded.uptime_s,
      boot_at = excluded.boot_at,
      reset_reason = excluded.reset_reason,
      shutdown_reason = excluded.shutdown_reason,
      flags_json = excluded.flags_json,
      battery_mv = excluded.battery_mv,
      temperature_c = excluded.temperature_c,
      temperature_source = excluded.temperature_source,
      current_ma = COALESCE(excluded.current_ma, health_latest.current_ma),
      message_key = excluded.message_key
    WHERE excluded.base_at >= health_latest.base_at
  `);
  const selectLatest = db.prepare("SELECT * FROM health_latest WHERE prefix = ?");
  const selectAllLatest = db.prepare("SELECT * FROM health_latest");
  const selectSamples = db.prepare(`
    SELECT metric, sampled_at, value, source
    FROM health_samples
    WHERE prefix = ? AND sampled_at >= ?
    ORDER BY sampled_at ASC
  `);
  const countRows = db.prepare("SELECT COUNT(*) AS total FROM health_messages");
  const purgeSamples = db.prepare("DELETE FROM health_samples WHERE sampled_at < ?");
  const purgeMessages = db.prepare("DELETE FROM health_messages WHERE observed_at < ?");
  const pruneLatest = db.prepare("DELETE FROM health_latest WHERE observed_at < ?");

  const record = db.transaction((health, metadata = {}) => {
    if (!health?.prefix || !health?.messageKey || !health?.kind) return null;
    const observedAt = Number(health.observedAt) || Date.now();
    const baseAt = Number(health.baseAt) || observedAt;
    const row = {
      message_key: health.messageKey,
      prefix: health.prefix,
      node_key: metadata.nodeKey || null,
      kind: health.kind,
      observed_at: observedAt,
      base_at: baseAt,
      device_time: health.deviceTime || null,
      uptime_s: health.uptimeSeconds ?? null,
      boot_at: Number.isFinite(health.bootAt) ? health.bootAt : null,
      reset_reason: health.resetReason || null,
      shutdown_reason: health.shutdownReason || null,
      flags_json: JSON.stringify(health.flags || {}),
      battery_mv: Number.isFinite(health.latestBatteryMv) ? health.latestBatteryMv : null,
      temperature_c: Number.isFinite(health.latestTemperatureC) ? health.latestTemperatureC : null,
      temperature_source: health.temperatureSource || null,
      current_ma: Number.isFinite(health.latestCurrentMa) ? health.latestCurrentMa : null,
      packet_hash: metadata.packetHash || null,
      raw_hex: metadata.rawHex || null,
    };
    insertMessage.run(row);
    const messageId = selectMessage.get(health.messageKey)?.id || null;
    const samples = [
      ...(health.battery || []).map((sample) => ({ metric: "battery", sampled_at: sample.t, value: sample.mv, source: null })),
      ...(health.temperature || []).map((sample) => ({ metric: "temperature", sampled_at: sample.t, value: sample.c, source: health.temperatureSource || null })),
      ...(health.current || []).map((sample) => ({ metric: "current", sampled_at: sample.t, value: sample.ma, source: null })),
    ];
    for (const sample of samples) {
      if (!Number.isFinite(sample.sampled_at) || !Number.isFinite(sample.value)) continue;
      upsertSample.run({
        prefix: health.prefix,
        metric: sample.metric,
        sampled_at: Math.round(sample.sampled_at / SAMPLE_BUCKET_MS) * SAMPLE_BUCKET_MS,
        value: sample.value,
        source: sample.source,
        message_id: messageId,
      });
    }
    upsertLatest.run(row);
    return messageId;
  });

  return {
    close: () => db.close(),
    count: () => countRows.get().total,
    latest: (prefix) => latestHealth(selectLatest.get(String(prefix || "").toLowerCase())),
    decorateNodes: (nodes, now = Date.now()) => {
      const byPrefix = new Map(selectAllLatest.all().map((row) => [row.prefix, row]));
      return nodes.map((node) => {
        const key = String(node.public_key || "").toLowerCase();
        const row = byPrefix.get(key.slice(0, 16));
        if (!row) return node;
        return { ...node, health: latestHealth(row, now) };
      });
    },
    history: (key, days = 7, now = Date.now()) => {
      const prefix = String(key || "").toLowerCase().slice(0, 16);
      if (!/^[0-9a-f]{16}$/.test(prefix)) return null;
      const since = now - Math.max(1, Math.min(90, Number(days) || 7)) * DAY_MS;
      const samples = selectSamples.all(prefix, since);
      const series = { battery: [], temperature: [], current: [] };
      for (const sample of samples) {
        const bucket = series[sample.metric];
        if (!bucket) continue;
        bucket.push({
          at: new Date(sample.sampled_at).toISOString(),
          value: sample.value,
          source: sample.source || null,
        });
      }
      return {
        days: Math.max(1, Math.min(90, Number(days) || 7)),
        latest: latestHealth(selectLatest.get(prefix), now),
        prefix,
        samples: series,
      };
    },
    record,
    prune: (now = Date.now()) => {
      const cutoff = now - retentionMs;
      purgeSamples.run(cutoff);
      purgeMessages.run(cutoff);
      pruneLatest.run(cutoff - 365 * DAY_MS);
    },
  };
}
