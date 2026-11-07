import { parseSearchQuery } from "./search-query.js";

export function validCoords(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
}

export function nodeMetric(node, field) {
  const longTerm = node[`long_term_${field}`];
  return longTerm == null ? node[field] : longTerm;
}

export function nodeLastActivity(node) {
  const timestamps = [node.last_seen, node.last_heard]
    .map((value) => Date.parse(value || 0))
    .filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : 0;
}

export function isNodeActive(node, now, activeMs) {
  return now - nodeLastActivity(node) < activeMs;
}

export function isNewNode(node, now, newMs = 24 * 60 * 60 * 1000) {
  const firstSeen = Date.parse(node.first_seen || 0);
  const age = now - firstSeen;
  return Number.isFinite(firstSeen) && age >= 0 && age <= newMs;
}

export function activeUsefulnessScore(node, now, activeMs) {
  if (!validCoords(node.lat, node.lon) || !isNodeActive(node, now, activeMs)) return null;
  const metric = nodeMetric(node, "usefulness_score");
  if (metric == null) return null;
  const score = Number(metric);
  return Number.isFinite(score) ? score : null;
}

export function parseNodeQuery(raw) {
  const { query, hex } = parseSearchQuery(raw);
  return { query, hexQuery: hex };
}

export function nodeMatchesQuery(node, query, hexQuery) {
  const name = String(node.name || "").toLocaleLowerCase("cs-CZ");
  if (query && name.includes(query)) return true;
  const hex = String(hexQuery || "").toUpperCase();
  if (hex.length < 2) return false;
  const key = String(node.public_key || "").toUpperCase();
  return key.startsWith(hex);
}

export function isNodeRoleAllowed(node, allowedRoles) {
  if (!allowedRoles) return true;
  return allowedRoles.has(node.role || "unknown");
}

export function resolveStatsField(metric, window) {
  if (metric === "relay") {
    if (window === "1h") return "relay_count_1h";
    if (window === "24h") return "relay_count_24h";
    return null;
  }
  if (metric === "unscoped") return window === "24h" ? "unscoped_relay_count_24h" : null;
  if (metric === "advert") return window === "24h" ? "advert_count_24h" : null;
  return window === "7d" ? `long_term_${metric}_score` : `${metric}_score`;
}

export function rankNodesByMetric(nodes, field, count, roles) {
  return nodes
    .filter((node) => !roles || roles.has(node.role))
    .map((node) => ({ node, value: node[field] }))
    .filter(({ value }) => value != null && Number.isFinite(Number(value)))
    .map(({ node, value }) => ({ node, value: Number(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

export function rankNodeMetric(nodes, node, field, roles) {
  const value = Number(nodeMetric(node, field));
  if (!Number.isFinite(value)) return null;
  let rank = 1;
  let total = 0;
  for (const candidate of nodes) {
    if (roles && !roles.has(candidate.role || "unknown")) continue;
    const candidateValue = Number(nodeMetric(candidate, field));
    if (!Number.isFinite(candidateValue)) continue;
    total += 1;
    if (candidateValue > value) rank += 1;
  }
  return total ? { rank, total } : null;
}

export function rankNodeTiers(nodes, now, activeMs, { topPercent = 0.05, secondPercent = 0.15 } = {}) {
  const ranked = nodes
    .map((node, index) => ({ index, node, score: activeUsefulnessScore(node, now, activeMs) }))
    .filter(({ score }) => score != null)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const total = ranked.length;
  const topCount = Math.min(total, Math.max(1, Math.round(total * topPercent)));
  const secondCount = Math.min(total, Math.max(topCount, Math.round(total * secondPercent)));

  return new Map(ranked.map(({ node }, index) => [
    node,
    index < topCount ? "top" : index < secondCount ? "second" : null,
  ]));
}
