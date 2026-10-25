import assert from "node:assert/strict";
import test from "node:test";
import { countSearchResults, parseSearchQuery, searchEntities } from "../src/search-model.js";

const nodes = [
  { lat: 50, lon: 14, name: "Praha-Žižkov", public_key: "AABBCCDD" },
  { lat: 49, lon: 15, name: "Brno", public_key: "CCDDEEFF" },
  { lat: 48, lon: 16, name: "Praha-Vinohrady", public_key: "EEFF0011" },
];

test("parseSearchQuery keeps text and hex prefixes", () => {
  assert.deepEqual(parseSearchQuery("  Pra ha "), { hex: "", query: "pra ha" });
  assert.deepEqual(parseSearchQuery("aa bb"), { hex: "AABB", query: "aa bb" });
  assert.deepEqual(parseSearchQuery("xyz"), { hex: "", query: "xyz" });
});

test("short queries return nothing", () => {
  assert.equal(countSearchResults(searchEntities({ nodes, query: "p" })), 0);
  assert.equal(countSearchResults(searchEntities({ nodes, query: "" })), 0);
});

test("node search prefers exact name and supports key prefix", () => {
  const byName = searchEntities({ nodes, query: "praha" });
  assert.deepEqual(byName.nodes.map((node) => node.name), ["Praha-Žižkov", "Praha-Vinohrady"]);

  const byKey = searchEntities({ nodes, query: "ccdd" });
  assert.deepEqual(byKey.nodes.map((node) => node.name), ["Brno"]);
});

test("observer search matches id, iata and name", () => {
  const observers = [
    { id: "AABB01", iata: "PRG", name: "Praha sever" },
    { id: "CCDD02", iata: "BRQ", name: "Brno jih" },
  ];
  assert.deepEqual(searchEntities({ observers, query: "brq" }).observers.map((item) => item.id), ["CCDD02"]);
  assert.deepEqual(searchEntities({ observers, query: "ccdd" }).observers.map((item) => item.id), ["CCDD02"]);
  assert.deepEqual(searchEntities({ observers, query: "praha" }).observers.map((item) => item.id), ["AABB01"]);
});

test("packet search uses hashes only and keeps the newest occurrence", () => {
  const packets = [
    { hash: "AABB01", timestamp: 1000, observer: "old" },
    { hash: "AABB01", timestamp: 5000, observer: "new" },
    { hash: "CCDD02", timestamp: 4000, observer: "other" },
  ];
  const result = searchEntities({ packets, query: "aabb" });
  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0].observer, "new");
  assert.equal(searchEntities({ packets, query: "observer" }).packets.length, 0);
});

test("channel search matches channel name, sender and message text", () => {
  const channels = [
    { channel: "#test", hash: "A1", sender: "Petr", text: "Ahoj z Prahy" },
    { channel: "#provoz", hash: "B2", sender: "Jana", text: "Test vysílačky" },
  ];
  assert.deepEqual(searchEntities({ channels, query: "#test" }).channels.map((item) => item.hash), ["A1"]);
  assert.deepEqual(searchEntities({ channels, query: "jana" }).channels.map((item) => item.hash), ["B2"]);
  assert.deepEqual(searchEntities({ channels, query: "prahy" }).channels.map((item) => item.hash), ["A1"]);
});

test("per-type limits are respected", () => {
  const many = Array.from({ length: 10 }, (_, index) => ({ name: `Uzel ${index}`, public_key: `AA${index}` }));
  assert.equal(searchEntities({ nodes: many, query: "uzel", limit: 3 }).nodes.length, 3);
});
