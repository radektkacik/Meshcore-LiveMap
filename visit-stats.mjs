import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export function createVisitStatsStore(dbPath, { uniqueRetentionDays = 90 } = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS visit_daily (
      day TEXT PRIMARY KEY,
      visits INTEGER NOT NULL DEFAULT 0,
      peak_viewers INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS visit_unique (
      day TEXT NOT NULL,
      visitor TEXT NOT NULL,
      PRIMARY KEY (day, visitor)
    );
    CREATE TABLE IF NOT EXISTS visit_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);

  const bumpVisits = db.prepare(`
    INSERT INTO visit_daily (day, visits, peak_viewers) VALUES (?, 1, 0)
    ON CONFLICT(day) DO UPDATE SET visits = visits + 1
  `);
  const ensureDay = db.prepare("INSERT OR IGNORE INTO visit_daily (day, visits, peak_viewers) VALUES (?, 0, 0)");
  const insertUnique = db.prepare("INSERT OR IGNORE INTO visit_unique (day, visitor) VALUES (?, ?)");
  const countUnique = db.prepare("SELECT COUNT(*) AS total FROM visit_unique WHERE day = ?");
  const selectDay = db.prepare("SELECT day, visits, peak_viewers FROM visit_daily WHERE day = ?");
  const raisePeak = db.prepare("UPDATE visit_daily SET peak_viewers = ? WHERE day = ? AND peak_viewers < ?");
  const readMeta = db.prepare("SELECT value FROM visit_meta WHERE key = ?");
  const writeMeta = db.prepare(`
    INSERT INTO visit_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const totals = db.prepare("SELECT COALESCE(SUM(visits), 0) AS visits, COALESCE(MAX(peak_viewers), 0) AS peak FROM visit_daily");
  const series = db.prepare("SELECT day, visits, peak_viewers FROM visit_daily ORDER BY day DESC LIMIT ?");
  const pruneUnique = db.prepare("DELETE FROM visit_unique WHERE day < ?");

  const recordVisit = db.transaction((ip, now) => {
    const day = dayKey(now);
    bumpVisits.run(day);
    const visitor = createHash("sha256").update(`${day}:${ip || "unknown"}`).digest("hex").slice(0, 16);
    insertUnique.run(day, visitor);
  });

  return {
    close: () => db.close(),
    prune: (now = Date.now()) => pruneUnique.run(dayKey(now - uniqueRetentionDays * DAY_MS)).changes,
    recordVisit: (ip, now = Date.now()) => recordVisit(ip, now),
    report: (now = Date.now(), days = 14) => {
      const day = dayKey(now);
      const today = selectDay.get(day) || { day, visits: 0, peak_viewers: 0 };
      const total = totals.get();
      const overallPeak = readMeta.get("overall_peak_viewers");
      return {
        today: {
          day,
          visits: today.visits,
          uniqueVisitors: countUnique.get(day).total,
          peakViewers: today.peak_viewers,
        },
        totals: {
          peakViewers: overallPeak ? overallPeak.value : total.peak,
          visits: total.visits,
        },
        series: series.all(Math.min(Math.max(1, days), 365)),
      };
    },
    updatePeak: (viewers, now = Date.now()) => {
      const day = dayKey(now);
      ensureDay.run(day);
      raisePeak.run(viewers, day, viewers);
      const overall = readMeta.get("overall_peak_viewers");
      if (!overall || viewers > overall.value) writeMeta.run("overall_peak_viewers", viewers);
    },
  };
}
