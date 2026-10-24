import assert from "node:assert/strict";
import test from "node:test";
import { buildHeatmap, heatmapColor } from "../src/heatmap.js";

const bounds = { south: 49, west: 14, north: 51, east: 16 };

test("heatmap is empty without routes", () => {
  const grid = buildHeatmap([], bounds, { size: 32 });
  assert.equal(grid.max, 0);
  assert.equal(grid.samples, 0);
  assert.equal(grid.cells.reduce((sum, value) => sum + value, 0), 0);
});

test("heatmap accumulates segments along routes", () => {
  const route = {
    points: [
      { lat: 50, lon: 15 },
      { lat: 50, lon: 15.5 },
      { lat: 50.5, lon: 15.5 },
    ],
  };
  const grid = buildHeatmap([route], bounds, { size: 32 });
  assert.ok(grid.max > 0);
  assert.ok(grid.samples > 2);
  assert.ok(grid.cells.reduce((sum, value) => sum + value, 0) >= grid.samples);
});

test("heatmap ignores segments after a break and caps samples", () => {
  const route = {
    points: [
      { lat: 50, lon: 15 },
      { lat: 50, lon: 15.1 },
      { lat: 50.5, lon: 15.5, breakBefore: true },
      { lat: 50.6, lon: 15.6 },
    ],
  };
  const full = buildHeatmap([route], bounds, { size: 32 });
  const capped = buildHeatmap([route], bounds, { size: 32, maxSamples: 3 });
  assert.equal(capped.samples, 3);
  assert.ok(full.samples > capped.samples);
  const broken = buildHeatmap([
    { points: [{ lat: 50, lon: 15 }, { lat: 50.5, lon: 15.5, breakBefore: true }] },
  ], bounds, { size: 32 });
  assert.equal(broken.samples, 0);
});

test("heatmap colours fade from transparent to red", () => {
  assert.deepEqual(heatmapColor(0), [0, 0, 0, 0]);
  assert.equal(heatmapColor(1)[0], 225);
  assert.equal(heatmapColor(0.5)[3], 255);
  assert.equal(heatmapColor(2)[0], 225);
});
