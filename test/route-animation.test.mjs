import assert from "node:assert/strict";
import test from "node:test";
import {
  HEAVY_ROUTE_ANIMATION_FPS,
  HEAVY_ROUTE_COUNT,
  NORMAL_ROUTE_ANIMATION_FPS,
  routeAnimationFps,
} from "../src/route-animation.js";

test("canvas route animation uses the normal frame rate below heavy load", () => {
  assert.equal(routeAnimationFps(0), NORMAL_ROUTE_ANIMATION_FPS);
  assert.equal(routeAnimationFps(HEAVY_ROUTE_COUNT - 1), NORMAL_ROUTE_ANIMATION_FPS);
});

test("canvas route animation lowers the frame rate at heavy route counts", () => {
  assert.equal(routeAnimationFps(HEAVY_ROUTE_COUNT), HEAVY_ROUTE_ANIMATION_FPS);
  assert.equal(routeAnimationFps(350), HEAVY_ROUTE_ANIMATION_FPS);
});

test("invalid route counts keep the normal frame rate", () => {
  assert.equal(routeAnimationFps(Number.NaN), NORMAL_ROUTE_ANIMATION_FPS);
  assert.equal(routeAnimationFps(-1), NORMAL_ROUTE_ANIMATION_FPS);
});
