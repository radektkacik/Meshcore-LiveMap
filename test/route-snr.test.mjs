import assert from "node:assert/strict";
import test from "node:test";
import { routeHopSnr, routeSegmentSnr } from "../src/route-snr.js";

test("hop SNR belongs to the receiving node, not the segment leaving it", () => {
  const route = { snrValues: [12, 3] };
  const first = { pathIndex: 0 };
  const second = { pathIndex: 1 };
  const third = { pathIndex: 2 };
  assert.equal(routeHopSnr(route, first, 0), 12);
  assert.equal(routeHopSnr(route, second, 1), 3);
  assert.equal(routeHopSnr(route, third, 2), null);
  assert.equal(routeSegmentSnr(route, second, 1), 3);
});

test("hop SNR uses the original path index when unresolved hops were skipped", () => {
  const route = { snrValues: [12, 3, -4] };
  assert.equal(routeHopSnr(route, { pathIndex: 2 }, 1), -4);
  assert.equal(routeHopSnr(route, { pathIndex: 3 }, 1), null);
});

test("hop SNR ignores values across breaks and invalid input", () => {
  const route = { snrValues: [12] };
  assert.equal(routeSegmentSnr(route, { pathIndex: 0, breakBefore: true }, 0), null);
  assert.equal(routeHopSnr(null, { pathIndex: 0 }, 0), null);
  assert.equal(routeHopSnr({ snrValues: [NaN] }, { pathIndex: 0 }, 0), null);
  assert.equal(routeHopSnr({ snrValues: [12] }, { pathIndex: -1 }, 0), null);
});
