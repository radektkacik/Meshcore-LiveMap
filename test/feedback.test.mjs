import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFeedbackStore } from "../feedback.mjs";

test("feedback store exposes only public, non-hidden entries without contact", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-feedback-"));
  const store = createFeedbackStore(join(directory, "feedback.sqlite"));
  try {
    store.record({ message: "Soukromá", contact: "tajne@x.cz" });
    const publicId = store.record({ message: "Veřejná", name: "Petr", isPublic: true, contact: "petr@x.cz" });

    const entries = store.listPublic(10);
    assert.deepEqual(entries.map((entry) => entry.message), ["Veřejná"]);
    assert.equal(entries[0].name, "Petr");
    assert.equal(entries[0].contact, undefined);
    assert.equal(entries[0].ip_hash, undefined);

    store.setHidden(publicId, true);
    assert.equal(store.listPublic(10).length, 0);
    assert.equal(store.list(10)[0].hidden, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("feedback store records entries and lists the newest first", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-feedback-"));
  const store = createFeedbackStore(join(directory, "feedback.sqlite"));
  try {
    store.record({ category: "bug", message: "První", contact: "a@b.cz" }, 1_000);
    store.record({ category: "idea", message: "Druhá", ipHash: "abc" }, 2_000);

    assert.equal(store.count(), 2);
    const entries = store.list(10);
    assert.deepEqual(entries.map((entry) => entry.message), ["Druhá", "První"]);
    assert.equal(entries[1].contact, "a@b.cz");
    assert.equal(entries[0].category, "idea");
    assert.deepEqual(store.list(1).map((entry) => entry.message), ["Druhá"]);
    assert.equal(store.countSince(1_500), 1);
    assert.equal(store.countSince(0), 2);

    store.pruneTo(1);
    assert.equal(store.count(), 1);
    assert.deepEqual(store.list(5).map((entry) => entry.message), ["Druhá"]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
