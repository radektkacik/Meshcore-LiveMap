import assert from "node:assert/strict";
import test from "node:test";
import { buildTracePath, MAX_TRACE_HOPS, TRACE_HASH_BYTES, moveTraceHop } from "../src/trace-path.js";

const key = (prefix, tail = "0") => `${prefix}${tail.repeat(64 - prefix.length)}`;

test("moving a hop uses its position, including repeated nodes, without mutating the route", () => {
  const path = ["a", "b", "a", "c"];
  assert.deepEqual(moveTraceHop(path, 2, 1), ["a", "a", "b", "c"]);
  assert.deepEqual(moveTraceHop(path, 0, 1), ["b", "a", "a", "c"]);
  assert.deepEqual(moveTraceHop(path, 0, -1), path);
  assert.deepEqual(path, ["a", "b", "a", "c"]);
});

test("trace paths encode unique two-byte prefixes in selected hop order", () => {
  assert.equal(TRACE_HASH_BYTES, 2);
  const first = key("1234");
  const second = key("abcd");
  assert.deepEqual([...buildTracePath([first, second], [{ public_key: first, role: "repeater" }, { public_key: second, role: "repeater" }])], [0x12, 0x34, 0xab, 0xcd]);
});

test("trace paths reject known ambiguous prefixes", () => {
  const first = key("1234", "0");
  const collision = key("1234", "1");
  assert.throws(() => buildTracePath([first], [{ public_key: first, role: "repeater" }, { public_key: collision, role: "repeater" }]), /ambiguous-prefix/);
});

test("trace paths preserve repeated repeaters on the return leg", () => {
  const first = key("1234");
  const second = key("abcd");
  const nodes = [first, second].map((public_key) => ({ public_key, role: "repeater" }));
  assert.deepEqual([...buildTracePath([first, second, first], nodes)], [0x12, 0x34, 0xab, 0xcd, 0x12, 0x34]);
});

test("trace paths reject empty, malformed, and overlong routes", () => {
  const valid = key("cafe");
  assert.throws(() => buildTracePath([], []), /empty/);
  assert.throws(() => buildTracePath(["not-a-key"], []), /invalid-key/);
  assert.throws(() => buildTracePath(Array(MAX_TRACE_HOPS + 1).fill(valid), []), /too-long/);
});
