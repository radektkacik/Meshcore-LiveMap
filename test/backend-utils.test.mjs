import assert from "node:assert/strict";
import test from "node:test";
import { decodedPacketHashBytes, decodedPacketPath, TimeBoundRingBuffer } from "../backend-utils.mjs";

test("time-bound ring buffer retains entries within its time window", () => {
  const buffer = new TimeBoundRingBuffer({ capacity: 5, maxAgeMs: 120_000 });
  buffer.add("old", 1_000);
  buffer.add("boundary", 2_000);
  buffer.add("new", 122_000);

  assert.deepEqual(buffer.values(122_000), ["boundary", "new"]);
});

test("time-bound ring buffer evicts the oldest entry at its count limit", () => {
  const buffer = new TimeBoundRingBuffer({ capacity: 3, maxAgeMs: 120_000 });
  buffer.add("one", 1);
  buffer.add("two", 2);
  buffer.add("three", 3);
  buffer.add("four", 4);

  assert.deepEqual(buffer.values(4), ["two", "three", "four"]);
});

test("packet path falls back to the header when a PATH payload has no decoded path", () => {
  const decoded = {
    routeType: 1,
    path: ["AAAA", "BBBB", "CCCC"],
    payload: { decoded: { type: 8, pathHashes: [] } },
  };
  assert.deepEqual(decodedPacketPath(decoded), decoded.path);
  assert.deepEqual(decodedPacketPath({
    ...decoded,
    payload: { decoded: { pathHashes: ["1111", "2222"] } },
  }), ["1111", "2222"]);
});

test("trace packets never fall back to the SNR header as a route", () => {
  const decoded = {
    payloadType: 9,
    routeType: 1,
    path: ["30", "04", "E6"],
    payload: { decoded: { type: 9, pathHashes: [] } },
  };
  assert.deepEqual(decodedPacketPath(decoded), []);
  assert.deepEqual(decodedPacketPath({
    ...decoded,
    payload: { decoded: { type: 9, pathHashes: ["B317", "5300"] } },
  }), ["B317", "5300"]);
});

test("packet hash size uses the header except for TRACE payload paths", () => {
  assert.equal(decodedPacketHashBytes({ payloadType: 5, pathHashSize: 2 }), 2);
  assert.equal(decodedPacketHashBytes({
    payloadType: 9,
    pathHashSize: 1,
    payload: { decoded: { pathHashSize: 3 } },
  }), 3);
  assert.equal(decodedPacketHashBytes({ payloadType: 5, pathHashSize: 4 }), 0);
});
