export const PRIMARY_PACKET_TYPES = new Set([2, 4, 5, 9]);

export function parsePath(packet) {
  try {
    const path = JSON.parse(packet.path_json || "[]");
    return Array.isArray(path) ? path.map((hop) => String(hop).toUpperCase()) : [];
  } catch {
    return [];
  }
}

export function pathHashBytes(path) {
  if (!path.length) return 0;
  return Math.min(...path.map((hop) => Math.ceil(String(hop).length / 2)));
}

export function packetPathHashBytes(packet, path = parsePath(packet)) {
  const explicit = Number(packet.path_hash_bytes);
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= 3) return explicit;

  if (Number(packet.payload_type) !== 9) {
    const raw = String(packet.raw_hex || "").replaceAll(/\s/g, "");
    const routeType = Number.isInteger(Number(packet.route_type))
      ? Number(packet.route_type)
      : (Number.parseInt(raw.slice(0, 2), 16) & 0x03);
    const offset = routeType === 0 || routeType === 3 ? 5 : 1;
    const pathByte = Number.parseInt(raw.slice(offset * 2, offset * 2 + 2), 16);
    const hashBytes = (pathByte >> 6) + 1;
    if (Number.isInteger(pathByte) && hashBytes >= 1 && hashBytes <= 3) return hashBytes;
  }

  return pathHashBytes(path);
}

export function isPrimaryPacketType(packetType) {
  return PRIMARY_PACKET_TYPES.has(Number(packetType));
}

export function liveRouteCreatedAt(packetTime, now, retentionMs) {
  const time = Number(packetTime);
  const createdAt = Number.isFinite(time) ? Math.min(time, now) : now;
  return now - createdAt < retentionMs ? createdAt : null;
}

export function archiveQuery(windowMs, now = Date.now()) {
  const limit = windowMs <= 5 * 60_000 ? 600 : windowMs <= 60 * 60_000 ? 2500 : 8000;
  return `since=${Math.floor(now - windowMs)}&limit=${limit}`;
}

export function isRouteVisible(packetType, hashBytes, filters) {
  if (Number(packetType) === 8) return false;
  if (!filters.showOtherPacketTypes && !isPrimaryPacketType(packetType)) return false;
  if (filters.allowedHashBytes) return filters.allowedHashBytes.has(Number(hashBytes));
  if (!filters.showOneByteRoutes && hashBytes < 2) return false;
  return true;
}
