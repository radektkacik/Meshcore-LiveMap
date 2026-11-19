import test from "node:test";
import assert from "node:assert/strict";
import { getPreferredRepeater, setPreferredRepeater } from "../src/trace-preferred.js";

test("preferred repeaters are stored per companion and can be forgotten", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const a = "a".repeat(64), b = "b".repeat(64), rpt = "c".repeat(64);
  assert.equal(setPreferredRepeater(storage, a, rpt), true);
  assert.equal(getPreferredRepeater(storage, a), rpt);
  assert.equal(getPreferredRepeater(storage, b), null);
  assert.equal(setPreferredRepeater(storage, a, null), true);
  assert.equal(getPreferredRepeater(storage, a), null);
});

test("invalid keys and unavailable storage fail safely", () => {
  const broken = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
  assert.equal(getPreferredRepeater(broken, "a".repeat(64)), null);
  assert.equal(setPreferredRepeater(broken, "a".repeat(64), "b".repeat(64)), false);
  assert.equal(setPreferredRepeater(broken, "bad", "b".repeat(64)), false);
});
