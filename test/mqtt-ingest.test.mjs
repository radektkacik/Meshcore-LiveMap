import assert from "node:assert/strict";
import test from "node:test";
import { packetToStoreRow } from "../packet-row.mjs";
import { parseMqttPacket } from "../mqtt-ingest.mjs";

const raw = "18400700aabb";
const message = Buffer.from(JSON.stringify({ type: "PACKET", raw, hash: "ABCDEF", origin: "OK1TEST", RSSI: "-90", SNR: "5.5" }));
const topic = "meshcore/PRG/OK1TEST/packets";

test("MQTT packet parsing keeps the observer and route metadata", () => {
  const packet = parseMqttPacket(topic, message);
  assert.ok(packet);
  assert.equal(packet.hash, "abcdef");
  assert.equal(packet.observer_iata, "PRG");
  assert.equal(packet.observer_id, "OK1TEST");
  assert.equal(packet.observer_name, "OK1TEST");
  assert.equal(packet.rssi, -90);
  assert.equal(packet.snr, 5.5);
  assert.equal(JSON.parse(packet.path_json).length, 0);
});

test("MQTT packet parsing rejects non-packet messages and invalid raw data", () => {
  assert.equal(parseMqttPacket(topic, Buffer.from(JSON.stringify({ type: "STATUS" }))), null);
  assert.equal(parseMqttPacket(topic, Buffer.from(JSON.stringify({ type: "PACKET", raw: "zz" }))), null);
});

test("packet rows fall back to receive time and reject unusable packets", () => {
  const now = 1_790_000_000_000;
  const row = packetToStoreRow({
    hash: "abc",
    observer_id: "obs",
    first_seen: "not-a-date",
    resolved_path: ["ABCD"],
    path_json: "[]",
    raw_hex: raw,
    route_type: 0,
  }, now);
  assert.equal(row.observed_at, now);
  assert.equal(row.resolved_path, '["ABCD"]');
  assert.equal(packetToStoreRow({ hash: "abc", observer_id: "obs", resolved_path: [], path_json: "[]" }, now), null);
  assert.equal(packetToStoreRow({ observer_id: "obs", resolved_path: ["ABCD"] }, now), null);
});
