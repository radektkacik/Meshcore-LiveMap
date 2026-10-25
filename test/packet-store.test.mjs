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
