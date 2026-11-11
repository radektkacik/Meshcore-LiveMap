import { openSqliteStore } from "./sqlite-store.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 2 * DAY_MS;
const CONFIG_STALE_MS = 8 * DAY_MS;
const SAMPLE_BUCKET_MS = 10 * 60 * 1000;

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

const BATTERY_LEVELS = {
  liion: { full: 4050, ok: 3600, warn: 3400 },
  lifepo4: { full: 3350, ok: 3200, warn: 3000 },
  lto: { full: 2600, ok: 2400, warn: 2200 },
  lead: { full: 2100, ok: 2050, warn: 1950 },
};

function batteryStatus(mv, observedAt, now, { batteryType = null, batteryCells = null, voltageSource = null } = {}) {
  if (!Number.isFinite(mv)) return null;
  if (now - observedAt > STALE_MS) return "stale";
  if (voltageSource === "none") return null;
  const levels = batteryType === "auto"
    ? BATTERY_LEVELS.liion
    : batteryType === "lto-vlastik"
      ? (voltageSource === "bms" ? BATTERY_LEVELS.lto : null)
      : BATTERY_LEVELS[batteryType];
  if (!levels) return null;
  if (!Number.isFinite(batteryCells) || batteryCells < 1) return null;
  const perCellMv = mv / batteryCells;
  if (perCellMv >= levels.full) return "full";
  if (perCellMv >= levels.ok) return "ok";
  if (perCellMv >= levels.warn) return "warn";
  return "critical";
}

function latestConfig(row, now = Date.now()) {
  if (!row) return null;
  const observedAt = Number(row.observed_at) || 0;
  return {
    observedAt: observedAt ? new Date(observedAt).toISOString() : null,
    ageSec: observedAt ? Math.max(0, Math.floor((now - observedAt) / 1000)) : null,
    stale: Boolean(observedAt) && now - observedAt > CONFIG_STALE_MS,
    formatVersion: Number(row.format_version) || null,
    regionsPresent: row.regions_present == null ? true : Boolean(row.regions_present),
    regions_present: row.regions_present == null ? true : Boolean(row.regions_present),
    regions: {
      home: row.home_region || null,
      default: row.default_region || null,
      flood: safeJson(row.flood_regions_json, []),
      incomplete: Boolean(row.incomplete),
    },
  };
}

