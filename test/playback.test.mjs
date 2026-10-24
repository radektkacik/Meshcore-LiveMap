import assert from "node:assert/strict";
import test from "node:test";
import {
  playbackCursor,
  playbackFraction,
  playbackRate,
  playbackTrailMs,
  playbackVisibleRoutes,
} from "../src/playback.js";

test("playback trail scales with the window and stays bounded", () => {
  assert.equal(playbackTrailMs(60 * 60_000), 2 * 60_000);
  assert.equal(playbackTrailMs(24 * 60 * 60_000), 30 * 60_000);
  assert.equal(playbackTrailMs(7 * 24 * 60 * 60_000), 3.5 * 60 * 60_000);
  assert.equal(playbackTrailMs(0), 2 * 60_000);
});

test("playback cursor maps between time and slider fraction", () => {
  const start = 1_000;
  const end = 5_000;
  assert.equal(playbackCursor(start, end, 0), start);
  assert.equal(playbackCursor(start, end, 0.5), 3_000);
  assert.equal(playbackCursor(start, end, 1), end);
  assert.equal(playbackCursor(start, end, 2), end);
  assert.equal(playbackFraction(start, end, 3_000), 0.5);
  assert.equal(playbackFraction(start, end, start - 10), 0);
  assert.equal(playbackFraction(end, end, end), 0);
});

test("playback shows only routes inside the trail window", () => {
  const routes = [
    { id: "old", timestamp: 1_000 },
    { id: "edge", timestamp: 5_000 },
    { id: "current", timestamp: 8_000 },
    { id: "future", timestamp: 9_000 },
  ];
  assert.deepEqual(
    playbackVisibleRoutes(routes, 8_000, 3_000).map((route) => route.id),
    ["edge", "current"],
  );
  assert.deepEqual(playbackVisibleRoutes([], 8_000, 3_000), []);
});

test("playback rate compresses the whole window into one minute", () => {
  assert.equal(playbackRate(60_000, 1), 1);
  assert.equal(playbackRate(24 * 60 * 60_000, 1), 1_440);
  assert.equal(playbackRate(24 * 60 * 60_000, 2), 2_880);
  assert.equal(playbackRate(0, 1), 0);
});
