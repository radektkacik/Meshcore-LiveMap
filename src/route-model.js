import { isRouteVisible } from "./route-utils.js";

function parseTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return NaN;
  const text = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return parseTimestamp(Number(text));
  const normalized = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  return Date.parse(normalized);
}

export function routeTimestamp(packet, fallback = Date.now()) {
  for (const value of [packet.latest, packet.timestamp, packet.first_seen]) {
    const timestamp = parseTimestamp(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const parsedFallback = typeof fallback === "number" ? fallback : parseTimestamp(fallback);
  return Number.isFinite(parsedFallback) ? parsedFallback : Date.now();
}

function newestFirst(a, b) {
  return b.createdAt - a.createdAt || b.sequence - a.sequence;
}

export class RouteStore {
  constructor({ retentionMs, feedLimit, capacity = Number.POSITIVE_INFINITY }) {
    this.retentionMs = retentionMs;
    this.feedLimit = feedLimit;
    this.capacity = capacity;
    this.liveByVersion = new Map();
    this.history = [];
    this.sequence = 0;
  }

  addLive(route) {
    if (this.liveByVersion.has(route.versionId)) return false;
    this.liveByVersion.set(route.versionId, { ...route, sequence: this.sequence++ });
    while (this.liveByVersion.size > this.capacity) {
      this.liveByVersion.delete(this.liveByVersion.keys().next().value);
    }
    return true;
  }

  addHistory(route) {
    this.history.push({ ...route, sequence: this.sequence++ });
  }

  prune(now = Date.now()) {
    const cutoff = now - this.retentionMs;
    const removed = [];
    for (const [versionId, route] of this.liveByVersion) {
      if (route.createdAt <= cutoff) {
        this.liveByVersion.delete(versionId);
        removed.push(versionId);
      }
    }
    return removed;
  }

  visibleLive(filters, now = Date.now()) {
    const cutoff = now - this.retentionMs;
    const byRouteId = new Map();
    for (const route of this.liveByVersion.values()) {
      if (route.createdAt <= cutoff || !isRouteVisible(route.packetType, route.hashBytes, filters)) continue;
      const previous = byRouteId.get(route.id);
      if (!previous || newestFirst(route, previous) < 0) byRouteId.set(route.id, route);
    }
    return [...byRouteId.values()].sort(newestFirst);
  }

  visibleFeed(filters, now = Date.now()) {
    const cutoff = now - this.retentionMs;
    return [...this.liveByVersion.values()]
      .filter((route) => route.createdAt > cutoff && isRouteVisible(route.packetType, route.hashBytes, filters))
      .sort(newestFirst)
      .slice(0, this.feedLimit);
  }

  packetOccurrences(packetHash, filters, now = Date.now()) {
    const hash = String(packetHash || "").toUpperCase();
    if (!hash) return [];
    const cutoff = now - this.retentionMs;
    const byRouteId = new Map();
    const add = (route, checkAge) => {
      if (!route) return;
      const routeHash = String(route.packetHash || String(route.id || "").split(":")[0]).toUpperCase();
      if (routeHash !== hash) return;
      if (checkAge && route.createdAt <= cutoff) return;
      if (!isRouteVisible(route.packetType, route.hashBytes, filters)) return;
      const previous = byRouteId.get(route.id);
      if (!previous || newestFirst(route, previous) < 0) byRouteId.set(route.id, route);
    };
    for (const route of this.history) add(route, false);
    for (const route of this.liveByVersion.values()) add(route, true);
    return [...byRouteId.values()].sort(newestFirst);
  }

  lastRoutesByNode(filters) {
    const result = new Map();
    const routes = [...this.history, ...this.liveByVersion.values()]
      .filter((route) => isRouteVisible(route.packetType, route.hashBytes, filters))
      .sort(newestFirst);
    for (const route of routes) {
      route.points.forEach((point, index) => {
        const key = point.publicKey?.toUpperCase();
        if (key && !result.has(key)) result.set(key, { ...route, position: index + 1 });
      });
    }
    return result;
  }
}

export function buildNeighborIndex(routes) {
  const index = new Map();
  const add = (from, toKey, toName, at) => {
    let neighbors = index.get(from);
    if (!neighbors) {
      neighbors = new Map();
      index.set(from, neighbors);
    }
    const entry = neighbors.get(toKey) || { count: 0, lastAt: 0, name: toName };
    entry.count += 1;
    if (toName) entry.name = toName;
    if (Number.isFinite(at)) entry.lastAt = Math.max(entry.lastAt, at);
    neighbors.set(toKey, entry);
  };

  for (const route of routes) {
    const points = route?.points || [];
    for (let index2 = 0; index2 < points.length - 1; index2 += 1) {
      const from = points[index2].publicKey?.toUpperCase();
      const to = points[index2 + 1].publicKey?.toUpperCase();
      if (!from || !to || from === to) continue;
      add(from, to, points[index2 + 1].name, route.timestamp);
      add(to, from, points[index2].name, route.timestamp);
    }
  }
  return index;
}

export class RouteVersionState {
  constructor(limit = 10_000) {
    this.limit = limit;
    this.seen = new Set();
    this.inFlight = new Map();
  }

  run(versionId, task) {
    if (this.seen.has(versionId)) return Promise.resolve({ status: "seen" });
    const current = this.inFlight.get(versionId);
    if (current) return current;

    const operation = Promise.resolve()
      .then(task)
      .then((value) => {
        if (value !== false) {
          this.seen.add(versionId);
          while (this.seen.size > this.limit) this.seen.delete(this.seen.values().next().value);
        }
        return { status: value === false ? "skipped" : "processed", value };
      })
      .finally(() => this.inFlight.delete(versionId));
    this.inFlight.set(versionId, operation);
    return operation;
  }

  forget(versionId) {
    this.seen.delete(versionId);
  }
}
