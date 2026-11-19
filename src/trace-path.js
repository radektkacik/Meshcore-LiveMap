export const TRACE_HASH_BYTES = 2;
export const MAX_TRACE_HOPS = 16;

export function moveTraceHop(path, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= path.length || to >= path.length) return [...path];
  const result = [...path];
  const [hop] = result.splice(from, 1);
  result.splice(to, 0, hop);
  return result;
}

export function buildTracePath(keys, nodes) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error("empty");
  if (keys.length > MAX_TRACE_HOPS) throw new Error("too-long");
  const normalized = keys.map((key) => String(key || "").toLowerCase());
  if (normalized.some((key) => !/^[0-9a-f]{64}$/.test(key))) throw new Error("invalid-key");
  const prefixes = normalized.map((key) => key.slice(0, TRACE_HASH_BYTES * 2));
  const knownKeys = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => node?.role === "repeater")
    .map((node) => String(node?.public_key || "").toLowerCase())
    .filter((key) => /^[0-9a-f]{64}$/.test(key));
  if (prefixes.some((prefix) => knownKeys.filter((key) => key.startsWith(prefix)).length > 1)) {
    throw new Error("ambiguous-prefix");
  }
  return Uint8Array.from(prefixes.flatMap((prefix) => [
    Number.parseInt(prefix.slice(0, 2), 16),
    Number.parseInt(prefix.slice(2, 4), 16),
  ]));
}
