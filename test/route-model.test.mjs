import assert from "node:assert/strict";
import test from "node:test";
import { buildNeighborIndex, groupTraceObservations, RouteStore, RouteVersionState, routeTimestamp } from "../src/route-model.js";

const allRoutes = { showOneByteRoutes: true, showOtherPacketTypes: true };
const primaryTwoByte = { showOneByteRoutes: false, showOtherPacketTypes: false };

function route(overrides = {}) {
  return {
    createdAt: 99_000,
    hashBytes: 1,
    id: "packet:observer",
    packetType: 6,
    points: [
      { publicKey: "AAAA", name: "A" },
      { publicKey: "BBBB", name: "B" },
    ],
    versionId: "v1",
    ...overrides,
  };
}

test("route filters are non-destructive and restore live routes, feed and last routes", () => {
  const store = new RouteStore({ retentionMs: 60_000, feedLimit: 8 });
  store.addLive(route());

  assert.equal(store.visibleLive(primaryTwoByte, 100_000).length, 0);
  assert.equal(store.visibleFeed(primaryTwoByte, 100_000).length, 0);
  assert.equal(store.lastRoutesByNode(primaryTwoByte).size, 0);

  assert.equal(store.visibleLive(allRoutes, 100_000).length, 1);
  assert.equal(store.visibleFeed(allRoutes, 100_000)[0].versionId, "v1");
  assert.equal(store.lastRoutesByNode(allRoutes).get("AAAA").position, 1);
});

test("route store keeps the feed limit, 60 second live window and filtered history", () => {
  const store = new RouteStore({ retentionMs: 60_000, feedLimit: 8 });
  for (let index = 0; index < 10; index += 1) {
    store.addLive(route({
      createdAt: 90_000 + index,
      hashBytes: 2,
      id: `route-${index}`,
      packetType: 4,
      versionId: `v${index}`,
    }));
  }
  store.addHistory(route({ createdAt: 1_000, hashBytes: 2, packetType: 4, versionId: "history" }));

  assert.equal(store.visibleFeed(primaryTwoByte, 100_000).length, 8);
  assert.equal(store.visibleLive(primaryTwoByte, 151_000).length, 0);
  assert.equal(store.lastRoutesByNode(primaryTwoByte).get("AAAA").versionId, "v9");

  store.prune(151_000);
  assert.equal(store.lastRoutesByNode(primaryTwoByte).get("AAAA").versionId, "history");
});

test("route timestamps fall back across invalid values and support SQLite and epoch formats", () => {
  assert.equal(routeTimestamp({ latest: "bad", first_seen: "2026-09-08 12:30:00" }), Date.UTC(2026, 8, 8, 12, 30));
  assert.equal(routeTimestamp({ latest: "1_000", timestamp: 123 }), 123_000);
  assert.equal(routeTimestamp({ latest: null }, 456_000), 456_000);
});

test("packet occurrences keep every observer and the newest version per observer", () => {
  const store = new RouteStore({ retentionMs: 60_000, feedLimit: 8 });
  store.addLive(route({
    createdAt: 95_000,
    id: "AA:observer-a",
    packetHash: "AA",
    versionId: "a1",
  }));
  store.addLive(route({
    createdAt: 97_000,
    id: "AA:observer-a",
    packetHash: "AA",
    versionId: "a2",
  }));
  store.addLive(route({
    createdAt: 96_000,
    id: "AA:observer-b",
    packetHash: "AA",
    packetType: 2,
    versionId: "b1",
  }));
  store.addLive(route({
    createdAt: 98_000,
    id: "BB:observer-c",
    packetHash: "BB",
    versionId: "c1",
  }));
  store.addLive(route({
    createdAt: 10_000,
    id: "AA:observer-d",
    packetHash: "AA",
    versionId: "d1",
  }));
  store.addHistory(route({
    createdAt: 1_000,
    id: "AA:observer-e",
    packetHash: "AA",
    versionId: "history",
  }));

  const occurrences = store.packetOccurrences("aa", allRoutes, 100_000);
  assert.deepEqual(occurrences.map((entry) => entry.versionId), ["a2", "b1", "history"]);
  assert.equal(store.packetOccurrences("aa", primaryTwoByte, 100_000).length, 0);
  assert.equal(store.packetOccurrences("", allRoutes, 100_000).length, 0);
});

