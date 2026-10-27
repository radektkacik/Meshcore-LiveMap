import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNodeInfoStore } from "../node-info.mjs";

test("node info publishes the first text and requires approval for changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "a".repeat(64);
  try {
    const first = store.submit({
      author: "Petr",
      nodeKey: key,
      text: "Hardware: RAK v2\nBaterie: 10 Ah\nPanel: 20 W",
    }, 1000);
    assert.equal(first.status, "published");
    assert.equal(first.info.nodeKey, key);
    assert.match(first.info.text, /RAK v2/);
    assert.equal(first.info.author, "Petr");
    assert.equal(store.count(), 1);
    assert.equal(store.pendingCount(), 0);

    const second = store.submit({
      author: "Jana",
      nodeKey: key,
      text: "Anténa: 5 dBi",
    }, 2000);
    assert.equal(second.status, "pending");
    assert.equal(second.info.author, "Jana");
    assert.match(second.info.currentText, /RAK v2/);
    assert.equal(store.get(key).text, "Hardware: RAK v2\nBaterie: 10 Ah\nPanel: 20 W");
    assert.equal(store.pendingCount(), 1);
    assert.equal(store.listPending(10).length, 1);

    const approved = store.approve(key, 3000);
    assert.equal(approved.text, "Anténa: 5 dBi");
    assert.equal(approved.createdAt, 1000);
    assert.equal(approved.updatedAt, 3000);
    assert.equal(store.pendingCount(), 0);
    assert.equal(store.get(key).text, "Anténa: 5 dBi");

    assert.equal(store.remove(key), true);
    assert.equal(store.get(key), null);
    assert.equal(store.pendingCount(), 0);
    assert.equal(store.count(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info can reject a pending change and keeps the published text", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "b".repeat(64);
  try {
    store.submit({ nodeKey: key, text: "Původní text" }, 1000);
    store.submit({ nodeKey: key, text: "Navrhovaná změna" }, 2000);
    assert.equal(store.reject(key), true);
    assert.equal(store.get(key).text, "Původní text");
    assert.equal(store.pendingCount(), 0);
    assert.equal(store.getPending(key), null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info rejects invalid node keys and empty text", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  try {
    assert.equal(store.submit({ nodeKey: "short", text: "test" }), null);
    assert.equal(store.submit({ nodeKey: "c".repeat(64), text: "   " }), null);
    assert.equal(store.count(), 0);
    assert.equal(store.pendingCount(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
