import assert from "node:assert/strict";
import test from "node:test";
import { FIRMWARE_NONE, firmwareGroups, firmwareKey, firmwareMatches, firmwareShortLabel } from "../src/firmware-filter.js";

test("firmware keys use health firmware and a stable unknown bucket", () => {
  assert.equal(firmwareKey({ health: { firmware: "v1.18.0.02rc.12.t1" } }), "v1.18.0.02rc.12.t1");
  assert.equal(firmwareKey({ health: {} }), FIRMWARE_NONE);
  assert.equal(firmwareKey({}), FIRMWARE_NONE);
});

test("firmware labels stay short and keep patch suffixes", () => {
  assert.equal(firmwareShortLabel("v1.18.0.02rc.10-meshcz-f1a0"), "RC10");
  assert.equal(firmwareShortLabel("v1.18.0.02rc.12.t1"), "RC12.t1");
  assert.equal(firmwareShortLabel(FIRMWARE_NONE), null);
  assert.equal(firmwareShortLabel("custom-build"), "custom-build");
});

test("firmware groups count nodes and keep unknown last", () => {
  assert.deepEqual(firmwareGroups([
    { health: { firmware: "v1.18.0.02rc.10-meshcz-f1a0" } },
    { health: { firmware: "v1.18.0.02rc.12.t1" } },
    { health: { firmware: "v1.18.0.02rc.10-meshcz-f1a0" } },
    {},
    {},
  ]), [
    { key: "v1.18.0.02rc.10-meshcz-f1a0", count: 2 },
    { key: "v1.18.0.02rc.12.t1", count: 1 },
    { key: FIRMWARE_NONE, count: 2 },
  ]);
});

test("firmware filter treats null as all and supports no selection", () => {
  const node = { health: { firmware: "v1.18.0.02rc.12.t1" } };
  assert.equal(firmwareMatches(null, node), true);
  assert.equal(firmwareMatches(new Set(["v1.18.0.02rc.12.t1"]), node), true);
  assert.equal(firmwareMatches(new Set(["v1.18.0.02rc.10-meshcz-f1a0"]), node), false);
  assert.equal(firmwareMatches(new Set(), node), false);
});
