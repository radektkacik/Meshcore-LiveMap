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
