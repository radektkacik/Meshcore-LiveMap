import { appendReturnTracePath, buildTracePath, MAX_TRACE_HOPS } from "./trace-path.js";

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
      && Number.isFinite(Number(node?.lat)) && Number.isFinite(Number(node?.lon))
      && node?.lat != null && node?.lon != null;
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
