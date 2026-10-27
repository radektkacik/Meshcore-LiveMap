import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNodeInfoStore } from "../node-info.mjs";

test("node info stores one editable public text per node", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "a".repeat(64);
  try {
    const first = store.upsert({
      author: "Petr",
      nodeKey: key,
      text: "Hardware: RAK v2\nBaterie: 10 Ah\nPanel: 20 W",
    }, 1000);
    assert.equal(first.nodeKey, key);
    assert.match(first.text, /RAK v2/);
    assert.equal(first.author, "Petr");
    assert.equal(store.count(), 1);

    const second = store.upsert({
      author: "Jana",
      nodeKey: key,
      text: "Anténa: 5 dBi",
    }, 2000);
    assert.equal(second.author, "Jana");
    assert.equal(second.createdAt, 1000);
    assert.equal(second.updatedAt, 2000);
    assert.equal(store.list(10).length, 1);
    assert.equal(store.get(key).text, "Anténa: 5 dBi");

    assert.equal(store.remove(key), true);
    assert.equal(store.get(key), null);
    assert.equal(store.count(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info rejects invalid node keys and empty text", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  try {
    assert.equal(store.upsert({ nodeKey: "short", text: "test" }), null);
    assert.equal(store.upsert({ nodeKey: "b".repeat(64), text: "   " }), null);
    assert.equal(store.count(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
