import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_MIN_HEIGHT, ACTIVITY_MIN_WIDTH, clampActivitySize } from "../src/activity-size.js";

test("activity size is clamped to the allowed range", () => {
  const limits = { maxHeight: 400, maxWidth: 500, minHeight: 150, minWidth: 240 };
  assert.deepEqual(clampActivitySize({ h: 100, w: 100 }, limits), {
    height: ACTIVITY_MIN_HEIGHT,
    width: ACTIVITY_MIN_WIDTH,
  });
  assert.deepEqual(clampActivitySize({ h: 900, w: 900 }, limits), { height: 400, width: 500 });
  assert.deepEqual(clampActivitySize({ h: 300, w: 360 }, limits), { height: 300, width: 360 });
});

test("activity size falls back to the minimum for invalid values", () => {
  assert.deepEqual(clampActivitySize({ h: "nope", w: null }, {}), {
    height: ACTIVITY_MIN_HEIGHT,
    width: ACTIVITY_MIN_WIDTH,
  });
});
