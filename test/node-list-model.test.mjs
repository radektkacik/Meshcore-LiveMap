import assert from "node:assert/strict";
import test from "node:test";
import { filterNodeList, sortNodeList } from "../src/node-list-model.js";

const nodes = [
  {
    name: "Žižkov repeater",
    public_key: "A1B2C3D4",
    role: "repeater",
    relay_count_24h: 12,
    health: { batteryMv: 4100, firmware: "v1.2", boardName: "T1000-E" },
  },
  {
    name: "Brno companion",
    public_key: "B2C3D4E5",
    role: "companion",
    relay_count_24h: 3,
    health: { batteryMv: 3800 },
  },
  {
    name: "Praha room",
    public_key: "C3D4E5F6",
    role: "room",
    relay_count_24h: null,
  },
];

test("battery status sorts by the reported assessment, not by pack voltage", () => {
  const full = { health: { batteryStatus: "full", batteryMv: 3350 } };
  const low = { health: { batteryStatus: "critical", batteryMv: 12000 } };
  const unrated = { health: { batteryMv: 4100 } };
  assert.deepEqual(sortNodeList([low, unrated, full], { sortBy: "batteryStatus" }), [full, low, unrated]);
});

test("telemetry columns sort numerically and the filter includes zero readings", () => {
  const a = { health: { temperatureC: "-5", humidityPct: 0, currentMa: "12" } };
  const b = { health: { temperatureC: "2", humidityPct: 20, currentMa: "3" } };
  const missing = { health: { temperatureC: "", currentMa: "invalid" } };
  assert.deepEqual(filterNodeList([a, b, missing], { data: "telemetry" }), [a, b]);
  assert.equal(filterNodeList([{ health: { humidityPct: 0 } }], { data: "telemetry" }).length, 1);
  assert.deepEqual(sortNodeList([missing, b, a], { sortBy: "temperature", direction: "asc" }), [a, b, missing]);
  assert.deepEqual(sortNodeList([missing, a, b], { sortBy: "current", direction: "asc" }), [b, a, missing]);
  assert.deepEqual(sortNodeList([missing, a, b], { sortBy: "humidity", direction: "asc" }), [a, b, missing]);
});

test("data filters combine with role and sorting places missing data last", () => {
  const located = { ...nodes[1], lat: 49.2, lon: 16.6 };
  const entries = [...nodes, located];
  assert.deepEqual(filterNodeList(entries, { data: "position", role: "companion" }), [located]);
  assert.deepEqual(filterNodeList(entries, { data: "hardware" }), [nodes[0]]);
  assert.deepEqual(filterNodeList(nodes, { data: "telemetry" }), nodes.slice(0, 2));
  assert.equal(sortNodeList(entries, { sortBy: "position", direction: "asc" })[0], located);
  assert.equal(sortNodeList(nodes, { sortBy: "hardware", direction: "asc" })[0], nodes[0]);
});

test("node list search ignores diacritics and matches key, role and hardware", () => {
  assert.deepEqual(filterNodeList(nodes, { query: "zizkov" }), [nodes[0]]);
  assert.deepEqual(filterNodeList(nodes, { query: "b2c3" }), [nodes[1]]);
  assert.deepEqual(filterNodeList(nodes, { query: "t1000" }), [nodes[0]]);
  assert.deepEqual(filterNodeList(nodes, { query: "room" }), [nodes[2]]);
});

test("node list defaults to active nodes and can include inactive nodes or filter by role", () => {
  const isActive = (node) => node.role !== "room";
  assert.deepEqual(filterNodeList(nodes, { isActive }), [nodes[0], nodes[1]]);
  assert.deepEqual(filterNodeList(nodes, { isActive, includeInactive: true }), nodes);
  assert.deepEqual(filterNodeList(nodes, { isActive, includeInactive: true, role: "repeater" }), [nodes[0]]);
});

test("node list sorting handles names, numeric fields and missing values", () => {
  assert.deepEqual(sortNodeList(nodes, { sortBy: "name", direction: "asc" }), [nodes[1], nodes[2], nodes[0]]);
  assert.deepEqual(sortNodeList(nodes, { sortBy: "relay" }), [nodes[0], nodes[1], nodes[2]]);
  assert.deepEqual(sortNodeList(nodes, { sortBy: "battery" }), [nodes[0], nodes[1], nodes[2]]);
  assert.deepEqual(
    sortNodeList(nodes, { sortBy: "activity", activityAt: (node) => node.role === "room" ? 3 : node.role === "repeater" ? 2 : 1 }),
    [nodes[2], nodes[0], nodes[1]],
  );
});
