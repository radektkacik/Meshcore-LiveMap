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
