import { openSqliteStore } from "./sqlite-store.mjs";

const DAY = 86_400_000;
const validPrefix = (value) => /^[0-9a-f]{16}$/.test(value);
const valueOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const parseTime = (value) => typeof value === "string" ? Date.parse(value) : NaN;
const json = (value) => JSON.stringify(value);
function versionParts(value) {
  return String(value || "").match(/\d+/g)?.map(Number) || [];
}
function newerVersion(first, second) {
  if (!first) return second || null;
  if (!second) return first;
  const a = versionParts(first), b = versionParts(second);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0, right = b[index] ?? 0;
    if (left !== right) return left > right ? first : second;
  }
  return first;
}
const COMMON_FIELDS = ["uptime_s", "reset", "last_shutdown", "flags", "hops", "build"];
const TYPE_FIELDS = {
  day: ["temp_source", "battery_type", "battery_cells"],
  summary: ["battery_mv", "temp_c", "humidity_pct"],
  config: ["home_region", "default_region", "flood_regions", "regions_incomplete", "regions_present", "board_name", "firmware_version"],
  stats: ["period_min", "noise_floor_dbm", "tx_airtime_s", "rx_airtime_s", "packets_received", "packets_sent", "flood_duplicates"],
};
function selectedDecoded(kind, data) {
  return Object.fromEntries([...COMMON_FIELDS, ...TYPE_FIELDS[kind]].filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
}

export function createCzHealthHubStore(path, { retentionMs = 90 * DAY } = {}) {
  const db = openSqliteStore(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_state (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hub_messages (
      id INTEGER PRIMARY KEY, prefix TEXT NOT NULL, received_at INTEGER NOT NULL,
      device_time INTEGER, version INTEGER, kind TEXT NOT NULL, decoded TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hub_messages_lookup ON hub_messages(prefix, received_at);
    CREATE TABLE IF NOT EXISTS hub_samples (
      prefix TEXT NOT NULL, sampled_at INTEGER NOT NULL, battery_mv REAL, temp_c REAL,
      current_ma REAL, humidity_pct REAL, voltage_source TEXT, battery_type TEXT, battery_cells INTEGER,
      PRIMARY KEY(prefix, sampled_at)
    );
    CREATE INDEX IF NOT EXISTS hub_samples_time ON hub_samples(sampled_at);
  `);
  const getCursor = db.prepare("SELECT value FROM hub_state WHERE name = 'cursor'");
  const putCursor = db.prepare("INSERT INTO hub_state(name,value) VALUES('cursor',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value");
  const remove = db.prepare("DELETE FROM hub_messages WHERE id=?");
  const message = db.prepare(`INSERT INTO hub_messages(id,prefix,received_at,device_time,version,kind,decoded)
    VALUES(@id,@prefix,@received_at,@device_time,@version,@kind,@decoded)
    ON CONFLICT(id) DO UPDATE SET prefix=excluded.prefix,received_at=excluded.received_at,
      device_time=excluded.device_time,version=excluded.version,kind=excluded.kind,decoded=excluded.decoded`);
  const sample = db.prepare(`INSERT INTO hub_samples(prefix,sampled_at,battery_mv,temp_c,current_ma,humidity_pct,voltage_source,battery_type,battery_cells)
    VALUES(@prefix,@sampled_at,@battery_mv,@temp_c,@current_ma,@humidity_pct,@voltage_source,@battery_type,@battery_cells)
    ON CONFLICT(prefix,sampled_at) DO UPDATE SET battery_mv=excluded.battery_mv,temp_c=excluded.temp_c,
      current_ma=excluded.current_ma,humidity_pct=excluded.humidity_pct,voltage_source=excluded.voltage_source,
      battery_type=excluded.battery_type,battery_cells=excluded.battery_cells`);
  const messages = db.prepare("SELECT * FROM hub_messages WHERE prefix=? ORDER BY COALESCE(device_time,received_at) DESC, id DESC LIMIT 1");
  const lastReceived = db.prepare("SELECT MAX(received_at) AS at FROM hub_messages WHERE prefix=?");
  const byKind = db.prepare("SELECT * FROM hub_messages WHERE prefix=? AND kind=? ORDER BY COALESCE(device_time,received_at) DESC, id DESC LIMIT 1");
  const regionsQuery = db.prepare("SELECT * FROM hub_messages WHERE prefix=? AND kind='config' AND COALESCE(json_extract(decoded,'$.regions_present'),1) != 0 ORDER BY COALESCE(device_time,received_at) DESC,id DESC LIMIT 1");
  const buildQuery = db.prepare("SELECT * FROM hub_messages WHERE prefix=? AND json_extract(decoded,'$.build') IS NOT NULL ORDER BY COALESCE(device_time,received_at) DESC,id DESC LIMIT 1");
  const firmwareQuery = db.prepare("SELECT * FROM hub_messages WHERE prefix=? AND kind='config' AND json_extract(decoded,'$.firmware_version') IS NOT NULL ORDER BY COALESCE(device_time,received_at) DESC,id DESC LIMIT 1");
  const tempSourceQuery = db.prepare("SELECT * FROM hub_messages WHERE prefix=? AND json_extract(decoded,'$.temp_source') IS NOT NULL ORDER BY COALESCE(device_time,received_at) DESC,id DESC LIMIT 1");
  const samples = db.prepare("SELECT * FROM hub_samples WHERE prefix=? AND sampled_at>=? ORDER BY sampled_at DESC");
  const latestSample = Object.fromEntries(["battery_mv", "temp_c", "current_ma", "humidity_pct"].map((field) => [
    field, db.prepare(`SELECT * FROM hub_samples WHERE prefix=? AND sampled_at>=? AND ${field} IS NOT NULL ORDER BY sampled_at DESC LIMIT 1`),
  ]));
  const allPrefixes = db.prepare("SELECT DISTINCT prefix FROM hub_messages");

  const apply = db.transaction((page) => {
    const previous = getCursor.get()?.value || 0;
    if (!page || !Array.isArray(page.changes) || !Number.isSafeInteger(page.next_cursor)
        || page.next_cursor < previous || typeof page.more !== "boolean"
        || ((page.more || page.changes.length) && page.next_cursor === previous)) throw new Error("invalid-page");
    for (const change of page.changes) {
      if (!Number.isSafeInteger(change?.id) || change.id < 1 || typeof change.trusted !== "boolean") throw new Error("invalid-change");
      if (!change.trusted) { remove.run(change.id); continue; }
      const prefix = String(change.repeater || "").toLowerCase();
      const received = parseTime(change.received_at);
      const device = change.device_time == null ? null : parseTime(change.device_time);
      if (!validPrefix(prefix) || !Number.isFinite(received) || (device !== null && !Number.isFinite(device))
          || (change.public_key != null && (!/^[0-9a-f]{64}$/i.test(change.public_key) || !change.public_key.toLowerCase().startsWith(prefix)))
          || !["day", "summary", "config", "stats"].includes(change.msg_type)
          || !change.decoded || typeof change.decoded !== "object" || Array.isArray(change.decoded)
          || !Array.isArray(change.samples)) throw new Error("invalid-change");
      message.run({ id: change.id, prefix, received_at: received, device_time: device,
        version: valueOrNull(change.version), kind: change.msg_type, decoded: json(selectedDecoded(change.msg_type, change.decoded)) });
      for (const entry of change.samples) {
        const at = parseTime(entry?.time);
        if (!Number.isFinite(at)) throw new Error("invalid-sample");
        sample.run({ prefix, sampled_at: at, battery_mv: valueOrNull(entry.battery_mv),
          temp_c: valueOrNull(entry.temp_c), current_ma: valueOrNull(entry.current_ma),
          humidity_pct: valueOrNull(entry.humidity_pct), voltage_source: entry.voltage_source || null,
          battery_type: entry.battery_type || null, battery_cells: valueOrNull(entry.battery_cells) });
      }
    }
    putCursor.run(page.next_cursor);
  });

  function state(prefix, now = Date.now()) {
    const decode = (row) => row ? { ...row, data: JSON.parse(row.decoded) } : null;
    const latest = decode(messages.get(prefix));
    if (!latest) return { latest: null, config: null };
    const latestFor = (field) => latestSample[field].get(prefix, now - retentionMs);
    const battery = latestFor("battery_mv"), temp = latestFor("temp_c"), current = latestFor("current_ma"), humidity = latestFor("humidity_pct");
    const summaryRow = decode(byKind.get(prefix, "summary"));
    const summary = summaryRow?.data;
    const sampleOrSummary = (item, field, summaryField) => {
      const sampleAt = item?.sampled_at || 0;
      const summaryAt = summaryRow ? (summaryRow.device_time ?? summaryRow.received_at) : 0;
      const summaryValue = valueOrNull(summary?.[summaryField]?.last);
      return summaryValue != null && summaryAt > sampleAt ? summaryValue : (item?.[field] ?? null);
    };
    const flags = Array.isArray(latest.data.flags) ? latest.data.flags : [];
    const at = lastReceived.get(prefix)?.at || latest.received_at, d = latest.data;
    const regions = decode(regionsQuery.get(prefix));
    const config = decode(byKind.get(prefix, "config"));
    const built = decode(buildQuery.get(prefix));
    const configured = decode(firmwareQuery.get(prefix));
    const firmware = newerVersion(built?.data.build, configured?.data.firmware_version);
    const selectedBattery = sampleOrSummary(battery, "battery_mv", "battery_mv");
    const summaryAt = summaryRow ? (summaryRow.device_time ?? summaryRow.received_at) : 0;
    const usingSummaryBattery = valueOrNull(summary?.battery_mv?.last) != null && summaryAt > (battery?.sampled_at || 0);
    const batteryType = usingSummaryBattery ? null : (battery?.battery_type || d.battery_type || null);
    const batteryCells = usingSummaryBattery ? null : (battery?.battery_cells ?? d.battery_cells ?? null);
    const voltageSource = usingSummaryBattery ? null : (battery?.voltage_source || null);
    const limits = { liion: [4050, 3600, 3400], lifepo4: [3350, 3200, 3000], lto: [2600, 2400, 2200], lead: [2100, 2050, 1950] };
    const levels = limits[batteryType === "auto" ? "liion" : batteryType === "lto-vlastik" && voltageSource === "bms" ? "lto" : batteryType];
    let batteryStatus = null;
    if (selectedBattery != null && voltageSource !== "none" && levels && batteryCells > 0) {
      const perCell = selectedBattery / batteryCells;
      batteryStatus = now - (battery?.sampled_at || at) > 2 * DAY ? "stale"
        : perCell >= levels[0] ? "full" : perCell >= levels[1] ? "ok" : perCell >= levels[2] ? "warn" : "critical";
    }
    const latestStats = decode(byKind.get(prefix, "stats"));
    return {
      latest: {
        prefix, kind: latest.kind, formatVersion: latest.version, batteryMv: selectedBattery, batteryStatus,
        batteryType, batteryCells, voltageSource, temperatureC: sampleOrSummary(temp, "temp_c", "temp_c"),
        temperatureSource: decode(tempSourceQuery.get(prefix))?.data.temp_source || null,
        currentMa: current?.current_ma ?? null, humidityPct: sampleOrSummary(humidity, "humidity_pct", "humidity_pct"),
        charging: flags.includes("charging"), externalPower: flags.includes("ext_power"), alarm: flags.includes("alarm"),
        uptimeS: valueOrNull(d.uptime_s), bootAt: Number.isFinite(d.uptime_s) && Number.isFinite(new Date((latest.device_time ?? latest.received_at) - d.uptime_s * 1000).getTime()) ? new Date((latest.device_time ?? latest.received_at) - d.uptime_s * 1000).toISOString() : null,
        resetReason: d.reset || null, shutdownReason: d.last_shutdown || null,
        observedAt: new Date(at).toISOString(), deviceTime: latest.device_time ? new Date(latest.device_time).toISOString() : null,
        ageSec: Math.max(0, Math.floor((now - at) / 1000)), stale: now - at > 2 * DAY,
        firmware,
        boardName: config?.data.board_name || null,
        sampleAt: usingSummaryBattery ? new Date(summaryAt).toISOString() : (battery ? new Date(battery.sampled_at).toISOString() : null),
        summary: summary ? { battery: summary.battery_mv || null, temperature: summary.temp_c || null, humidity: summary.humidity_pct || null } : null,
        stats: latestStats ? { ...latestStats.data, observedAt: new Date(latestStats.received_at).toISOString() } : null,
      },
      config: config ? { observedAt: new Date(config.received_at).toISOString(), formatVersion: config.version,
        regionsPresent: Boolean(regions), regions: regions ? { home: regions?.data.home_region || null,
          default: regions?.data.default_region || null, flood: Array.isArray(regions?.data.flood_regions) ? regions.data.flood_regions : [],
          incomplete: Boolean(regions?.data.regions_incomplete) } : null } : null,
    };
  }

  return {
    cursor: () => getCursor.get()?.value || 0,
    applyPage: apply,
    count: () => db.prepare("SELECT COUNT(*) AS n FROM hub_messages").get().n,
    decorateNodes(nodes, now = Date.now()) {
      const prefixes = new Map();
      for (const node of nodes) {
        const key = String(node.public_key || "").toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(key)) continue;
        const prefix = key.slice(0, 16);
        prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
      }
      const present = new Set(allPrefixes.all().map((row) => row.prefix));
      return nodes.map((node) => {
        const { health: _health, healthConfig: _healthConfig, ...cleanNode } = node;
        const prefix = String(node.public_key || "").toLowerCase().slice(0, 16);
        if (!validPrefix(prefix) || prefixes.get(prefix) !== 1 || !present.has(prefix)) return cleanNode;
        const { latest, config } = state(prefix, now);
        return { ...cleanNode, ...(latest ? { health: latest } : {}), ...(config ? { healthConfig: config } : {}) };
      });
    },
    history(key, days = 7, now = Date.now()) {
      const prefix = String(key || "").toLowerCase().slice(0, 16);
      if (!validPrefix(prefix)) return null;
      const range = Math.max(1, Math.min(90, Number(days) || 7));
      const series = { battery: [], temperature: [], current: [], humidity: [] };
      for (const row of samples.all(prefix, now - range * DAY).reverse()) {
        for (const [metric, field] of [["battery", "battery_mv"], ["temperature", "temp_c"], ["current", "current_ma"], ["humidity", "humidity_pct"]]) {
          if (row[field] == null) continue;
          series[metric].push({ at: new Date(row.sampled_at).toISOString(), value: row[field], source: metric === "battery" ? row.voltage_source : null });
        }
      }
      const { latest, config } = state(prefix, now);
      return { prefix, days: range, latest, config, samples: series };
    },
    prune(now = Date.now()) {
      db.prepare("DELETE FROM hub_samples WHERE sampled_at < ?").run(now - retentionMs);
      db.prepare("DELETE FROM hub_messages WHERE received_at < ?").run(now - retentionMs);
    },
    close: () => db.close(),
  };
}
