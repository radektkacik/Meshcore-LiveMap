import { haversineKm } from "./los.js";

export const PRIMARY_PACKET_TYPES = new Set([2, 4, 5, 9]);
export const DEFAULT_MAX_HOP_KM = 170;
export const MULTI_BYTE_MAX_HOP_KM = 200;

export function maxRouteHopKm(hashBytes) {
  return Number(hashBytes) >= 2 ? MULTI_BYTE_MAX_HOP_KM : DEFAULT_MAX_HOP_KM;
}

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
  const limit = windowMs <= 5 * 60_000 ? 600 : windowMs <= 60 * 60_000 ? 2500 : 20000;
  return `since=${Math.floor(now - windowMs)}&limit=${limit}`;
}

export function isRouteVisible(packetType, hashBytes, filters) {
  if (Number(packetType) === 8) return false;
  if (Number(packetType) === 9) return Number(hashBytes) >= 1;
  if (!filters.showOtherPacketTypes && !isPrimaryPacketType(packetType)) return false;
  if (filters.allowedHashBytes) return filters.allowedHashBytes.has(Number(hashBytes));
  if (!filters.showOneByteRoutes && hashBytes < 2) return false;
  return true;
}

export function resolveCandidateChain(candidateSets, { maxHopKm = 150, start = null, end = null } = {}) {
  const sets = candidateSets.map((list) => (Array.isArray(list) ? list : []).filter((candidate) => (
    candidate && Number.isFinite(Number(candidate.lat)) && Number.isFinite(Number(candidate.lon))
  )));
  if (!sets.length || sets.some((list) => !list.length)) return null;

  let costs = sets[0].map((candidate) => {
    if (!start) return 0;
    const distance = haversineKm(start, candidate);
    return distance <= maxHopKm ? distance : Infinity;
  });
  const parents = [sets[0].map(() => -1)];

  for (let index = 1; index < sets.length; index += 1) {
    const nextCosts = sets[index].map(() => Infinity);
    const nextParents = sets[index].map(() => -1);
    for (let current = 0; current < sets[index].length; current += 1) {
      const candidate = sets[index][current];
      for (let previous = 0; previous < sets[index - 1].length; previous += 1) {
        if (!Number.isFinite(costs[previous])) continue;
        const distance = haversineKm(sets[index - 1][previous], candidate);
        if (distance > maxHopKm) continue;
        const total = costs[previous] + distance;
        if (total < nextCosts[current]) {
          nextCosts[current] = total;
          nextParents[current] = previous;
        }
      }
    }
    costs = nextCosts;
    parents.push(nextParents);
  }

  let best = -1;
  let bestCost = Infinity;
  for (let index = 0; index < sets.at(-1).length; index += 1) {
    if (!Number.isFinite(costs[index])) continue;
    let total = costs[index];
    if (end) {
      const distance = haversineKm(sets.at(-1)[index], end);
      if (distance > maxHopKm) continue;
      total += distance;
    }
    if (total < bestCost) {
      best = index;
      bestCost = total;
    }
  }
  if (best < 0) return null;

  const chain = new Array(sets.length);
  let current = best;
  for (let index = sets.length - 1; index >= 0; index -= 1) {
    chain[index] = sets[index][current];
    current = parents[index][current];
  }
  return chain;
}
