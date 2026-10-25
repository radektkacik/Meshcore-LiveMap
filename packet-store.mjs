import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ROWS = 500_000;

function safeArray(text) {
  try {
    const value = JSON.parse(text || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function createPacketStore(dbPath, {
  retentionMs = DEFAULT_RETENTION_MS,
  maxRows = DEFAULT_MAX_ROWS,
} = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS packet_routes (
      hash TEXT NOT NULL,
      observer_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      payload_type INTEGER,
      route_type INTEGER,
      path_hash_bytes INTEGER,
      path_json TEXT,
      resolved_path TEXT,
      observer_name TEXT,
      observer_iata TEXT,
      scope_name TEXT,
      snr REAL,
      rssi REAL,
      decoded_json TEXT,
      raw_hex TEXT,
      PRIMARY KEY (hash, observer_id)
    );
    CREATE INDEX IF NOT EXISTS packet_routes_time ON packet_routes (observed_at);
  `);
  const columns = new Set(db.prepare("PRAGMA table_info(packet_routes)").all().map((column) => column.name));
  if (!columns.has("scope_name")) {
    db.exec("ALTER TABLE packet_routes ADD COLUMN scope_name TEXT");
  }

  const upsert = db.prepare(`
    INSERT INTO packet_routes (
      hash, observer_id, observed_at, payload_type, route_type, path_hash_bytes,
      path_json, resolved_path, observer_name, observer_iata, scope_name, snr, rssi, decoded_json, raw_hex
    ) VALUES (
      @hash, @observer_id, @observed_at, @payload_type, @route_type, @path_hash_bytes,
      @path_json, @resolved_path, @observer_name, @observer_iata, @scope_name, @snr, @rssi, @decoded_json, @raw_hex
    )
    ON CONFLICT(hash, observer_id) DO UPDATE SET
      observed_at = excluded.observed_at,
      payload_type = excluded.payload_type,
      route_type = excluded.route_type,
      path_hash_bytes = excluded.path_hash_bytes,
      path_json = excluded.path_json,
      resolved_path = excluded.resolved_path,
      observer_name = excluded.observer_name,
      observer_iata = excluded.observer_iata,
      scope_name = COALESCE(excluded.scope_name, packet_routes.scope_name),
      snr = excluded.snr,
      rssi = excluded.rssi,
      decoded_json = excluded.decoded_json,
      raw_hex = excluded.raw_hex
  `);
  const selectSince = db.prepare(`
    SELECT hash, observer_id, observed_at, payload_type, route_type, path_hash_bytes,
      path_json, resolved_path, observer_name, observer_iata, scope_name, snr, rssi, decoded_json
    FROM packet_routes
    WHERE observed_at >= ?
    ORDER BY observed_at DESC
    LIMIT ?
  `);
  const selectHash = db.prepare(`
    SELECT hash, observer_id, observed_at, payload_type, route_type, path_hash_bytes,
      path_json, resolved_path, observer_name, observer_iata, scope_name, snr, rssi, decoded_json
    FROM packet_routes
    WHERE hash = ?
    ORDER BY observed_at DESC
  `);
  const purgeOld = db.prepare("DELETE FROM packet_routes WHERE observed_at < ?");
  const purgeOverflow = db.prepare(`
    DELETE FROM packet_routes WHERE rowid IN (
      SELECT rowid FROM packet_routes ORDER BY observed_at ASC LIMIT ?
    )
  `);
  const countRows = db.prepare("SELECT COUNT(*) AS total FROM packet_routes");
  const oldestRow = db.prepare("SELECT MIN(observed_at) AS oldest FROM packet_routes");
  const newestRow = db.prepare("SELECT MAX(observed_at) AS newest FROM packet_routes");
  const countDistinctSince = db.prepare(`
    SELECT COUNT(DISTINCT hash) AS total FROM packet_routes WHERE observed_at >= ?
  `);

  const record = db.transaction((rows) => {
    let stored = 0;
    for (const row of rows) {
      if (!row.hash || !row.observer_id || !Number.isFinite(row.observed_at)) continue;
      upsert.run(row);
      stored += 1;
    }
    return stored;
  });

  return {
    close: () => db.close(),
    count: () => countRows.get().total,
    countDistinctSince: (sinceMs) => countDistinctSince.get(Math.floor(sinceMs)).total,
    newest: () => newestRow.get().newest,
    oldest: () => oldestRow.get().oldest,
    prune: (now = Date.now()) => {
      purgeOld.run(now - retentionMs);
      const total = countRows.get().total;
      if (total > maxRows) purgeOverflow.run(total - maxRows);
    },
    querySince: (sinceMs, limit = 4000) => selectSince.all(Math.floor(sinceMs), Math.floor(limit)).map((row) => ({
      ...row,
      resolved_path: safeArray(row.resolved_path),
    })),
    queryHash: (hash) => selectHash.all(String(hash || "").toLowerCase()).map((row) => ({
      ...row,
      resolved_path: safeArray(row.resolved_path),
    })),
    record: (rows) => record(rows),
  };
}
