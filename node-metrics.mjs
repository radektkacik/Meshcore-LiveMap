import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
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

export function createNodeMetricsStore(dbPath, { historyDays = 30, windowDays = 7 } = {}) {
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

  return {
    close: () => db.close(),
    decorateNodes,
    recordNodes: (nodes, now = Date.now()) => recordNodes(nodes, now),
  };
}
