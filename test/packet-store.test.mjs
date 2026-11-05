import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPacketStore } from "../packet-store.mjs";

function row(overrides = {}) {
  return {
    hash: "h1",
    observer_id: "o1",
    observed_at: 1_000,
    payload_type: 5,
    route_type: 1,
    path_hash_bytes: 2,
    path_json: '["AAAA"]',
    resolved_path: '["AAAA"]',
    observer_name: "obs",
    observer_iata: "PRG",
    scope_name: "#cz",
    snr: 5,
    rssi: -80,
    decoded_json: "{}",
    raw_hex: "1141",
    ...overrides,
  };
}

test("packet store dedupes by hash and observer and returns resolved paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 60_000 });
  try {
    assert.equal(store.record([row(), row({ resolved_path: '["AAAA","BBBB"]' })]), 2);
    assert.equal(store.count(), 1);

    const rows = store.querySince(0);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].resolved_path, ["AAAA", "BBBB"]);
    assert.equal(rows[0].scope_name, "#cz");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("packet store counts distinct packets since a time and exposes the newest row", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 60_000 });
  try {
    store.record([
      row({ hash: "a", observer_id: "o1", observed_at: 1_000 }),
      row({ hash: "a", observer_id: "o2", observed_at: 1_000 }),
      row({ hash: "b", observer_id: "o1", observed_at: 2_000 }),
      row({ hash: "c", observer_id: "o1", observed_at: 500 }),
    ]);
    assert.equal(store.newest(), 2_000);
    assert.equal(store.countDistinctSince(900), 2);
    assert.equal(store.countDistinctSince(0), 3);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("packet store filters by time, orders newest first and honors the limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 60_000 });
  try {
    store.record([
      row({ hash: "a", observed_at: 1_000 }),
      row({ hash: "b", observed_at: 2_000 }),
      row({ hash: "c", observed_at: 3_000 }),
    ]);
    const rows = store.querySince(1_500, 10);
    assert.deepEqual(rows.map((entry) => entry.hash), ["c", "b"]);
    assert.deepEqual(store.querySince(0, 1).map((entry) => entry.hash), ["c"]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("packet store returns every observer for a packet hash", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 60_000 });
  try {
    store.record([
      row({ hash: "abcd", observer_id: "o1", observed_at: 2_000 }),
      row({ hash: "abcd", observer_id: "o2", observed_at: 3_000 }),
      row({ hash: "abce", observer_id: "o3", observed_at: 4_000 }),
    ]);
    const rows = store.queryHash("ABCD");
    assert.deepEqual(rows.map((entry) => entry.observer_id), ["o2", "o1"]);
    assert.deepEqual(store.queryHash("abce").map((entry) => entry.observer_id), ["o3"]);
    assert.equal(store.queryHash("ffff").length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("packet store searches hash prefixes and groups observers", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 60_000 });
  try {
    store.record([
      row({ hash: "ab12cd", observer_id: "o1", observed_at: 1_000 }),
      row({ hash: "ab12cd", observer_id: "o2", observed_at: 2_000 }),
      row({ hash: "ab34ef", observer_id: "o1", observed_at: 3_000 }),
      row({ hash: "cd56aa", observer_id: "o1", observed_at: 4_000 }),
    ]);
    const rows = store.searchHashPrefix("AB12");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hash, "ab12cd");
    assert.equal(rows[0].observed_at, 2_000);
    assert.equal(rows[0].observer_name, "obs");
    assert.deepEqual(store.searchHashPrefix("ab").map((entry) => entry.hash), ["ab34ef", "ab12cd"]);
    assert.equal(store.searchHashPrefix("cd56aa").length, 1);
    assert.deepEqual(store.searchHashPrefix("zz"), []);
    assert.deepEqual(store.searchHashPrefix("a"), []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("packet store prunes expired rows and overflow beyond the cap", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 5_000, maxRows: 2 });
  try {
    store.record([
      row({ hash: "a", observed_at: 1_000 }),
      row({ hash: "b", observed_at: 8_000 }),
      row({ hash: "c", observed_at: 9_000 }),
      row({ hash: "d", observed_at: 9_500 }),
    ]);
    store.prune(10_000);
    assert.equal(store.count(), 2);
    assert.deepEqual(store.querySince(0).map((entry) => entry.hash), ["d", "c"]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("relay stats count only paths with at least two hash bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 60_000 });
  const now = Date.UTC(2026, 10, 1, 12);
  try {
    store.record([
      row({ hash: "2b", observer_id: "o1", observed_at: now - 30 * 60 * 1000, path_hash_bytes: 2, path_json: '["BD75"]', scope_name: "#cz" }),
      row({ hash: "3b", observer_id: "o2", observed_at: now - 20 * 60 * 1000, path_hash_bytes: 3, path_json: '["BD75AA"]', scope_name: "" }),
      row({ hash: "1b", observer_id: "o3", observed_at: now - 10 * 60 * 1000, path_hash_bytes: 1, path_json: '["BD"]', scope_name: "#cz" }),
    ]);
    assert.deepEqual(store.relayStats("BD75", 2, now), {
      hashBytes: 2,
      lastRelayed: now - 20 * 60 * 1000,
      prefix: "BD75",
      relayActive: true,
      relayCount1h: 2,
      relayCount24h: 2,
      unscopedRelay24h: 1,
    });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps a resolved path when a newer unresolved live row arrives", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 60_000 });
  try {
    store.record([row({ resolved_path: '["AAAA","BBBB"]', observed_at: 1_000 })]);
    store.record([row({ resolved_path: "[]", observed_at: 2_000 })]);
    assert.deepEqual(store.querySince(0)[0].resolved_path, ["AAAA", "BBBB"]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("packet store counts distinct adverts per node in a time window", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-packets-"));
  const store = createPacketStore(join(directory, "packets.sqlite"), { retentionMs: 2 * 24 * 60 * 60 * 1000 });
  const keyA = "a".repeat(64);
  const keyB = "b".repeat(64);
  try {
    store.record([
      row({ hash: "a1", observer_id: "o1", observed_at: 10_000, payload_type: 4, decoded_json: JSON.stringify({ pubKey: keyA }) }),
      row({ hash: "a1", observer_id: "o2", observed_at: 10_000, payload_type: 4, decoded_json: JSON.stringify({ pubKey: keyA }) }),
      row({ hash: "a2", observer_id: "o1", observed_at: 20_000, payload_type: 4, decoded_json: JSON.stringify({ publicKey: keyA }) }),
      row({ hash: "b1", observer_id: "o1", observed_at: 30_000, payload_type: 4, decoded_json: JSON.stringify({ public_key: keyB }) }),
      row({ hash: "old", observer_id: "o1", observed_at: 1_000, payload_type: 4, decoded_json: JSON.stringify({ pubKey: keyB }) }),
      row({ hash: "not-advert", observer_id: "o1", observed_at: 30_000, payload_type: 5, decoded_json: JSON.stringify({ pubKey: keyB }) }),
    ]);
    const counts = store.advertCountsSince(5_000);
    assert.equal(counts.get(keyA), 2);
    assert.equal(counts.get(keyB), 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
