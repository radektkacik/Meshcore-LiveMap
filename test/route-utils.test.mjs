import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveQuery,
  isPrimaryPacketType,
  isRouteVisible,
  liveRouteCreatedAt,
  maxRouteHopKm,
  packetPathHashBytes,
  parsePath,
  pathHashBytes,
  resolveCandidateChain,
} from "../src/route-utils.js";

test("parses and normalizes packet paths", () => {
  assert.deepEqual(parsePath({ path_json: '["a1","b2c3",42]' }), ["A1", "B2C3", "42"]);
  assert.deepEqual(parsePath({ path_json: "invalid" }), []);
  assert.deepEqual(parsePath({ path_json: '{"hop":"A1"}' }), []);
  assert.deepEqual(parsePath({}), []);
});

test("uses the shortest hop prefix as route hash size", () => {
  assert.equal(pathHashBytes([]), 0);
  assert.equal(pathHashBytes(["AA", "BBBB"]), 1);
  assert.equal(pathHashBytes(["AAAA", "BBBBBB"]), 2);
});

test("uses explicit or raw packet hash size before path token lengths", () => {
  assert.equal(packetPathHashBytes({ path_hash_bytes: 3, path_json: '["AA"]' }), 3);
  assert.equal(packetPathHashBytes({ raw_hex: "1141AABB", route_type: 1, path_json: '["AA"]' }), 2);
  assert.equal(packetPathHashBytes({ raw_hex: "150000000081AABBCC", route_type: 0, path_json: '["AA"]' }), 3);
  assert.equal(packetPathHashBytes({ payload_type: 9, raw_hex: "1181AABBCC", path_json: '["AABB"]' }), 2);
});

test("applies packet type and hash filters consistently", () => {
  const defaults = { showOneByteRoutes: false, showOtherPacketTypes: false };
  assert.equal(isPrimaryPacketType("4"), true);
  assert.equal(isPrimaryPacketType(9), true);
  assert.equal(isPrimaryPacketType(8), false);
  assert.equal(isPrimaryPacketType(6), false);
  assert.equal(isRouteVisible(4, 2, defaults), true);
  assert.equal(isRouteVisible(4, 1, defaults), false);
  assert.equal(isRouteVisible(4, 0, defaults), false);
  assert.equal(isRouteVisible(8, 2, defaults), false);
  assert.equal(isRouteVisible(8, 2, { showOneByteRoutes: false, showOtherPacketTypes: true }), false);
  assert.equal(isRouteVisible(6, 2, defaults), false);
  assert.equal(isRouteVisible(6, 1, { showOneByteRoutes: true, showOtherPacketTypes: true }), true);
});

test("live route creation clamps future clocks and rejects expired packets", () => {
  const now = 1_000_000;
  assert.equal(liveRouteCreatedAt(now - 10_000, now, 30_000), now - 10_000);
  assert.equal(liveRouteCreatedAt(now - 30_000, now, 30_000), null);
  assert.equal(liveRouteCreatedAt(now + 60_000, now, 30_000), now);
  assert.equal(liveRouteCreatedAt(Number.NaN, now, 30_000), now);
});

test("archive query maps windows to since and limit", () => {
  const now = Date.UTC(2026, 8, 12, 12, 0, 0);
  assert.equal(archiveQuery(5 * 60_000, now), `since=${now - 5 * 60_000}&limit=600`);
  assert.equal(archiveQuery(60 * 60_000, now), `since=${now - 60 * 60_000}&limit=2500`);
  assert.equal(archiveQuery(24 * 60 * 60_000, now), `since=${now - 24 * 60 * 60_000}&limit=20000`);
});

test("hash size set overrides the single one-byte toggle", () => {
  const twoThree = { allowedHashBytes: new Set([2, 3]), showOtherPacketTypes: false };
  assert.equal(isRouteVisible(4, 2, twoThree), true);
  assert.equal(isRouteVisible(4, 3, twoThree), true);
  assert.equal(isRouteVisible(4, 1, twoThree), false);
  assert.equal(isRouteVisible(4, 0, twoThree), false);
  const all = { allowedHashBytes: new Set([1, 2, 3]), showOtherPacketTypes: false };
  assert.equal(isRouteVisible(4, 1, all), true);
});

test("trace routes stay visible even when one-byte routes are filtered out", () => {
  const twoThree = { allowedHashBytes: new Set([2, 3]), showOtherPacketTypes: false };
  assert.equal(isRouteVisible(9, 1, twoThree), true);
  assert.equal(isRouteVisible(9, 2, twoThree), true);
  assert.equal(isRouteVisible(9, 0, twoThree), false);
});

test("candidate chain prefers a compact sequence across ambiguous hops", () => {
  const near = (name, lat, lon) => ({ name, lat, lon });
  const sets = [
    [near("far-a", 50.9, 15.9), near("near-a", 50.0, 15.0)],
    [near("far-b", 50.8, 15.8), near("near-b", 50.05, 15.05)],
    [near("far-c", 50.7, 15.7), near("near-c", 50.1, 15.1)],
  ];
  const chain = resolveCandidateChain(sets, { maxHopKm: 150 });
  assert.deepEqual(chain.map((candidate) => candidate.name), ["near-a", "near-b", "near-c"]);
});

test("candidate chain respects a start anchor and the hop limit", () => {
  const start = { lat: 50, lon: 15 };
  const sets = [
    [{ name: "near", lat: 50.02, lon: 15.02 }, { name: "far", lat: 51.5, lon: 16.5 }],
    [{ name: "next", lat: 50.04, lon: 15.04 }],
  ];
  const chain = resolveCandidateChain(sets, { maxHopKm: 50, start });
  assert.deepEqual(chain.map((candidate) => candidate.name), ["near", "next"]);
  assert.equal(resolveCandidateChain([[{ name: "far", lat: 51.5, lon: 16.5 }]], { maxHopKm: 50, start }), null);
  assert.equal(resolveCandidateChain([], { maxHopKm: 50 }), null);
});

test("allows a longer hop only for routes with at least two hash bytes", () => {
  assert.equal(maxRouteHopKm(0), 170);
  assert.equal(maxRouteHopKm(1), 170);
  assert.equal(maxRouteHopKm(2), 200);
  assert.equal(maxRouteHopKm(3), 200);
});
