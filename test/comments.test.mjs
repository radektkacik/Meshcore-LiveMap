import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommentStore } from "../comments.mjs";

test("comment store creates, lists and removes node comments", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-comments-"));
  const store = createCommentStore(join(directory, "comments.sqlite"));
  const nodeKey = "a".repeat(64);
  try {
    const first = store.create({ nodeKey, text: "První komentář", author: "Petr" }, 1000);
    const second = store.create({ nodeKey, text: "Druhý komentář" }, 2000);
    assert.equal(first.author, "Petr");
    assert.equal(second.author, "");
    assert.equal(store.count(), 2);
    assert.deepEqual(store.list(nodeKey).map((comment) => comment.text), ["Druhý komentář", "První komentář"]);
    assert.equal(store.remove(first.id), true);
    assert.equal(store.count(), 1);
    assert.equal(store.remove(first.id), false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("comment store validates node key and text length", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-comments-"));
  const store = createCommentStore(join(directory, "comments.sqlite"));
  try {
    assert.equal(store.create({ nodeKey: "short", text: "Text" }), null);
    assert.equal(store.create({ nodeKey: "b".repeat(64), text: "x" }), null);
    assert.equal(store.create({ nodeKey: "b".repeat(64), text: "x".repeat(501) }), null);
    assert.ok(store.create({ nodeKey: "b".repeat(64), text: "x".repeat(500) }));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("comment store prunes old rows over the limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-comments-"));
  const store = createCommentStore(join(directory, "comments.sqlite"));
  const nodeKey = "c".repeat(64);
  try {
    for (let index = 0; index < 5; index += 1) {
      store.create({ nodeKey, text: `Komentář ${index}` }, 1000 + index);
    }
    assert.equal(store.pruneTo(3), 2);
    assert.equal(store.count(), 3);
    assert.deepEqual(store.list(nodeKey).map((comment) => comment.text), ["Komentář 4", "Komentář 3", "Komentář 2"]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
