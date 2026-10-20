import assert from "node:assert/strict";
import test from "node:test";
import { isRouteVisible, packetPathHashBytes, parsePath } from "../src/route-utils.js";

const BASE = (process.env.REFERENCE_MAP_URL || "https://2b.meshcore.cz/map").replace(/\/$/, "");
const liveSkip = process.env.RUN_REFERENCE_TESTS === "1"
  ? false
  : "set RUN_REFERENCE_TESTS=1 to compare against the live reference map";
const PRIMARY = new Set([2, 4, 5, 8]);
const MAX_PATH = 32;

class ReferenceUnavailable extends Error {}

async function getJson(path) {
  let lastError = "unknown";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${BASE}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 200) return response.json();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new ReferenceUnavailable(`${path}: ${lastError}`);
}

function skipIfUnavailable(t, error) {
  if (error instanceof ReferenceUnavailable) {
    t.skip(`reference unavailable: ${error.message}`);
    return true;
  }
  return false;
}

function validCoords(lat, lon) {
  return Number.isFinite(Number(lat))
    && Number.isFinite(Number(lon))
    && Number(lat) !== 0
    && Number(lon) !== 0;
}

function rawWireHashBytes(packet) {
  const raw = String(packet.raw_hex || "").replace(/\s/g, "");
  const routeType = Number.isInteger(Number(packet.route_type))
    ? Number(packet.route_type)
    : (Number.parseInt(raw.slice(0, 2), 16) & 0x03);
  const offset = routeType === 0 || routeType === 3 ? 5 : 1;
  const pathByte = Number.parseInt(raw.slice(offset * 2, offset * 2 + 2), 16);
  return (pathByte >> 6) + 1;
}

function flattenObservations(data) {
  const observations = [];
  for (const parent of data.packets || []) {
    const list = parent.observations?.length ? parent.observations : [parent];
    for (const observation of list) observations.push({ ...parent, ...observation });
  }
  return observations;
}

function buildVisibleRoutes(nodes, observations, hashBytesFor) {
  const byKey = new Map(nodes.map((node) => [String(node.public_key || "").toUpperCase(), node]));
  const routes = new Map();
  for (const packet of observations) {
    const type = Number(packet.payload_type);
    const path = parsePath(packet);
    if (!path.length || path.length > MAX_PATH) continue;
    if (!PRIMARY.has(type)) continue;
    const hashBytes = hashBytesFor(packet, path);
    if (!isRouteVisible(type, hashBytes, { showOneByteRoutes: false, showOtherPacketTypes: false })) continue;
    const points = [];
    for (const hop of packet.resolved_path || []) {
      const key = String(hop || "").toUpperCase();
      const node = byKey.get(key);
      if (key && node && validCoords(node.lat, node.lon)) points.push(key);
    }
    if (points.length < 2) continue;
    routes.set(`${packet.hash}:${packet.observer_id}`, points);
  }
  return routes;
}

test("reference: our hash-size classification matches the raw wire header", { skip: liveSkip }, async (t) => {
  let data;
  try {
    data = await getJson("/api/packets?limit=8&expand=observations");
  } catch (error) {
    if (skipIfUnavailable(t, error)) return;
    throw error;
  }
  const observations = flattenObservations(data);
  if (observations.length === 0) {
    t.skip("reference returned no observations right now");
    return;
  }

  let nonTrace = 0;
  for (const packet of observations) {
    const path = parsePath(packet);
    if (!path.length) continue;
    const ours = packetPathHashBytes(packet, path);
    if (Number(packet.payload_type) === 9) {
      const tokenSize = Math.min(...path.map((hop) => Math.ceil(String(hop).length / 2)));
      assert.equal(ours, tokenSize, `TRACE ${packet.hash} misclassified`);
    } else {
      assert.equal(ours, rawWireHashBytes(packet), `packet ${packet.hash} misclassified`);
      nonTrace += 1;
    }
  }
  assert.ok(nonTrace > 50, `expected many ordinary paths, got ${nonTrace}`);
});

