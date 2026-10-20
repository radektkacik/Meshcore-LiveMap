import assert from "node:assert/strict";
import test from "node:test";
import {
  activeUsefulnessScore,
  isNodeActive,
  isNodeRoleAllowed,
  nodeLastActivity,
  nodeMatchesQuery,
  parseNodeQuery,
  rankNodeMetric,
  rankNodesByMetric,
  rankNodeTiers,
  resolveStatsField,
} from "../src/node-model.js";

const now = Date.UTC(2026, 8, 8, 12);
const hour = 60 * 60 * 1000;

test("node activity uses the newest valid activity timestamp", () => {
  const node = {
    last_seen: new Date(now - 2 * hour).toISOString(),
    last_heard: "invalid",
    last_relayed: new Date(now - 30 * 60 * 1000).toISOString(),
  };
  assert.equal(nodeLastActivity(node), now - 30 * 60 * 1000);
  assert.equal(isNodeActive(node, now, hour), true);
  assert.equal(isNodeActive({ last_seen: new Date(now - hour).toISOString() }, now, hour), false);
});

test("ranking assigns Top 25 and Top 100 only to active nodes with valid scores", () => {
  const nodes = Array.from({ length: 102 }, (_, index) => ({
    lat: 49,
    lon: 15,
    last_seen: new Date(now - hour).toISOString(),
    usefulness_score: 102 - index,
  }));
  nodes[101].last_seen = new Date(now - 25 * hour).toISOString();
  const tiers = rankNodeTiers(nodes, now, 24 * hour);

  assert.equal(tiers.get(nodes[0]), "top25");
  assert.equal(tiers.get(nodes[24]), "top25");
  assert.equal(tiers.get(nodes[25]), "top100");
  assert.equal(tiers.get(nodes[99]), "top100");
  assert.equal(tiers.get(nodes[100]), null);
  assert.equal(tiers.has(nodes[101]), false);
});

test("ranking by metric filters roles, ignores missing values and keeps order", () => {
  const nodes = [
    { name: "a", role: "repeater", relay_count_24h: 5 },
    { name: "b", role: "repeater", relay_count_24h: 9 },
    { name: "c", role: "companion", relay_count_24h: 50 },
    { name: "d", role: "repeater" },
    { name: "e", role: "repeater", long_term_usefulness_score: 0.8, usefulness_score: 0.2 },
  ];
  const ranked = rankNodesByMetric(nodes, "relay_count_24h", 2, new Set(["repeater"]));
  assert.deepEqual(ranked.map(({ node }) => node.name), ["b", "a"]);
  assert.deepEqual(
    rankNodesByMetric(nodes, "long_term_usefulness_score", 5, new Set(["repeater"])).map(({ value }) => value),
    [0.8],
  );
});

test("stats field resolves metric and window independently", () => {
  assert.equal(resolveStatsField("relay", "1h"), "relay_count_1h");
  assert.equal(resolveStatsField("relay", "24h"), "relay_count_24h");
  assert.equal(resolveStatsField("relay", "7d"), null);
  assert.equal(resolveStatsField("usefulness", "7d"), "long_term_usefulness_score");
  assert.equal(resolveStatsField("usefulness", "1h"), "usefulness_score");
  assert.equal(resolveStatsField("advert", "7d"), "advert_count");
  assert.equal(resolveStatsField("unscoped", "24h"), "unscoped_relay_count_24h");
  assert.equal(resolveStatsField("unscoped", "1h"), null);
});

test("node query only treats a fully hex token as a prefix", () => {
  assert.deepEqual(parseNodeQuery("ABBS"), { query: "abbs", hexQuery: "" });
  assert.deepEqual(parseNodeQuery("AB BA"), { query: "ab ba", hexQuery: "ABBA" });
  assert.deepEqual(parseNodeQuery("ab"), { query: "ab", hexQuery: "AB" });
  assert.deepEqual(parseNodeQuery("rip5"), { query: "rip5", hexQuery: "" });
  assert.equal(nodeMatchesQuery({ name: "x", public_key: "ABBA00" }, "abbs", parseNodeQuery("ABBS").hexQuery), false);
  assert.equal(nodeMatchesQuery({ name: "x", public_key: "ABBA00" }, "ab ba", parseNodeQuery("AB BA").hexQuery), true);
});

test("node search matches name or public key prefix", () => {
  const node = { name: "rip5.meshcore.cz", public_key: "A1B2C3D4E5" };
  assert.equal(nodeMatchesQuery(node, "rip5", "RIP5"), true);
  assert.equal(nodeMatchesQuery(node, "meshcore", ""), true);
  assert.equal(nodeMatchesQuery(node, "xyz", "A1B2"), true);
  assert.equal(nodeMatchesQuery(node, "xyz", "a1b2"), true);
  assert.equal(nodeMatchesQuery(node, "", "A"), false);
  assert.equal(nodeMatchesQuery(node, "xyz", "B2"), false);
});

test("role filter accepts only the selected roles", () => {
  const roles = new Set(["repeater", "room"]);
  assert.equal(isNodeRoleAllowed({ role: "repeater" }, roles), true);
  assert.equal(isNodeRoleAllowed({ role: "room" }, roles), true);
  assert.equal(isNodeRoleAllowed({ role: "companion" }, roles), false);
  assert.equal(isNodeRoleAllowed({}, roles), false);
  assert.equal(isNodeRoleAllowed({ role: "sensor" }, new Set()), false);
  assert.equal(isNodeRoleAllowed({ role: "sensor" }, null), true);
});

test("active usefulness prefers long-term metrics and rejects invalid coordinates", () => {
  const node = {
    lat: 49,
    lon: 15,
    last_seen: new Date(now - hour).toISOString(),
    usefulness_score: 0.2,
    long_term_usefulness_score: 0.7,
  };
  assert.equal(activeUsefulnessScore(node, now, 24 * hour), 0.7);
  assert.equal(activeUsefulnessScore({ ...node, lat: 0, lon: 0 }, now, 24 * hour), null);
});

test("rankNodeMetric reports rank and total among nodes with the metric", () => {
  const nodes = [
    { public_key: "A", usefulness_score: 0.9 },
    { public_key: "B", usefulness_score: 0.7 },
    { public_key: "C", usefulness_score: 0.7 },
    { public_key: "D", usefulness_score: 0.1 },
    { public_key: "E" },
  ];
  assert.deepEqual(rankNodeMetric(nodes, nodes[1], "usefulness_score"), { rank: 2, total: 4 });
  assert.deepEqual(rankNodeMetric(nodes, nodes[3], "usefulness_score"), { rank: 4, total: 4 });
  assert.deepEqual(rankNodeMetric(nodes, nodes[4], "usefulness_score"), null);
  assert.deepEqual(
    rankNodeMetric(nodes, nodes[0], "usefulness_score", new Set(["repeater"])),
    null,
  );
  const withRoles = nodes.map((node, index) => ({ ...node, role: index === 0 ? "repeater" : "companion" }));
  assert.deepEqual(
    rankNodeMetric(withRoles, withRoles[0], "usefulness_score", new Set(["repeater", "companion"])),
    { rank: 1, total: 4 },
  );
});
