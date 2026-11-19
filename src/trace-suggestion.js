import { appendReturnTracePath, buildTracePath, MAX_TRACE_HOPS } from "./trace-path.js";
import { validCoords } from "./node-model.js";

export function suggestReplacement(path, index, neighborIndex, nodes, now = Date.now()) {
  if (!Array.isArray(path) || !Number.isInteger(index) || index <= 0 || index >= path.length - 1) return null;
  const previous = String(path[index - 1]).toUpperCase();
  const next = String(path[index + 1]).toUpperCase();
  const current = String(path[index]).toUpperCase();
  const byKey = new Map(nodes.filter((node) => node?.role === "repeater")
    .map((node) => [String(node.public_key || "").toUpperCase(), node]));
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  const candidates = [];
  for (const [candidateKey, first] of neighborIndex.get(previous) || []) {
    const key = String(candidateKey).toUpperCase();
    const second = neighborIndex.get(key)?.get(next);
    const node = byKey.get(key);
    const firstAt = Number(first?.lastAt);
    const secondAt = Number(second?.lastAt);
    if (!node || key === current || key === previous || key === next || !validCoords(node.lat, node.lon)
        || !Number.isFinite(firstAt) || !Number.isFinite(secondAt)
        || firstAt <= 0 || secondAt <= 0 || firstAt > now || secondAt > now
        || now - firstAt > maxAge || now - secondAt > maxAge) continue;
    const proposed = [...path];
    proposed[index] = key.toLowerCase();
    try { buildTracePath(proposed, nodes); } catch { continue; }
    candidates.push({ key: key.toLowerCase(), oldest: Math.min(firstAt, secondAt), count: (Number(first.count) || 0) + (Number(second.count) || 0) });
  }
  candidates.sort((a, b) => b.oldest - a.oldest || b.count - a.count || a.key.localeCompare(b.key));
  return candidates[0] || null;
}

// The neighbor index is inferred from observed paths and is not directional proof.
export function suggestTracePath(start, destination, neighborIndex, nodes, now = Date.now(), excluded = new Set()) {
  const byKey = new Map(nodes.filter((node) => node?.role === "repeater")
    .map((node) => [String(node.public_key || "").toUpperCase(), node]));
  const prefixes = new Map();
  for (const key of byKey.keys()) {
    const prefix = key.slice(0, 4);
    prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
  }
  const usable = (key) => {
    const node = byKey.get(key);
    return /^[0-9A-F]{64}$/.test(key) && prefixes.get(key.slice(0, 4)) === 1
      && validCoords(node?.lat, node?.lon);
  };
  const from = String(start || "").toUpperCase();
  const to = String(destination || "").toUpperCase();
  if (!usable(from) || !usable(to) || from === to) return null;
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  const maxOutbound = Math.floor((MAX_TRACE_HOPS + 1) / 2);
  const queue = [{ key: from, path: [from], cost: 0, oldest: now }];
  let examined = 0;
  while (queue.length && examined < 5000) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    examined += 1;
    if (current.key === to) {
      const path = appendReturnTracePath(current.path.map((key) => key.toLowerCase()));
      if (excluded.has(path.join(","))) continue;
      buildTracePath(path, nodes);
      return { path, oldest: current.oldest };
    }
    if (current.path.length >= maxOutbound) continue;
    for (const [neighbor, info] of neighborIndex.get(current.key) || []) {
      const key = String(neighbor).toUpperCase();
      const at = Number(info?.lastAt);
      const age = now - at;
      if (!usable(key) || current.path.includes(key) || !Number.isFinite(at) || at <= 0 || age < 0 || age > maxAge) continue;
      const cost = current.cost + 1 + age / maxAge;
      queue.push({ key, path: [...current.path, key], cost, oldest: Math.min(current.oldest, at) });
    }
    if (queue.length > 5000) {
      queue.sort((a, b) => a.cost - b.cost);
      queue.length = 5000;
    }
  }
  return null;
}
