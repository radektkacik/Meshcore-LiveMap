import test from "node:test";
import assert from "node:assert/strict";
import { suggestReplacement, suggestTracePath } from "../src/trace-suggestion.js";

const now = 1_800_000_000_000;
const key = (prefix) => prefix.padEnd(64, "0").toUpperCase();
const [a, b, c, d] = ["1111", "2222", "3333", "4444"].map(key);
const nodes = [a, b, c, d].map((public_key) => ({ public_key, role: "repeater", lat: 50, lon: 15 }));
const edge = (at) => ({ lastAt: at, count: 1 });
const graph = new Map([
  [a, new Map([[b, edge(now - 1000)], [d, edge(now - 3 * 86400000)]])],
  [b, new Map([[c, edge(now - 2000)]])],
  [d, new Map([[c, edge(now - 3 * 86400000)]])],
]);

test("suggestion uses fresh observed neighbors and adds reversed return path", () => {
  const result = suggestTracePath(a, c, graph, nodes, now);
  assert.deepEqual(result.path, [a, b, c, b, a].map((key) => key.toLowerCase()));
  assert.equal(result.oldest, now - 2000);
});

test("suggestion does not invent missing or stale links", () => {
  assert.equal(suggestTracePath(c, a, graph, nodes, now), null);
  assert.equal(suggestTracePath(a, c, graph, nodes, now + 8 * 86400000), null);
  assert.equal(suggestTracePath(a, a, graph, nodes, now), null);
});

test("suggestion avoids known colliding repeater prefixes", () => {
  const collision = { public_key: `2222${"f".repeat(60)}`, role: "repeater", lat: 50, lon: 15 };
  assert.deepEqual(suggestTracePath(a, c, graph, [...nodes, collision], now).path, [a, d, c, d, a].map((key) => key.toLowerCase()));
});

test("suggestion only uses coordinates accepted by map rendering", () => {
  const invalid = nodes.map((node) => node.public_key === b ? { ...node, lat: 0, lon: 0 } : node);
  const result = suggestTracePath(a, c, graph, invalid, now);
  assert.deepEqual(result.path, [a, d, c, d, a].map((item) => item.toLowerCase()));
  const strings = nodes.map((node) => node.public_key === a ? { ...node, lat: "50" } : node);
  assert.equal(suggestTracePath(a, c, graph, strings, now), null);
});

test("alternative skips previously suggested routes and keeps their return leg", () => {
  const first = suggestTracePath(a, c, graph, nodes, now);
  const seen = new Set([first.path.join(",")]);
  const second = suggestTracePath(a, c, graph, nodes, now, seen);
  assert.deepEqual(second.path, [a, d, c, d, a].map((item) => item.toLowerCase()));
  seen.add(second.path.join(","));
  assert.equal(suggestTracePath(a, c, graph, nodes, now, seen), null);
});

test("hop replacement requires fresh observations to both neighboring hops", () => {
  const links = new Map([
    [a, new Map([[b, edge(now - 100)], [d, edge(now - 200)]])],
    [d, new Map([[c, edge(now - 300)]])],
  ]);
  assert.equal(suggestReplacement([a, b, c], 1, links, nodes, now).key, d.toLowerCase());
  assert.equal(suggestReplacement([a, b, c], 0, links, nodes, now), null);
  assert.equal(suggestReplacement([a, b, c], 1, links, nodes, now + 8 * 86400000), null);
  assert.equal(suggestReplacement([a, b, c], 1, new Map([[a, links.get(a)]]), nodes, now), null);
});

test("hop replacement rejects ambiguous hashes and supports the same neighbor on both sides", () => {
  const links = new Map([
    [a, new Map([[d, edge(now - 200)]])],
    [d, new Map([[a, edge(now - 200)]])],
  ]);
  assert.equal(suggestReplacement([a, b, a], 1, links, nodes, now).key, d.toLowerCase());
  const collision = { public_key: `4444${"f".repeat(60)}`, role: "repeater", lat: 50, lon: 15 };
  assert.equal(suggestReplacement([a, b, a], 1, links, [...nodes, collision], now), null);
});