function latestHealth(row, now = Date.now()) {
  if (!row) return null;
  const observedAt = Number(row.observed_at) || 0;
  const flags = safeJson(row.flags_json, {});
  return {
    prefix: row.prefix,
    kind: row.kind,
    formatVersion: Number(row.format_version) || null,
    batteryMv: row.battery_mv == null ? null : Number(row.battery_mv),
    batteryStatus: batteryStatus(Number(row.battery_mv), observedAt, now, {
      batteryType: row.battery_type,
      batteryCells: row.battery_cells,
      voltageSource: row.voltage_source,
    }),
    batteryType: row.battery_type || null,
    batteryCells: row.battery_cells == null ? null : Number(row.battery_cells),
    voltageSource: row.voltage_source || null,
    humidityPct: row.humidity_pct == null ? null : Number(row.humidity_pct),
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
    summary: safeJson(row.summary_json, null),
    observedAt: observedAt ? new Date(observedAt).toISOString() : null,
    deviceTime: row.device_time ? new Date(Number(row.device_time)).toISOString() : null,
    ageSec: observedAt ? Math.max(0, Math.floor((now - observedAt) / 1000)) : null,
    stale: Boolean(observedAt) && now - observedAt > STALE_MS,
  };
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function createCzHealthStore(dbPath, {
  retentionMs = 90 * DAY_MS,
} = {}) {
  const db = openSqliteStore(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_key TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      node_key TEXT,
      kind TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1,
      observed_at INTEGER NOT NULL,
      base_at INTEGER,
      device_time INTEGER,
      uptime_s INTEGER,
      boot_at INTEGER,
      reset_reason TEXT,
      shutdown_reason TEXT,
      flags_json TEXT,
      battery_mv INTEGER,
      battery_type TEXT,
      battery_cells INTEGER,
      voltage_source TEXT,
      humidity_pct REAL,
      temperature_c REAL,
      temperature_source TEXT,
      current_ma REAL,
      summary_json TEXT,
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
      format_version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (prefix, metric, sampled_at)
    );
    CREATE INDEX IF NOT EXISTS health_samples_prefix_metric_time
      ON health_samples (prefix, metric, sampled_at);
    CREATE TABLE IF NOT EXISTS health_latest (
      prefix TEXT PRIMARY KEY,
      kind TEXT,
      format_version INTEGER NOT NULL DEFAULT 1,
      observed_at INTEGER,
      base_at INTEGER,
      device_time INTEGER,
      uptime_s INTEGER,
      boot_at INTEGER,
      reset_reason TEXT,
      shutdown_reason TEXT,
      flags_json TEXT,
      battery_mv INTEGER,
      battery_type TEXT,
      battery_cells INTEGER,
      voltage_source TEXT,
      humidity_pct REAL,
      temperature_c REAL,
      temperature_source TEXT,
      current_ma REAL,
      summary_json TEXT,
      message_key TEXT
    );
    CREATE TABLE IF NOT EXISTS health_config (
      prefix TEXT PRIMARY KEY,
      format_version INTEGER NOT NULL DEFAULT 3,
      observed_at INTEGER NOT NULL,
      base_at INTEGER,
      device_time INTEGER,
      home_region TEXT,
      default_region TEXT,
      flood_regions_json TEXT,
      incomplete INTEGER NOT NULL DEFAULT 0,
      regions_present INTEGER NOT NULL DEFAULT 1,
      message_key TEXT
    );
  `);

  ensureColumn(db, "health_messages", "format_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "health_messages", "battery_type", "TEXT");
  ensureColumn(db, "health_messages", "battery_cells", "INTEGER");
  ensureColumn(db, "health_messages", "voltage_source", "TEXT");
  ensureColumn(db, "health_messages", "humidity_pct", "REAL");
  ensureColumn(db, "health_messages", "summary_json", "TEXT");
  ensureColumn(db, "health_samples", "format_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "health_latest", "format_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "health_latest", "battery_type", "TEXT");
  ensureColumn(db, "health_latest", "battery_cells", "INTEGER");
  ensureColumn(db, "health_latest", "voltage_source", "TEXT");
  ensureColumn(db, "health_latest", "humidity_pct", "REAL");
  ensureColumn(db, "health_latest", "summary_json", "TEXT");
  ensureColumn(db, "health_config", "regions_present", "INTEGER NOT NULL DEFAULT 1");

  const insertMessage = db.prepare(`
    INSERT INTO health_messages (
      message_key, prefix, node_key, kind, format_version, observed_at, base_at, device_time,
      uptime_s, boot_at, reset_reason, shutdown_reason, flags_json, battery_mv,
      battery_type, battery_cells, voltage_source, humidity_pct, temperature_c,
      temperature_source, current_ma, summary_json, packet_hash, raw_hex
    ) VALUES (
      @message_key, @prefix, @node_key, @kind, @format_version, @observed_at, @base_at, @device_time,
      @uptime_s, @boot_at, @reset_reason, @shutdown_reason, @flags_json, @battery_mv,
      @battery_type, @battery_cells, @voltage_source, @humidity_pct, @temperature_c,
      @temperature_source, @current_ma, @summary_json, @packet_hash, @raw_hex
    )
    ON CONFLICT(message_key) DO UPDATE SET
      format_version = excluded.format_version,
      observed_at = MAX(health_messages.observed_at, excluded.observed_at),
      raw_hex = COALESCE(excluded.raw_hex, health_messages.raw_hex)
  `);
  const selectMessage = db.prepare("SELECT id FROM health_messages WHERE message_key = ?");
  const upsertSample = db.prepare(`
    INSERT INTO health_samples (prefix, metric, sampled_at, value, source, message_id, format_version)
    VALUES (@prefix, @metric, @sampled_at, @value, @source, @message_id, @format_version)
    ON CONFLICT(prefix, metric, sampled_at) DO UPDATE SET
      value = excluded.value,
      source = excluded.source,
      message_id = excluded.message_id,
      format_version = excluded.format_version
  `);
  const upsertLatest = db.prepare(`
    INSERT INTO health_latest (
      prefix, kind, format_version, observed_at, base_at, device_time, uptime_s, boot_at,
      reset_reason, shutdown_reason, flags_json, battery_mv, battery_type, battery_cells,
      voltage_source, humidity_pct, temperature_c, temperature_source, current_ma,
      summary_json, message_key
    ) VALUES (
      @prefix, @kind, @format_version, @observed_at, @base_at, @device_time, @uptime_s, @boot_at,
      @reset_reason, @shutdown_reason, @flags_json, @battery_mv, @battery_type, @battery_cells,
      @voltage_source, @humidity_pct, @temperature_c, @temperature_source, @current_ma,
      @summary_json, @message_key
    )
    ON CONFLICT(prefix) DO UPDATE SET
      kind = excluded.kind,
      format_version = excluded.format_version,
      observed_at = MAX(COALESCE(health_latest.observed_at, 0), excluded.observed_at),
      base_at = excluded.base_at,
      device_time = excluded.device_time,
      uptime_s = excluded.uptime_s,
      boot_at = excluded.boot_at,
      reset_reason = excluded.reset_reason,
      shutdown_reason = excluded.shutdown_reason,
      flags_json = excluded.flags_json,
      battery_mv = excluded.battery_mv,
      battery_type = excluded.battery_type,
      battery_cells = excluded.battery_cells,
      voltage_source = excluded.voltage_source,
      humidity_pct = excluded.humidity_pct,
      temperature_c = excluded.temperature_c,
      temperature_source = excluded.temperature_source,
      current_ma = COALESCE(excluded.current_ma, health_latest.current_ma),
      summary_json = COALESCE(excluded.summary_json, health_latest.summary_json),
      message_key = excluded.message_key
    WHERE excluded.base_at >= COALESCE(health_latest.base_at, 0)
  `);
  const upsertConfig = db.prepare(`
    INSERT INTO health_config (
      prefix, format_version, observed_at, base_at, device_time,
      home_region, default_region, flood_regions_json, incomplete, regions_present, message_key
    ) VALUES (
      @prefix, @format_version, @observed_at, @base_at, @device_time,
      @home_region, @default_region, @flood_regions_json, @incomplete, @regions_present, @message_key
    )
    ON CONFLICT(prefix) DO UPDATE SET
      format_version = excluded.format_version,
      observed_at = MAX(COALESCE(health_config.observed_at, 0), excluded.observed_at),
      base_at = excluded.base_at,
      device_time = excluded.device_time,
      home_region = CASE WHEN excluded.regions_present = 1 THEN excluded.home_region ELSE health_config.home_region END,
      default_region = CASE WHEN excluded.regions_present = 1 THEN excluded.default_region ELSE health_config.default_region END,
      flood_regions_json = CASE WHEN excluded.regions_present = 1 THEN excluded.flood_regions_json ELSE health_config.flood_regions_json END,
      incomplete = CASE WHEN excluded.regions_present = 1 THEN excluded.incomplete ELSE health_config.incomplete END,
      regions_present = excluded.regions_present,
      message_key = excluded.message_key
    WHERE excluded.base_at >= COALESCE(health_config.base_at, 0)
  `);
  const selectLatest = db.prepare("SELECT * FROM health_latest WHERE prefix = ? AND format_version IN (3, 4)");
  const selectAllLatest = db.prepare("SELECT * FROM health_latest WHERE format_version IN (3, 4)");
  const selectConfig = db.prepare("SELECT * FROM health_config WHERE prefix = ? AND format_version IN (3, 4)");
  const selectAllConfig = db.prepare("SELECT * FROM health_config WHERE format_version IN (3, 4)");
  const selectSamples = db.prepare(`
    SELECT metric, sampled_at, value, source, format_version
    FROM health_samples
    WHERE prefix = ? AND sampled_at >= ? AND format_version IN (3, 4)
    ORDER BY sampled_at ASC
  `);
  const countRows = db.prepare("SELECT COUNT(*) AS total FROM health_messages WHERE format_version IN (3, 4)");
  const purgeSamples = db.prepare("DELETE FROM health_samples WHERE sampled_at < ?");
  const purgeMessages = db.prepare("DELETE FROM health_messages WHERE observed_at < ?");
  const purgeLatest = db.prepare("DELETE FROM health_latest WHERE observed_at < ?");
  const purgeConfig = db.prepare("DELETE FROM health_config WHERE observed_at < ?");

  const record = db.transaction((health, metadata = {}) => {
    if (!health?.prefix || !health?.messageKey || !health?.kind) return null;
    const observedAt = Number(health.observedAt) || Date.now();
    const baseAt = Number(health.baseAt) || observedAt;
    const formatVersion = health.formatVersion === 4 ? 4 : 3;
    const row = {
      message_key: health.messageKey,
      prefix: health.prefix,
      node_key: metadata.nodeKey || null,
      kind: health.kind,
      format_version: formatVersion,
      observed_at: observedAt,
      base_at: baseAt,
      device_time: health.deviceTime || null,
      uptime_s: health.uptimeSeconds ?? null,
      boot_at: Number.isFinite(health.bootAt) ? health.bootAt : null,
      reset_reason: health.resetReason || null,
      shutdown_reason: health.shutdownReason || null,
      flags_json: JSON.stringify(health.flags || {}),
      battery_mv: Number.isFinite(health.latestBatteryMv) ? health.latestBatteryMv : null,
      battery_type: health.batteryType || null,
      battery_cells: health.batteryCells ?? null,
      voltage_source: health.latestVoltageSource || health.voltageSource || null,
      humidity_pct: Number.isFinite(health.latestHumidityPct) ? health.latestHumidityPct : null,
      temperature_c: Number.isFinite(health.latestTemperatureC) ? health.latestTemperatureC : null,
      temperature_source: health.temperatureSource || null,
      current_ma: Number.isFinite(health.latestCurrentMa) ? health.latestCurrentMa : null,
      summary_json: health.summary ? JSON.stringify(health.summary) : null,
      packet_hash: metadata.packetHash || null,
      raw_hex: metadata.rawHex || null,
    };
    insertMessage.run(row);
    const messageId = selectMessage.get(health.messageKey)?.id || null;

    if (health.kind === "config") {
      upsertConfig.run({
        prefix: health.prefix,
        format_version: formatVersion,
        observed_at: observedAt,
        base_at: baseAt,
        device_time: health.deviceTime || null,
        home_region: health.regions?.home || null,
        default_region: health.regions?.default || null,
        flood_regions_json: JSON.stringify(health.regions?.flood || []),
        incomplete: health.regions?.incomplete ? 1 : 0,
        regions_present: health.regionsPresent === false ? 0 : 1,
        message_key: health.messageKey,
      });
      return messageId;
    }

    const samples = [];
    if (health.kind === "day") {
      for (const sample of Array.isArray(health.battery) ? health.battery : []) {
        samples.push({
          metric: "battery",
          sampled_at: sample.t,
          value: sample.mv,
          source: sample.source || null,
        });
      }
      for (const sample of Array.isArray(health.temperature) ? health.temperature : []) {
        samples.push({
          metric: "temperature",
          sampled_at: sample.t,
          value: sample.c,
          source: health.temperatureSource || null,
        });
      }
      for (const sample of Array.isArray(health.current) ? health.current : []) {
        samples.push({
          metric: "current",
          sampled_at: sample.t,
          value: sample.ma,
          source: null,
        });
      }
      for (const sample of Array.isArray(health.humidity) ? health.humidity : []) {
        samples.push({
          metric: "humidity",
          sampled_at: sample.t,
          value: sample.pct,
          source: null,
        });
      }
    }

    for (const sample of samples) {
      if (!Number.isFinite(sample.sampled_at) || !Number.isFinite(sample.value)) continue;
      upsertSample.run({
        prefix: health.prefix,
        metric: sample.metric,
        sampled_at: Math.round(sample.sampled_at / SAMPLE_BUCKET_MS) * SAMPLE_BUCKET_MS,
        value: sample.value,
        source: sample.source,
        message_id: messageId,
        format_version: formatVersion,
      });
    }
    upsertLatest.run(row);
    return messageId;
  });

  return {
    close: () => db.close(),
    count: () => countRows.get().total,
    latest: (prefix) => latestHealth(selectLatest.get(String(prefix || "").toLowerCase().slice(0, 16))),
    config: (prefix) => latestConfig(selectConfig.get(String(prefix || "").toLowerCase().slice(0, 16))),
    decorateNodes: (nodes, now = Date.now()) => {
      const byPrefix = new Map(selectAllLatest.all().map((row) => [row.prefix, row]));
      const configByPrefix = new Map(selectAllConfig.all().map((row) => [row.prefix, row]));
      return nodes.map((node) => {
        const prefix = String(node.public_key || "").toLowerCase().slice(0, 16);
        const row = byPrefix.get(prefix);
        const configRow = configByPrefix.get(prefix);
        if (!row && !configRow) return node;
        const decorated = { ...node };
        if (row) decorated.health = latestHealth(row, now);
        if (configRow) decorated.healthConfig = latestConfig(configRow, now);
        return decorated;
      });
    },
    history: (key, days = 7, now = Date.now()) => {
      const prefix = String(key || "").toLowerCase().slice(0, 16);
      if (!/^[0-9a-f]{16}$/.test(prefix)) return null;
      const since = now - Math.max(1, Math.min(90, Number(days) || 7)) * DAY_MS;
      const samples = selectSamples.all(prefix, since);
      const series = { battery: [], temperature: [], current: [], humidity: [] };
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
        config: latestConfig(selectConfig.get(prefix), now),
        prefix,
        samples: series,
      };
    },
    record,
    prune: (now = Date.now()) => {
      const cutoff = now - retentionMs;
      purgeSamples.run(cutoff);
      purgeMessages.run(cutoff);
      purgeLatest.run(cutoff - 365 * DAY_MS);
      purgeConfig.run(cutoff - 365 * DAY_MS);
    },
  };
}
