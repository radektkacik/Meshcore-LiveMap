import test from "node:test";
import assert from "node:assert/strict";
import { observerAnchor } from "../src/observer-locations.js";

test("observer anchors provide fallback coordinates for known IATA codes", () => {
  assert.deepEqual(observerAnchor("osr"), { lat: 49.6963, lon: 18.1111 });
  assert.deepEqual(observerAnchor("PRG"), { lat: 50.1008, lon: 14.26 });
  assert.equal(observerAnchor("XXX"), null);
  assert.equal(observerAnchor(""), null);
});
