import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNodeMetricsStore } from "../node-metrics.mjs";

test("stores hourly samples and decorates nodes with a seven-day average", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-metrics-"));
  const store = createNodeMetricsStore(join(directory, "metrics.sqlite"));
  const node = { public_key: "AABB", usefulness_score: 0.2, coverage_score: 0.4 };
  const start = Date.UTC(2026, 8, 1, 10);

  try {
    store.recordNodes([node], start);
    store.recordNodes([{ ...node, usefulness_score: 0.8, coverage_score: 0.6 }], start + 15 * 60 * 1000);
    store.recordNodes([{ ...node, usefulness_score: 0.4, coverage_score: 0.2 }], start + 60 * 60 * 1000);

    const [decorated] = store.decorateNodes([node]);
    assert.equal(decorated.long_term_sample_count, 2);
    assert.ok(Math.abs(decorated.long_term_usefulness_score - 0.6) < 1e-10);
    assert.equal(decorated.long_term_coverage_score, 0.4);
    assert.match(decorated.long_term_first_sample, /^2026-09-01T10:00:00/);
    const history = store.history("AABB", 7, start + 2 * 60 * 60 * 1000);
    assert.equal(history.length, 2);
    assert.equal(history[0].usefulness, 0.8);
    assert.match(history[0].sampledAt, /^2026-09-01T10:00:00/);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stores analyzer stats samples in five-minute buckets and prunes old ones", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-metrics-"));
  const store = createNodeMetricsStore(join(directory, "metrics.sqlite"), { statsHistoryDays: 30 });
  const start = Date.UTC(2026, 8, 1, 10, 0);
  try {
    store.recordStats({ packetsLast24h: 2_000, packetsLastHour: 100 }, start);
    store.recordStats({ packetsLast24h: 2_100, packetsLastHour: 120 }, start + 60_000);
    store.recordStats({ packetsLast24h: 3_000, packetsLastHour: 300 }, start + 5 * 60_000);
    assert.equal(store.recordStats({}), null);

    const series = store.statsSeries(0);
    assert.equal(series.length, 2);
    assert.equal(series[0].packetsLastHour, 120);
    assert.equal(series[0].packetsLast24h, 2_100);
    assert.equal(series[1].packetsLastHour, 300);

    store.recordStats({ packetsLastHour: 1 }, start + 31 * 24 * 60 * 60_000);
    const pruned = store.statsSeries(0);
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0].packetsLastHour, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("aggregates five-minute stats into hourly and daily rollups", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-metrics-"));
  const store = createNodeMetricsStore(join(directory, "metrics.sqlite"));
  const start = Date.UTC(2026, 8, 1, 10, 0);
  try {
    for (let index = 0; index < 12; index += 1) {
      store.recordStats({ packetsLastHour: 100 + index }, start + index * 5 * 60_000);
    }
    store.recordStats({ packetsLastHour: 200 }, start + 60 * 60_000);
    const hourly = store.statsRollupSeries(start, "hour");
    assert.equal(hourly.length, 1);
    assert.equal(hourly[0].bucketAt, start);
    assert.equal(hourly[0].samples, 12);
    assert.equal(hourly[0].packetsLastHour, 105.5);
    assert.equal(hourly[0].peak, 111);

    store.recordStats({ packetsLastHour: 300 }, start + 24 * 60 * 60_000);
    const localDayStart = new Date(start);
    localDayStart.setHours(0, 0, 0, 0);
    const daily = store.statsRollupSeries(localDayStart.getTime(), "day");
    assert.equal(daily.length, 1);
    assert.equal(daily[0].bucketAt, localDayStart.getTime());
    assert.equal(daily[0].samples, 13);
    assert.equal(daily[0].peak, 200);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("drops samples outside the seven-day scoring window", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-metrics-"));
  const store = createNodeMetricsStore(join(directory, "metrics.sqlite"));
  const start = Date.UTC(2026, 7, 1);

  try {
    store.recordNodes([{ public_key: "AABB", usefulness_score: 0.9 }], start);
    store.recordNodes([{ public_key: "AABB", usefulness_score: 0.3 }], start + 8 * 24 * 60 * 60 * 1000);
    const [decorated] = store.decorateNodes([{ public_key: "aabb" }]);
    assert.equal(decorated.long_term_sample_count, 1);
    assert.equal(decorated.long_term_usefulness_score, 0.3);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