test("live store evicts the oldest version at its capacity", () => {
  const store = new RouteStore({ retentionMs: 60_000, feedLimit: 8, capacity: 3 });
  for (let index = 0; index < 5; index += 1) {
    store.addLive(route({ id: `route-${index}`, versionId: `v${index}` }));
  }
  assert.equal(store.liveByVersion.size, 3);
  assert.deepEqual([...store.liveByVersion.keys()], ["v2", "v3", "v4"]);
});

test("neighbor index counts undirected adjacencies and keeps newest name and time", () => {
  const index = buildNeighborIndex([
    {
      points: [
        { publicKey: "AAAA", name: "A" },
        { publicKey: "BBBB", name: "B" },
        { publicKey: "CCCC", name: "C" },
      ],
      timestamp: 100,
    },
    {
      points: [
        { publicKey: "AAAA", name: "A" },
        { publicKey: "BBBB", name: "B" },
      ],
      timestamp: 200,
    },
  ]);

  assert.equal(index.get("AAAA").get("BBBB").count, 2);
  assert.equal(index.get("BBBB").get("AAAA").count, 2);
  assert.equal(index.get("BBBB").get("CCCC").count, 1);
  assert.equal(index.get("AAAA").get("BBBB").lastAt, 200);
  assert.deepEqual([...index.get("CCCC").keys()], ["BBBB"]);
});

test("trace observations are grouped by tag and the most complete route wins", () => {
  const short = route({
    createdAt: 100_000,
    id: "trace-a:obs-a",
    observerId: "obs-a",
    packetHash: "AAAA",
    packetType: 9,
    points: [{ publicKey: "A" }, { publicKey: "B" }],
    snrValues: [10],
    traceTag: "12345",
    versionId: "v-a",
  });
  const full = route({
    createdAt: 100_001,
    id: "trace-b:obs-b",
    observerId: "obs-b",
    packetHash: "BBBB",
    packetType: 9,
    points: [{ publicKey: "A" }, { publicKey: "B" }, { publicKey: "C" }],
    snrValues: [10, -8, 4],
    traceTag: "12345",
    versionId: "v-b",
  });
  const ordinary = route({ id: "ordinary", packetType: 4, versionId: "v-c" });
  const grouped = groupTraceObservations([short, full, ordinary]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].id, full.id);
  assert.equal(grouped[0].traceObservations, 2);
  assert.equal(grouped[0].traceObserverCount, 2);
  assert.equal(grouped[0].traceRoutes.length, 2);
  assert.equal(grouped[1].id, ordinary.id);
});

test("trace grouping prefers the observation with the most SNR values", () => {
  const partial = route({
    createdAt: 100_000,
    id: "partial",
    packetHash: "AAAA",
    packetType: 9,
    points: Array.from({ length: 8 }, (_, index) => ({ publicKey: `P${index}` })),
    snrValues: [12.3],
    traceTag: "777",
    versionId: "v-partial",
  });
  const full = route({
    createdAt: 100_001,
    id: "full",
    packetHash: "BBBB",
    packetType: 9,
    points: [{ publicKey: "A" }, { publicKey: "B" }],
    snrValues: [1, 2, 3, 4, 5, 6, 7],
    traceTag: "777",
    versionId: "v-full",
  });
  const grouped = groupTraceObservations([partial, full]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, "full");
  assert.deepEqual(grouped[0].snrValues, [1, 2, 3, 4, 5, 6, 7]);
});

test("route version state coalesces in-flight work and retries failures", async () => {
  const state = new RouteVersionState(2);
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = state.run("v1", async () => {
    calls += 1;
    await pending;
    return "route";
  });
  const concurrent = state.run("v1", () => { calls += 1; });
  assert.strictEqual(first, concurrent);
  release();
  assert.deepEqual(await first, { status: "processed", value: "route" });
  assert.equal(calls, 1);
  assert.deepEqual(await state.run("v1", () => { calls += 1; }), { status: "seen" });

  await assert.rejects(state.run("retry", () => Promise.reject(new Error("temporary"))), /temporary/);
  assert.equal((await state.run("retry", () => "ok")).value, "ok");
});
