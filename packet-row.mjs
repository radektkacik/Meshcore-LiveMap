function rawPathHashBytes(rawHex, routeType) {
  const raw = String(rawHex || "").replace(/\s/g, "");
  const type = Number.isInteger(Number(routeType))
    ? Number(routeType)
    : (Number.parseInt(raw.slice(0, 2), 16) & 0x03);
  const offset = type === 0 || type === 3 ? 5 : 1;
  const pathByte = Number.parseInt(raw.slice(offset * 2, offset * 2 + 2), 16);
  if (!Number.isFinite(pathByte)) return null;
  const size = (pathByte >> 6) + 1;
  return size >= 1 && size <= 3 ? size : null;
}

export function packetToStoreRow(packet, now) {
  const hash = String(packet.hash || "");
  const observerId = String(packet.observer_id || "");
  if (!hash || !observerId) return null;
  const resolved = Array.isArray(packet.resolved_path) ? packet.resolved_path : [];
  let path = [];
  try {
    const parsed = JSON.parse(typeof packet.path_json === "string" ? packet.path_json : "[]");
    if (Array.isArray(parsed)) path = parsed;
  } catch {
    path = [];
  }
  if (!resolved.some(Boolean) && !path.length) return null;
  const observedAt = Date.parse(packet.timestamp || packet.first_seen || "");
  return {
    decoded_json: packet.decoded_json || "",
    hash,
    observer_id: observerId,
    observer_iata: packet.observer_iata || "",
    observer_name: packet.observer_name || "",
    observed_at: Number.isFinite(observedAt) ? observedAt : now,
    path_hash_bytes: rawPathHashBytes(packet.raw_hex, packet.route_type),
    path_json: typeof packet.path_json === "string" ? packet.path_json : JSON.stringify(packet.path_json || []),
    payload_type: Number(packet.payload_type) || 0,
    raw_hex: packet.raw_hex || "",
    resolved_path: JSON.stringify(resolved),
    route_type: Number(packet.route_type) || 0,
    rssi: Number.isFinite(Number(packet.rssi)) ? Number(packet.rssi) : null,
    scope_name: packet.scope_name || null,
    snr: Number.isFinite(Number(packet.snr)) ? Number(packet.snr) : null,
  };
}
