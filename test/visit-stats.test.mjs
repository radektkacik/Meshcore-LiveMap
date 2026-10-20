import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createVisitStatsStore } from "../visit-stats.mjs";

const day = Date.UTC(2026, 8, 15, 12);

test("visit stats count visits, unique visitors and peaks per day", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-visits-"));
  const store = createVisitStatsStore(join(directory, "visits.sqlite"));
  try {
    store.recordVisit("1.1.1.1", day);
    store.recordVisit("1.1.1.1", day + 1000);
    store.recordVisit("2.2.2.2", day + 2000);
    store.updatePeak(3, day);
    store.updatePeak(2, day);

    const report = store.report(day, 7);
    assert.equal(report.today.visits, 3);
    assert.equal(report.today.uniqueVisitors, 2);
    assert.equal(report.today.peakViewers, 3);
    assert.equal(report.totals.visits, 3);
    assert.equal(report.totals.peakViewers, 3);
    assert.equal(report.series.length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("visit stats keep the overall peak and prune old unique visitors", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-visits-"));
  const store = createVisitStatsStore(join(directory, "visits.sqlite"), { uniqueRetentionDays: 2 });
  try {
    store.updatePeak(7, day - 5 * 24 * 60 * 60 * 1000);
    store.recordVisit("1.1.1.1", day - 5 * 24 * 60 * 60 * 1000);
    store.recordVisit("3.3.3.3", day);
    store.updatePeak(1, day);

    const report = store.report(day, 30);
    assert.equal(report.totals.peakViewers, 7);
    assert.equal(report.today.uniqueVisitors, 1);

    store.prune(day);
    assert.equal(store.report(day - 5 * 24 * 60 * 60 * 1000, 30).today.uniqueVisitors, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
