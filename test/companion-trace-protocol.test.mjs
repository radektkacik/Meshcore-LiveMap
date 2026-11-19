import assert from "node:assert/strict";
import test from "node:test";
import Constants from "@liamcottle/meshcore.js/src/constants.js";
import { encodeTwoByteTraceCommand, installTwoByteTraceSupport, measuredTraceSnrs, parseTwoByteTracePush, partialTraceSnrs, traceSnrTone } from "../src/companion-trace-protocol.js";

test("partial TRACE observations require matching tag, path, flags and auth", () => {
  const expected = Uint8Array.from([0x12, 0x34, 0xab, 0xcd, 0x12, 0x34]);
  const command = encodeTwoByteTraceCommand(0x12345678, 0, expected);
  const raw = Uint8Array.from([0x26, 2, 20, 248, ...command.slice(1)]);
  assert.deepEqual(partialTraceSnrs(raw, 0x12345678, expected), [5, -2]);
  assert.equal(partialTraceSnrs(raw, 0x12345679, expected), null);
  assert.equal(partialTraceSnrs(raw, 0x12345678, Uint8Array.from([1, 2, 3, 4, 5, 6])), null);
  assert.equal(partialTraceSnrs(raw.slice(0, -1), 0x12345678, expected), null);
  const changed = Uint8Array.from(raw); changed[12] = 0;
  assert.equal(partialTraceSnrs(changed, 0x12345678, expected), null);
});

test("trace SNR colors match map thresholds", () => {
  assert.equal(traceSnrTone(5), "good");
  assert.equal(traceSnrTone(0), "fair");
  assert.equal(traceSnrTone(-0.25), "bad");
});

test("measured hop SNRs require the exact expected path and decode signed values", () => {
  const path = Uint8Array.from([0x12, 0x34, 0x12, 0x34]);
  assert.deepEqual(measuredTraceSnrs({ pathHashes: path, pathSnrs: Uint8Array.from([8, 248]) }, path), [2, -2]);
  assert.throws(() => measuredTraceSnrs({ pathHashes: Uint8Array.from([0x12, 0x34]), pathSnrs: [8] }, path), /mismatch/);
  assert.throws(() => measuredTraceSnrs({ pathHashes: path, pathSnrs: [8] }, path), /mismatch/);
  assert.throws(() => measuredTraceSnrs({ pathHashes: [0x12, 0x35, 0x12, 0x34], pathSnrs: [8, 8] }, path), /mismatch/);
});

test("two-byte trace command encodes command, little-endian tag/auth, flag and path", () => {
  const path = Uint8Array.from([0x12, 0x34, 0xab, 0xcd]);
  const frame = encodeTwoByteTraceCommand(0x12345678, 0x90abcdef, path);
  assert.equal(frame[0], Constants.CommandCodes.SendTracePath);
  const view = new DataView(frame.buffer);
  assert.equal(view.getUint32(1, true), 0x12345678);
  assert.equal(view.getUint32(5, true), 0x90abcdef);
  assert.equal(frame[9], 1);
  assert.deepEqual([...frame.slice(10)], [...path]);
});

test("trace push parser reads two-byte hashes and one SNR per hop", () => {
  const bytes = Uint8Array.from([
    0, 4, 1,
    0x78, 0x56, 0x34, 0x12,
    0xef, 0xcd, 0xab, 0x90,
    0x12, 0x34, 0xab, 0xcd,
    8, 12,
    20,
  ]);
  let offset = 0;
  const reader = {
    readByte: () => bytes[offset++],
    readUInt8: () => bytes[offset++],
    readUInt32LE: () => { const value = new DataView(bytes.buffer).getUint32(offset, true); offset += 4; return value; },
    readBytes: (length) => { const value = bytes.slice(offset, offset + length); offset += length; return value; },
    readInt8: () => { const value = new DataView(bytes.buffer).getInt8(offset); offset += 1; return value; },
  };
  const result = parseTwoByteTracePush(reader);
  assert.equal(result.tag, 0x12345678);
  assert.equal(result.authCode, 0x90abcdef);
  assert.deepEqual([...result.pathHashes], [0x12, 0x34, 0xab, 0xcd]);
  assert.deepEqual([...result.pathSnrs], [8, 12]);
  assert.equal(result.lastSnr, 5);
  assert.equal(offset, bytes.length);
});

test("companion adapter uses the two-byte trace encoder and decoder", async () => {
  const sent = [];
  const emitted = [];
  const connection = {
    async sendToRadioFrame(frame) { sent.push(frame); },
    emit(name, value) { emitted.push([name, value]); },
  };
  installTwoByteTraceSupport(connection);
  await connection.sendCommandSendTracePath(7, 0, Uint8Array.from([0xab, 0xcd]));
  assert.equal(new DataView(sent[0].buffer).getUint32(1, true), 7);
  assert.equal(sent[0][9], 1);
  connection.onTraceDataPush({
    readByte: () => 0,
    readUInt8: (() => { const values = [2, 1]; return () => values.shift(); })(),
    readUInt32LE: () => 7,
    readBytes: (length) => Uint8Array.from({ length }, (_, index) => index + 1),
    readInt8: () => 4,
  });
  assert.equal(emitted[0][0], Constants.PushCodes.TraceData);
  assert.deepEqual([...emitted[0][1].pathSnrs], [1]);
});
