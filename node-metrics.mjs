import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STATS_BUCKET_MS = 5 * 60 * 1000;
const METRIC_FIELDS = [
  "usefulness_score",
  "coverage_score",
  "traffic_share_score",
  "bridge_score",
  "redundancy_score",
];

function finiteNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createNodeMetricsStore(dbPath, {
  historyDays = 30,
  windowDays = 7,
  statsHistoryDays = 30,
  statsHourlyRetentionDays = 730,
  statsDailyRetentionDays = 1825,
  statsBucketMs = STATS_BUCKET_MS,
} = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_score_samples (
      public_key TEXT NOT NULL,
      sampled_at INTEGER NOT NULL,
      usefulness_score REAL,
      coverage_score REAL,
      traffic_share_score REAL,
      bridge_score REAL,
      redundancy_score REAL,
      PRIMARY KEY (public_key, sampled_at)
    );
    CREATE INDEX IF NOT EXISTS node_score_samples_time
      ON node_score_samples (sampled_at);
    CREATE TABLE IF NOT EXISTS node_score_rollups (
      public_key TEXT PRIMARY KEY,
      usefulness_score REAL,
      coverage_score REAL,
      traffic_share_score REAL,
      bridge_score REAL,
      redundancy_score REAL,
      sample_count INTEGER NOT NULL,
      first_sample_at INTEGER NOT NULL,
      last_sample_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stats_samples (
      bucket_at INTEGER PRIMARY KEY,
      sampled_at INTEGER NOT NULL,
      packets_last_hour INTEGER,
      packets_last_24h INTEGER,
      total_observations INTEGER,
      total_nodes INTEGER,
      total_observers INTEGER
    );
    CREATE INDEX IF NOT EXISTS stats_samples_bucket
      ON stats_samples (bucket_at);
    CREATE TABLE IF NOT EXISTS stats_hourly (
      bucket_at INTEGER PRIMARY KEY,
      avg_packets_hour REAL,
      max_packets_hour INTEGER,
      samples INTEGER NOT NULL,
      avg_packets_24h REAL,
      avg_nodes REAL,
      avg_observers REAL,
      avg_observations REAL,
      last_sampled_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS stats_daily (
      bucket_at INTEGER PRIMARY KEY,
      avg_packets_hour REAL,
      max_packets_hour INTEGER,
      samples INTEGER NOT NULL,
      avg_packets_24h REAL,
      avg_nodes REAL,
      avg_observers REAL,
      avg_observations REAL,
      last_sampled_at INTEGER
    );
  `);

  const upsertSample = db.prepare(`
    INSERT INTO node_score_samples (
      public_key, sampled_at, usefulness_score, coverage_score,
      traffic_share_score, bridge_score, redundancy_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(public_key, sampled_at) DO UPDATE SET
      usefulness_score = excluded.usefulness_score,
      coverage_score = excluded.coverage_score,
      traffic_share_score = excluded.traffic_share_score,
      bridge_score = excluded.bridge_score,
      redundancy_score = excluded.redundancy_score
  `);
  const purgeSamples = db.prepare("DELETE FROM node_score_samples WHERE sampled_at < ?");
  const clearRollups = db.prepare("DELETE FROM node_score_rollups");
  const rebuildRollups = db.prepare(`
    INSERT INTO node_score_rollups (
      public_key, usefulness_score, coverage_score, traffic_share_score,
      bridge_score, redundancy_score, sample_count, first_sample_at, last_sample_at
    )
    SELECT
      public_key,
      AVG(usefulness_score),
      AVG(coverage_score),
      AVG(traffic_share_score),
      AVG(bridge_score),
      AVG(redundancy_score),
      COUNT(usefulness_score),
      MIN(sampled_at),
      MAX(sampled_at)
    FROM node_score_samples
    WHERE sampled_at >= ? AND usefulness_score IS NOT NULL
    GROUP BY public_key
  `);
  const readRollups = db.prepare("SELECT * FROM node_score_rollups");
  const readSamples = db.prepare(`
    SELECT sampled_at, usefulness_score, coverage_score, traffic_share_score,
      bridge_score, redundancy_score
    FROM node_score_samples
    WHERE public_key = ? AND sampled_at >= ?
    ORDER BY sampled_at
  `);
  const upsertStats = db.prepare(`
    INSERT INTO stats_samples (
      bucket_at, sampled_at, packets_last_hour, packets_last_24h,
      total_observations, total_nodes, total_observers
    ) VALUES (
      @bucket_at, @sampled_at, @packets_last_hour, @packets_last_24h,
      @total_observations, @total_nodes, @total_observers
    )
    ON CONFLICT(bucket_at) DO UPDATE SET
      sampled_at = excluded.sampled_at,
      packets_last_hour = excluded.packets_last_hour,
      packets_last_24h = excluded.packets_last_24h,
      total_observations = excluded.total_observations,
      total_nodes = excluded.total_nodes,
      total_observers = excluded.total_observers
  `);
  const purgeStats = db.prepare("DELETE FROM stats_samples WHERE bucket_at < ?");
  const readStats = db.prepare(`
    SELECT bucket_at, sampled_at, packets_last_hour, packets_last_24h,
      total_observations, total_nodes, total_observers
    FROM stats_samples
    WHERE bucket_at >= ?
    ORDER BY bucket_at
  `);
  const rollupHourly = db.prepare(`
    INSERT OR REPLACE INTO stats_hourly (
      bucket_at, avg_packets_hour, max_packets_hour, samples,
      avg_packets_24h, avg_nodes, avg_observers, avg_observations, last_sampled_at
    )
    SELECT
      CAST(bucket_at / 3600000 AS INTEGER) * 3600000,
      AVG(packets_last_hour),
      MAX(packets_last_hour),
      COUNT(packets_last_hour),
      AVG(packets_last_24h),
      AVG(total_nodes),
      AVG(total_observers),
      AVG(total_observations),
      MAX(sampled_at)
    FROM stats_samples
    WHERE bucket_at >= ? AND bucket_at < ?
    GROUP BY CAST(bucket_at / 3600000 AS INTEGER)
  `);
  const rollupDaily = db.prepare(`
    INSERT OR REPLACE INTO stats_daily (
      bucket_at, avg_packets_hour, max_packets_hour, samples,
      avg_packets_24h, avg_nodes, avg_observers, avg_observations, last_sampled_at
    )
    SELECT
      CAST(bucket_at / 86400000 AS INTEGER) * 86400000,
      AVG(avg_packets_hour),
      MAX(max_packets_hour),
      SUM(samples),
      AVG(avg_packets_24h),
      AVG(avg_nodes),
      AVG(avg_observers),
      AVG(avg_observations),
      MAX(last_sampled_at)
    FROM stats_hourly
    WHERE bucket_at >= ? AND bucket_at < ?
    GROUP BY CAST(bucket_at / 86400000 AS INTEGER)
  `);
  const purgeHourly = db.prepare("DELETE FROM stats_hourly WHERE bucket_at < ?");
  const purgeDaily = db.prepare("DELETE FROM stats_daily WHERE bucket_at < ?");
  const readHourly = db.prepare(`
    SELECT bucket_at, avg_packets_hour, max_packets_hour, samples, last_sampled_at
    FROM stats_hourly WHERE bucket_at >= ? ORDER BY bucket_at
  `);
  const readDaily = db.prepare(`
    SELECT bucket_at, avg_packets_hour, max_packets_hour, samples, last_sampled_at
    FROM stats_daily WHERE bucket_at >= ? ORDER BY bucket_at
  `);

  let lastHourlyRollup = 0;
  let lastDailyRollup = 0;

  function rollupStats(now = Date.now()) {
    const hourEnd = Math.floor(now / HOUR_MS) * HOUR_MS;
    if (hourEnd > lastHourlyRollup) {
      rollupHourly.run(now - statsHistoryDays * DAY_MS, hourEnd);
      purgeHourly.run(now - statsHourlyRetentionDays * DAY_MS);
      lastHourlyRollup = hourEnd;
    }
    const dayEnd = Math.floor(now / DAY_MS) * DAY_MS;
    if (dayEnd > lastDailyRollup) {
      rollupDaily.run(now - statsHourlyRetentionDays * DAY_MS, dayEnd);
      purgeDaily.run(now - statsDailyRetentionDays * DAY_MS);
      lastDailyRollup = dayEnd;
    }
  }

  const recordNodes = db.transaction((nodes, now) => {
    const sampledAt = Math.floor(now / HOUR_MS) * HOUR_MS;
    let recorded = 0;
    for (const node of nodes) {
      const publicKey = String(node.public_key || "").toLowerCase();
      if (!publicKey) continue;
      const metrics = METRIC_FIELDS.map((field) => finiteNumber(node[field]));
      if (metrics.every((value) => value == null)) continue;
      upsertSample.run(publicKey, sampledAt, ...metrics);
      recorded += 1;
    }
    purgeSamples.run(now - historyDays * DAY_MS);
    clearRollups.run();
    rebuildRollups.run(now - windowDays * DAY_MS);
    return recorded;
  });

  function decorateNodes(nodes) {
    const rollups = new Map(readRollups.all().map((row) => [row.public_key, row]));
    return nodes.map((node) => {
      const rollup = rollups.get(String(node.public_key || "").toLowerCase());
      if (!rollup) return node;
      const decorated = { ...node };
      for (const field of METRIC_FIELDS) decorated[`long_term_${field}`] = rollup[field];
      decorated.long_term_sample_count = rollup.sample_count;
      decorated.long_term_first_sample = new Date(rollup.first_sample_at).toISOString();
      decorated.long_term_last_sample = new Date(rollup.last_sample_at).toISOString();
      return decorated;
    });
  }

  function history(publicKey, days = 7, now = Date.now()) {
    const key = String(publicKey || "").toLowerCase();
    if (!key) return [];
    return readSamples.all(key, now - Math.max(1, days) * DAY_MS).map((row) => ({
      sampledAt: new Date(row.sampled_at).toISOString(),
      usefulness: row.usefulness_score,
      coverage: row.coverage_score,
      trafficShare: row.traffic_share_score,
      bridge: row.bridge_score,
      redundancy: row.redundancy_score,
    }));
  }

  function recordStats(stats, now = Date.now()) {
    const packetsLastHour = finiteNumber(stats?.packetsLastHour);
    const packetsLast24h = finiteNumber(stats?.packetsLast24h);
    if (packetsLastHour == null && packetsLast24h == null) return null;
    const bucketAt = Math.floor(now / statsBucketMs) * statsBucketMs;
    upsertStats.run({
      bucket_at: bucketAt,
      packets_last_24h: packetsLast24h,
      packets_last_hour: packetsLastHour,
      sampled_at: now,
      total_nodes: finiteNumber(stats?.totalNodes),
      total_observers: finiteNumber(stats?.totalObservers),
      total_observations: finiteNumber(stats?.totalObservations),
    });
    purgeStats.run(now - statsHistoryDays * DAY_MS);
    rollupStats(now);
    return bucketAt;
  }

  function statsSeries(sinceMs) {
    return readStats.all(Math.floor(Number(sinceMs) || 0)).map((row) => ({
      bucketAt: row.bucket_at,
      packetsLast24h: row.packets_last_24h,
      packetsLastHour: row.packets_last_hour,
      sampledAt: row.sampled_at,
      totalNodes: row.total_nodes,
      totalObservers: row.total_observers,
      totalObservations: row.total_observations,
    }));
  }

  function statsRollupSeries(sinceMs, granularity = "hour") {
    const rows = granularity === "day"
      ? readDaily.all(Math.floor(Number(sinceMs) || 0))
      : readHourly.all(Math.floor(Number(sinceMs) || 0));
    return rows.map((row) => ({
      bucketAt: row.bucket_at,
      packetsLastHour: row.avg_packets_hour,
      peak: row.max_packets_hour,
      samples: row.samples,
      sampledAt: row.last_sampled_at,
    }));
  }

  return {
    close: () => db.close(),
    decorateNodes,
    history,
    recordNodes: (nodes, now = Date.now()) => recordNodes(nodes, now),
    recordStats: (stats, now = Date.now()) => recordStats(stats, now),
    rollupStats: (now = Date.now()) => rollupStats(now),
    statsRollupSeries,
    statsSeries,
  };
}