test("reference: our visible 2B+ routes overlap the reference routes", { skip: liveSkip }, async (t) => {
  let nodesData;
  let packetsData;
  try {
    [nodesData, packetsData] = await Promise.all([
      getJson("/api/nodes?limit=2000"),
      getJson("/api/packets?limit=8&expand=observations"),
    ]);
  } catch (error) {
    if (skipIfUnavailable(t, error)) return;
    throw error;
  }
  const nodes = nodesData.nodes || [];
  const observations = flattenObservations(packetsData);

  const referenceRoutes = buildVisibleRoutes(nodes, observations, (packet) => rawWireHashBytes(packet));
  const ourRoutes = buildVisibleRoutes(nodes, observations, (packet, path) => packetPathHashBytes(packet, path));

  if (referenceRoutes.size < 5) {
    t.skip(`reference produced too few routes right now: ${referenceRoutes.size}`);
    return;
  }

  let shared = 0;
  let hopOverlap = 0;
  let hopTotal = 0;
  for (const [id, referenceHops] of referenceRoutes) {
    const ours = ourRoutes.get(id);
    if (!ours) continue;
    shared += 1;
    const oursSet = new Set(ours);
    for (const hop of referenceHops) {
      hopTotal += 1;
      if (oursSet.has(hop)) hopOverlap += 1;
    }
  }

  const routeOverlap = shared / referenceRoutes.size;
  const hopOverlapRatio = hopTotal ? hopOverlap / hopTotal : 0;
  console.log(`reference routes=${referenceRoutes.size} ours=${ourRoutes.size} shared=${shared} hopOverlap=${hopOverlapRatio.toFixed(2)}`);
  assert.ok(routeOverlap >= 0.9, `route overlap too low: ${routeOverlap.toFixed(2)}`);
  assert.ok(hopOverlapRatio >= 0.9, `hop overlap too low: ${hopOverlapRatio.toFixed(2)}`);
});

test("reference: our resolve-hops agrees with the reference resolved_path", { skip: liveSkip }, async (t) => {
  let data;
  try {
    data = await getJson("/api/packets?limit=8&expand=observations");
  } catch (error) {
    if (skipIfUnavailable(t, error)) return;
    throw error;
  }
  const observations = flattenObservations(data);

  const prefixToReference = new Map();
  for (const packet of observations) {
    const path = parsePath(packet);
    const resolved = packet.resolved_path || [];
    for (let index = 0; index < path.length && index < resolved.length; index += 1) {
      const reference = String(resolved[index] || "").toUpperCase();
      if (!reference) continue;
      if (!prefixToReference.has(path[index])) prefixToReference.set(path[index], reference);
    }
  }
  const prefixes = [...prefixToReference.keys()].slice(0, 80);
  if (prefixes.length < 10) {
    t.skip(`not enough reference prefixes right now: ${prefixes.length}`);
    return;
  }

  let ratio = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let resolved;
    try {
      resolved = await getJson(`/api/resolve-hops?hops=${encodeURIComponent(prefixes.join(","))}`);
    } catch (error) {
      if (skipIfUnavailable(t, error)) return;
      throw error;
    }
    let matched = 0;
    for (const prefix of prefixes) {
      const entry = resolved.resolved?.[prefix];
      const expected = prefixToReference.get(prefix);
      const pubkey = String(entry?.pubkey || "").toUpperCase();
      const candidates = (entry?.candidates || [])
        .map((candidate) => String(candidate.pubkey || candidate.public_key || "").toUpperCase());
      if (pubkey === expected || candidates.includes(expected)) matched += 1;
    }
    ratio = matched / prefixes.length;
    console.log(`resolver prefixes=${prefixes.length} matched=${matched} ratio=${ratio.toFixed(2)} attempt=${attempt + 1}`);
    if (ratio >= 0.8) break;
  }
  assert.ok(ratio >= 0.8, `resolver agreement too low: ${ratio.toFixed(2)}`);
});
