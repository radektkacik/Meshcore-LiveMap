export function parseSearchQuery(raw) {
  const text = String(raw || "").trim();
  const token = text.replace(/\s+/g, "");
  return {
    query: text.toLocaleLowerCase("cs-CZ"),
    hex: /^[0-9a-f]{2,}$/i.test(token) ? token.toUpperCase() : "",
  };
}

function nameScore(name, query) {
  const value = String(name || "").toLocaleLowerCase("cs-CZ");
  if (!value || !query) return 0;
  if (value === query) return 60;
  if (value.startsWith(query)) return 50;
  return value.includes(query) ? 40 : 0;
}

function prefixScore(value, hex) {
  const text = String(value || "").toUpperCase();
  if (!text || !hex) return 0;
  return text.startsWith(hex) ? 70 : 0;
}

function timeOf(item) {
  const value = Number(item?.timestamp ?? item?.last_seen_ms ?? 0);
  if (Number.isFinite(value) && value > 0) return value;
  const parsed = Date.parse(item?.last_seen || item?.timestamp || item?.observed_at || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function rank(entries, limit) {
  return entries
    .sort((a, b) => b.score - a.score || timeOf(b.item) - timeOf(a.item))
    .slice(0, limit)
    .map(({ item }) => item);
}

export function searchEntities({
  channels = [],
  limit = 4,
  nodes = [],
  observers = [],
  packets = [],
  query = "",
} = {}) {
  const parsed = parseSearchQuery(query);
  const result = { channels: [], nodes: [], observers: [], packets: [] };
  if (!parsed.query || (parsed.query.length < 2 && !parsed.hex)) return result;

  const nodeEntries = [];
  for (const node of nodes) {
    const score = Math.max(
      nameScore(node.name, parsed.query),
      prefixScore(node.public_key, parsed.hex),
    );
    if (score) nodeEntries.push({ item: node, score });
  }
  result.nodes = rank(nodeEntries, limit);

  const observerEntries = [];
  for (const observer of observers) {
    const score = Math.max(
      nameScore(observer.name, parsed.query),
      nameScore(observer.iata, parsed.query),
      prefixScore(observer.id, parsed.hex),
    );
    if (score) observerEntries.push({ item: observer, score });
  }
  result.observers = rank(observerEntries, limit);

  if (parsed.hex) {
    const byHash = new Map();
    for (const packet of packets) {
      const hash = String(packet?.hash || "").toUpperCase();
      if (!hash.startsWith(parsed.hex)) continue;
      const existing = byHash.get(hash);
      if (!existing || timeOf(packet) > timeOf(existing)) byHash.set(hash, packet);
    }
    result.packets = rank(
      [...byHash.values()].map((packet) => ({ item: packet, score: 70 })),
      limit,
    );
  }

  const channelEntries = [];
  for (const message of channels) {
    const score = Math.max(
      nameScore(message.channel, parsed.query),
      nameScore(message.sender, parsed.query),
      String(message.text || "").toLocaleLowerCase("cs-CZ").includes(parsed.query) ? 30 : 0,
      prefixScore(message.hash, parsed.hex),
    );
    if (score) channelEntries.push({ item: message, score });
  }
  result.channels = rank(channelEntries, limit);

  return result;
}

export function countSearchResults(result) {
  return Object.values(result || {}).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);
}
