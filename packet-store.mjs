import { openSqliteStore } from "./sqlite-store.mjs";

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
  const db = openSqliteStore(dbPath);
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
      resolved_path = CASE
        WHEN excluded.resolved_path != '[]' THEN excluded.resolved_path
        ELSE packet_routes.resolved_path
      END,
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
  const selectPayloadType = db.prepare(`
    SELECT hash, observer_id, observed_at, payload_type, raw_hex
    FROM packet_routes
    WHERE payload_type = ?
    ORDER BY observed_at ASC
    LIMIT ?
  `);
  const selectAdvertsSince = db.prepare(`
    SELECT hash, MAX(decoded_json) AS decoded_json
    FROM packet_routes
    WHERE payload_type = 4 AND observed_at >= ?
    GROUP BY hash
  `);
  const selectRelay = db.prepare(`
    SELECT observed_at, path_json, scope_name
    FROM packet_routes
    WHERE observed_at >= ? AND path_hash_bytes >= ? AND path_json LIKE ?
    ORDER BY observed_at DESC
    LIMIT 20000
  `);
  const searchHashPrefix = db.prepare(`
    SELECT hash, MAX(observed_at) AS observed_at, payload_type, observer_id, observer_name
    FROM packet_routes
    WHERE hash >= ? AND hash < ?
    GROUP BY hash
    ORDER BY observed_at DESC
    LIMIT ?
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
    advertCountsSince: (sinceMs) => {
      const counts = new Map();
      const seen = new Set();
      for (const row of selectAdvertsSince.all(Math.floor(Number(sinceMs) || 0))) {
        if (!row.hash || seen.has(row.hash)) continue;
        let decoded;
        try {
          decoded = JSON.parse(row.decoded_json || "{}");
        } catch {
          continue;
        }
        const key = String(decoded.pubKey || decoded.publicKey || decoded.public_key || "").toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(key)) continue;
        seen.add(row.hash);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return counts;
    },
    queryPayloadType: (payloadType, limit = 20_000) => selectPayloadType.all(
      Math.floor(Number(payloadType) || 0),
      Math.max(1, Math.min(100_000, Math.floor(Number(limit) || 20_000))),
    ),
    queryHash: (hash) => selectHash.all(String(hash || "").toLowerCase()).map((row) => ({
      ...row,
      resolved_path: safeArray(row.resolved_path),
    })),
    relayStats: (prefix, hashBytes = 2, now = Date.now()) => {
      const value = String(prefix || "").toUpperCase();
      const bytes = Math.max(2, Number(hashBytes) || 2);
      if (!/^[0-9A-F]{4,6}$/.test(value)) return null;
      const rows = selectRelay.all(now - 24 * 60 * 60 * 1000, bytes, `%${value}%`);
      let lastRelayed = 0;
      let relayCount1h = 0;
      let relayCount24h = 0;
      let unscopedRelay24h = 0;
      for (const row of rows) {
        let path = [];
        try { path = JSON.parse(row.path_json || "[]"); } catch { path = []; }
        if (!Array.isArray(path)) continue;
        if (!path.some((hop) => {
          const token = String(hop || "").toUpperCase();
          return token.length >= bytes * 2 && token.startsWith(value);
        })) continue;
        const observed = Number(row.observed_at) || 0;
        lastRelayed = Math.max(lastRelayed, observed);
        relayCount24h += 1;
        if (observed >= now - 60 * 60 * 1000) relayCount1h += 1;
        if (!String(row.scope_name || "").trim()) unscopedRelay24h += 1;
      }
      return {
        hashBytes: bytes,
        lastRelayed: lastRelayed || null,
        prefix: value,
        relayActive: lastRelayed >= now - 60 * 60 * 1000,
        relayCount1h,
        relayCount24h,
        unscopedRelay24h,
      };
    },
    searchHashPrefix: (prefix, limit = 20) => {
      const value = String(prefix || "").toLowerCase();
      if (!/^[0-9a-f]{2,64}$/.test(value)) return [];
      return searchHashPrefix.all(value, `${value}g`, Math.max(1, Math.min(100, Number(limit) || 20)));
    },
    record: (rows) => record(rows),
  };
}
