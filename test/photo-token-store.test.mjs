import assert from "node:assert/strict";
import test from "node:test";
import { createPhotoTokenStore } from "../src/photo-token-store.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("photo token store remembers, reads and forgets owner tokens", () => {
  const store = createPhotoTokenStore(memoryStorage());
  assert.equal(store.remember("photo-1", "secret", { node: { public_key: "a".repeat(64) }, photo: { id: "photo-1", createdAt: 1 } }), true);
  assert.equal(store.get("photo-1"), "secret");
  assert.equal(store.get("missing"), "");
  store.forget("photo-1");
  assert.equal(store.get("photo-1"), "");
});

test("photo token store lists uploaded photos newest first", () => {
  const store = createPhotoTokenStore(memoryStorage());
  store.remember("older", "a", {
    node: { public_key: "a".repeat(64) },
    photo: { createdAt: 10, id: "older" },
  });
  store.remember("newer", "b", {
    node: { public_key: "b".repeat(64) },
    photo: { createdAt: 20, id: "newer" },
  });
  assert.deepEqual(store.uploads().map((entry) => entry.photo.id), ["newer", "older"]);
});

test("photo token store tolerates invalid JSON and storage failures", () => {
  const broken = createPhotoTokenStore({
    getItem: () => "{not json",
    setItem: () => {
      throw new Error("quota");
    },
  });
  assert.equal(broken.get("missing"), "");
  assert.equal(broken.remember("photo", "token"), false);
  assert.deepEqual(broken.uploads(), []);
});
