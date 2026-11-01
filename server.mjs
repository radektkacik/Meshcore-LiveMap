import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect as connectTls } from "node:tls";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import mqtt from "mqtt";
import { MeshCorePacketDecoder } from "@michaelhart/meshcore-decoder";
import { decodedPacketHashBytes, decodedPacketPath, TimeBoundRingBuffer } from "./backend-utils.mjs";
import { createNodeMetricsStore } from "./node-metrics.mjs";
import { createPacketStore } from "./packet-store.mjs";
import { createVisitStatsStore } from "./visit-stats.mjs";
import { createFeedbackStore } from "./feedback.mjs";
import { createPhotoStore, detectImage, PhotoError } from "./photos.mjs";
import { createNodeInfoStore } from "./node-info.mjs";
import { createCommentStore } from "./comments.mjs";
import { fetchRepeaterPage, findRepeaterPage, validRepeaterSlug } from "./repeater-pages.mjs";
import { createTelegramNotifier } from "./notify.mjs";

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const dist = join(process.cwd(), "dist");
const buildManifestPath = join(dist, "build.json");
const upstream = process.env.CORESCOPE_URL || "https://analyzer.meshcore.cz";

function currentBuild() {
  try {
    const manifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
    if (typeof manifest.build === "string" && manifest.build) return manifest.build;
  } catch {}
  return process.env.BUILD_ID || null;
}
const requestBase = "http://localhost";
const upstreamTimeoutMs = Math.max(1, Number(process.env.UPSTREAM_TIMEOUT_MS || 15_000));
const statsTimeoutMs = Math.max(1_000, Number(process.env.STATS_TIMEOUT_MS || 5_000));
const statsCollectMs = Math.max(0, Number(process.env.STATS_COLLECT_MS ?? 5 * 60 * 1000));
const statsHistoryDays = Math.max(1, Number(process.env.STATS_HISTORY_DAYS || 30));
const statsHourlyRetentionDays = Math.max(7, Number(process.env.STATS_HOURLY_RETENTION_DAYS || 730));
const statsDailyRetentionDays = Math.max(30, Number(process.env.STATS_DAILY_RETENTION_DAYS || 1825));
const metricsCollectionMs = 15 * 60 * 1000;
const scoreDbPath = process.env.SCORE_DB_PATH || join(process.cwd(), "data", "node-metrics.sqlite");
const metricsStore = createNodeMetricsStore(scoreDbPath, {
  statsBucketMs: statsCollectMs || 5 * 60 * 1000,
  statsDailyRetentionDays,
  statsHistoryDays,
  statsHourlyRetentionDays,
});
const packetDbPath = process.env.PACKET_DB_PATH || join(process.cwd(), "data", "packets.sqlite");
const packetStore = createPacketStore(packetDbPath, {
  retentionMs: Math.max(1, Number(process.env.PACKET_RETENTION_MS || 7 * 24 * 60 * 60 * 1000)),
  maxRows: Math.max(1, Number(process.env.PACKET_MAX_ROWS || 500_000)),
});
const packetCollectionMs = Math.max(30_000, Number(process.env.PACKET_COLLECT_MS || 5 * 60 * 1000));
const visitsDbPath = process.env.VISITS_DB_PATH || join(process.cwd(), "data", "visits.sqlite");
const visitStore = createVisitStatsStore(visitsDbPath);
const feedbackDbPath = process.env.FEEDBACK_DB_PATH || join(process.cwd(), "data", "feedback.sqlite");
const feedbackStore = createFeedbackStore(feedbackDbPath);
const nodeInfoDbPath = process.env.NODE_INFO_DB_PATH || join(process.cwd(), "data", "node-info.sqlite");
const nodeInfoStore = createNodeInfoStore(nodeInfoDbPath);
const commentsDbPath = process.env.COMMENTS_DB_PATH || join(process.cwd(), "data", "comments.sqlite");
const commentStore = createCommentStore(commentsDbPath);
const feedbackToken = process.env.FEEDBACK_TOKEN || "";
const adminPassword = process.env.ADMIN_PASSWORD || feedbackToken || process.env.PHOTO_TOKEN || "";
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || adminPassword;
const adminSessionTtlMs = Math.max(60_000, Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000));
const photoDir = process.env.PHOTO_DIR || join(process.cwd(), "uploads");
const photoMaxBytes = Math.max(1024, Number(process.env.PHOTO_MAX_BYTES || 5 * 1024 * 1024));
const photoAutoApprove = process.env.PHOTO_AUTO_APPROVE === "1";
const photoStore = createPhotoStore(photoDir, {
  maxBytes: photoMaxBytes,
  maxDimension: Math.max(100, Number(process.env.PHOTO_MAX_DIMENSION || 2400)),
  maxPerNode: Math.max(1, Number(process.env.PHOTO_MAX_PER_NODE || 8)),
  maxRows: Math.max(10, Number(process.env.PHOTO_MAX_ROWS || 10_000)),
  maxTotalBytes: Math.max(1024 * 1024, Number(process.env.PHOTO_MAX_TOTAL_BYTES || 2 * 1024 * 1024 * 1024)),
});
const photoToken = process.env.PHOTO_TOKEN || feedbackToken;
if (!photoToken) {
  console.warn("Photo uploads are disabled: set PHOTO_TOKEN or FEEDBACK_TOKEN");
}
if (!adminPassword) {
  console.warn("Admin UI is disabled: set ADMIN_PASSWORD or FEEDBACK_TOKEN");
}
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "https://mapa.meshcore.cz").replace(/\/+$/, "");
const publicBasePath = (() => {
  try {
    return new URL(publicBaseUrl).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
})();
const adminBasePath = `${publicBasePath}/admin` || "/admin";
const repeaterImportEnabled = publicBasePath === "/beta" || process.env.REPEATER_IMPORT === "1";

function sitePath(path = "/") {
  return `${publicBasePath}${path}`;
}

function adminPath(path = "") {
  return `${adminBasePath}${path}`;
}

const telegramNotifier = createTelegramNotifier({
  apiBase: process.env.TELEGRAM_API_BASE || "https://api.telegram.org",
  chatId: process.env.TELEGRAM_CHAT_ID || "",
  timeoutMs: Math.max(1000, Number(process.env.TELEGRAM_TIMEOUT_MS || 5000)),
  token: process.env.TELEGRAM_BOT_TOKEN || "",
});
const telegramNotifyPhotos = process.env.TELEGRAM_NOTIFY_PHOTOS !== "0";
const telegramNotifyReports = process.env.TELEGRAM_NOTIFY_REPORTS !== "0";
const telegramNotifyFeedback = process.env.TELEGRAM_NOTIFY_FEEDBACK === "1";
const telegramNotifyNodeInfo = process.env.TELEGRAM_NOTIFY_NODE_INFO !== "0";
const telegramNotifyComments = process.env.TELEGRAM_NOTIFY_COMMENTS !== "0";
const telegramAdminLink = process.env.TELEGRAM_ADMIN_LINK === "1";
const telegramSilent = process.env.TELEGRAM_SILENT === "1";
const monitorAlertsEnabled = process.env.MONITOR_ALERTS === "1";
const monitorIntervalMs = Math.max(60_000, Number(process.env.MONITOR_INTERVAL_MS || 300_000));
const monitorRepeatMs = Math.max(60_000, Number(process.env.MONITOR_REPEAT_MS || 3_600_000));
const monitorDiskPercent = Math.min(99, Math.max(1, Number(process.env.MONITOR_DISK_PERCENT || 90)));
const monitorPacketAgeSec = Math.max(60, Number(process.env.MONITOR_PACKET_AGE_SEC || 600));
const monitorTimeoutMs = Math.max(5_000, Number(process.env.MONITOR_TIMEOUT_MS || 30_000));
const monitorFailureThreshold = Math.max(1, Number(process.env.MONITOR_FAILURES || 2));
const monitorUrls = String(process.env.MONITOR_URLS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
let monitorAlertKey = "";
let monitorAlertedAt = 0;
let monitorFailureStreak = 0;
if (telegramNotifier.enabled) {
  console.log("Telegram admin notifications enabled");
}
const elevationUpstream = process.env.ELEVATION_UPSTREAM || "https://api.open-meteo.com/v1/elevation";
const elevationFallbackUrl = process.env.ELEVATION_FALLBACK_URL || "https://api.open-elevation.com/api/v1/lookup";
const elevationCacheLimit = Math.max(1, Number(process.env.ELEVATION_CACHE_LIMIT || 50_000));
const elevationMaxPoints = Math.max(1, Number(process.env.ELEVATION_MAX_POINTS || 200));
const elevationTimeoutMs = Math.max(1_000, Number(process.env.ELEVATION_TIMEOUT_MS || 10_000));
const elevationBatchSize = 100;
const elevationCache = new Map();
let elevationQueue = Promise.resolve();
const terrainUpstream = process.env.TERRAIN_UPSTREAM
  || "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const terrainCacheLimit = Math.max(1, Number(process.env.TERRAIN_CACHE_LIMIT || 300));
const terrainCacheTtlMs = Math.max(60_000, Number(process.env.TERRAIN_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000));
const terrainTimeoutMs = Math.max(1_000, Number(process.env.TERRAIN_TIMEOUT_MS || 10_000));
const terrainRateLimit = Math.max(1, Number(process.env.TERRAIN_RATE_LIMIT || 600));
const terrainRateWindowMs = Math.max(60_000, Number(process.env.TERRAIN_RATE_WINDOW_MS || 10 * 60 * 1000));
const terrainCache = new Map();
const terrainInFlight = new Map();
const terrainRate = new Map();
const nodesCachePath = process.env.NODES_CACHE_PATH || join(process.cwd(), "data", "nodes-cache.json");
const nodesCacheTtlMs = Math.max(60_000, Number(process.env.NODES_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000));
const nodesSoftTtlMs = Math.max(60_000, Number(process.env.NODES_SOFT_TTL_MS || 15 * 60 * 1000));
const nodesCacheWriteMs = Math.max(0, Number(process.env.NODES_CACHE_WRITE_MS || 5 * 60 * 1000));
const statsCachePath = process.env.STATS_CACHE_PATH || join(process.cwd(), "data", "stats-cache.json");
const statsCacheTtlMs = Math.max(60_000, Number(process.env.STATS_CACHE_TTL_MS || 24 * 60 * 60 * 1000));
const statsSoftTtlMs = Math.max(10_000, Number(process.env.STATS_SOFT_TTL_MS || 60_000));
const statsCacheWriteMs = Math.max(0, Number(process.env.STATS_CACHE_WRITE_MS || 5 * 60 * 1000));
const resolveCacheTtlMs = Math.max(60_000, Number(process.env.RESOLVE_CACHE_TTL_MS || 6 * 60 * 60 * 1000));
const resolveCacheLimit = Math.max(1, Number(process.env.RESOLVE_CACHE_LIMIT || 500));
const nodeDetailTtlMs = Math.max(60_000, Number(process.env.NODE_DETAIL_TTL_MS || 5 * 60 * 1000));
const nodeDetailCacheLimit = Math.max(10, Number(process.env.NODE_DETAIL_CACHE_LIMIT || 500));
const nodeDetailTimeoutMs = Math.max(1_000, Number(process.env.NODE_DETAIL_TIMEOUT_MS || 8_000));
const nodeDetailCache = new Map();
let nodesCache = null;
let nodesCacheWrittenAt = 0;
let statsCache = null;
let statsCacheWrittenAt = 0;
let statsRefreshActive = false;
const resolveCache = new Map();
const allowedApiPaths = [
  "/api/nodes",
  "/api/observers",
  "/api/packets",
  "/api/resolve-hops",
  "/api/stats",
  "/api/packet-history",
];
const packetStreams = new Set();
const packetBufferMs = 120_000;
const maxPacketBufferEntries = Math.max(1, Number(process.env.MAX_PACKET_BUFFER_ENTRIES || 5_000));
const recentPackets = new TimeBoundRingBuffer({
  capacity: maxPacketBufferEntries,
  maxAgeMs: packetBufferMs,
});
const maxPacketStreams = Math.max(1, Number(process.env.MAX_PACKET_STREAMS || 100));
const maxStreamBufferBytes = Math.max(1024, Number(process.env.MAX_STREAM_BUFFER_BYTES || 256 * 1024));
let mqttConnected = false;
let mqttReconnects = 0;
let mqttConnectedSince = 0;
let lastMqttPacketAt = 0;
const serverStartedAt = Date.now();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data: https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.opentopomap.org https://server.arcgisonline.com",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
};

try {
  const cached = JSON.parse(readFileSync(nodesCachePath, "utf8"));
  if (cached && typeof cached.body === "string") nodesCache = cached;
} catch {
  nodesCache = null;
}

try {
  const cached = JSON.parse(readFileSync(statsCachePath, "utf8"));
  if (cached && typeof cached.body === "string") statsCache = cached;
} catch {
  statsCache = null;
}

function nodesCacheFresh() {
  return Boolean(nodesCache) && Date.now() - Number(nodesCache.at || 0) <= nodesCacheTtlMs;
}

function storeNodesCache(data) {
  const now = Date.now();
  nodesCache = { at: now, body: JSON.stringify(data) };
  if (now - nodesCacheWrittenAt < nodesCacheWriteMs) return;
  nodesCacheWrittenAt = now;
  try {
    mkdirSync(dirname(nodesCachePath), { recursive: true });
    writeFileSync(nodesCachePath, JSON.stringify(nodesCache));
  } catch (error) {
    console.error(`Nodes cache write failed: ${error.message}`);
  }
}

function buildNodesPayload(data) {
  const payload = { ...data };
  payload.nodes = metricsStore.decorateNodes(Array.isArray(payload.nodes) ? payload.nodes : []);
  payload.scoreHistory = { collectionMinutes: 15, historyDays: 30, windowDays: 7 };
  return payload;
}

function statsCacheFresh() {
  return Boolean(statsCache) && Date.now() - Number(statsCache.at || 0) <= statsCacheTtlMs;
}

function storeStatsCache(body, contentType) {
  const now = Date.now();
  statsCache = {
    at: now,
    body: Buffer.isBuffer(body) ? body.toString("utf8") : String(body),
    contentType: contentType || "application/json; charset=utf-8",
  };
  if (now - statsCacheWrittenAt < statsCacheWriteMs) return;
  statsCacheWrittenAt = now;
  try {
    mkdirSync(dirname(statsCachePath), { recursive: true });
    writeFileSync(statsCachePath, JSON.stringify(statsCache));
  } catch (error) {
    console.error(`Stats cache write failed: ${error.message}`);
  }
}

function sendStatsCache(response, stale) {
  response.writeHead(200, {
    "Content-Type": statsCache.contentType || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(stale ? { "X-Data-Stale": "1" } : {}),
  });
  response.end(statsCache.body);
}

async function refreshStatsCache() {
  if (statsRefreshActive) return;
  statsRefreshActive = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  timeout.unref();
  try {
    const response = await fetch(`${upstream}/api/stats`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CoreScope returned HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    storeStatsCache(body, response.headers.get("content-type"));
  } catch (error) {
    console.error(`Stats refresh failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    statsRefreshActive = false;
  }
}

function localPacketsLastHour() {
  const newest = Number(packetStore.newest()) || 0;
  if (!newest) return null;
  const anchor = Math.min(Date.now(), newest);
  return packetStore.countDistinctSince(anchor - 60 * 60 * 1000);
}

function sendStatsFallback(response) {
  const packetsLastHour = localPacketsLastHour();
  if (packetsLastHour == null) return false;
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Data-Source": "local",
    "X-Data-Stale": "1",
  });
  response.end(JSON.stringify({
    generatedAt: new Date().toISOString(),
    packetsLastHour,
    partial: true,
  }));
  return true;
}

function startOfLocalDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addLocalDays(timestamp, days) {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function resolveCacheGet(key) {
  const entry = resolveCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > resolveCacheTtlMs) {
    resolveCache.delete(key);
    return null;
  }
  return entry;
}

function resolveCacheSet(key, body, contentType) {
  resolveCache.delete(key);
  resolveCache.set(key, { at: Date.now(), body, contentType });
  while (resolveCache.size > resolveCacheLimit) {
    resolveCache.delete(resolveCache.keys().next().value);
  }
}

const NODE_DETAIL_PARTS = {
  clockSkew: "/clock-skew",
  detail: "",
  health: "/health",
  neighbors: "/neighbors",
  paths: "/paths",
};

async function fetchNodeDetail(key) {
  const cached = nodeDetailCache.get(key);
  if (cached && Date.now() - cached.at <= cached.ttlMs) {
    return { data: cached.data, stale: false };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), nodeDetailTimeoutMs);
  timeout.unref();
  try {
    const results = await Promise.allSettled(Object.entries(NODE_DETAIL_PARTS).map(async ([field, suffix]) => {
      const response = await fetch(`${upstream}/api/nodes/${key}${suffix}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`node ${suffix || "detail"} HTTP ${response.status}`);
      return [field, await response.json()];
    }));
    const data = { fetchedAt: Date.now(), key, partial: false };
    let loaded = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        data[result.value[0]] = result.value[1];
        loaded += 1;
      } else {
        data.partial = true;
      }
    }
    if (!loaded) throw new Error("node detail unavailable");
    const ttlMs = data.partial ? Math.min(nodeDetailTtlMs, 60_000) : nodeDetailTtlMs;
    nodeDetailCache.delete(key);
    nodeDetailCache.set(key, { at: Date.now(), data, ttlMs });
    while (nodeDetailCache.size > nodeDetailCacheLimit) {
      nodeDetailCache.delete(nodeDetailCache.keys().next().value);
    }
    return { data, stale: false };
  } catch (error) {
    if (cached) return { data: cached.data, stale: true };
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sendFile(response, filePath) {
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": extname(filePath) === ".html" ? "no-store" : "public, max-age=31536000, immutable",
  });
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!response.writableEnded) response.destroy();
  });
  stream.pipe(response);
}

function parseMqttPacket(topic, message) {
  const source = JSON.parse(message.toString("utf8"));
  if (source.type !== "PACKET" || !source.raw) return null;
  const topicParts = topic.split("/");

  let decoded;
  try {
    decoded = MeshCorePacketDecoder.decode(source.raw);
  } catch {
    return null;
  }

  const payloadType = decoded.payloadType ?? 0;
  const routeType = decoded.routeType ?? 0;
  const payloadDecoded = decoded?.payload?.decoded ?? decoded?.payload ?? {};
  const appData = payloadDecoded?.appData ?? payloadDecoded?.appdata ?? {};
  const path = decodedPacketPath(decoded).map((hop) => String(hop).toUpperCase());
  const advertData = payloadType === 4 ? {
    pubKey: (payloadDecoded.publicKey || payloadDecoded.publickey || "").toLowerCase(),
    lat: appData.location?.latitude ?? appData.location?.lat ?? null,
    lon: appData.location?.longitude ?? appData.location?.lon ?? null,
    name: appData.name || null,
    type: "ADVERT",
  } : {};
  const senderPubkey = advertData.pubKey
    || decoded?.payload?.senderPubkey
    || payloadDecoded?.senderPubkey
    || payloadDecoded?.sender
    || null;

  return {
    decoded_json: JSON.stringify(payloadType === 4 ? advertData : payloadType === 9 ? payloadDecoded : advertData),
    first_seen: new Date().toISOString(),
    hash: String(source.hash || decoded.messageHash || "").toLowerCase(),
    latest: new Date().toISOString(),
    observer_count: 1,
    observer_iata: topicParts[1] || "",
    observer_id: topicParts[2] || "",
    observer_name: source.origin || "",
    origin_id: senderPubkey || "",
    path_hash_bytes: decodedPacketHashBytes(decoded),
    path_json: JSON.stringify(path),
    payload_type: payloadType,
    raw_hex: source.raw,
    route_type: routeType,
    rssi: Number(source.RSSI),
    snr: Number(source.SNR),
  };
}

const feedbackRate = new Map();
const feedbackRateLimit = Math.max(1, Number(process.env.FEEDBACK_RATE_LIMIT || 15));
const feedbackDailyLimit = Math.max(10, Number(process.env.FEEDBACK_DAILY_LIMIT || 300));
const feedbackMaxRows = Math.max(100, Number(process.env.FEEDBACK_MAX_ROWS || 5000));
const feedbackCooldownMs = Math.max(0, Number(process.env.FEEDBACK_COOLDOWN_MS || 30_000));

function checkFeedback(ip, now = Date.now()) {
  const windowStart = now - 60 * 60 * 1000;
  const stamps = (feedbackRate.get(ip) || []).filter((stamp) => stamp > windowStart);
  const last = stamps[stamps.length - 1];
  if (last != null && now - last < feedbackCooldownMs) {
    feedbackRate.set(ip, stamps);
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((feedbackCooldownMs - (now - last)) / 1000)),
      message: "Mezi zprávami je krátká pauza, zkuste to prosím za chvíli.",
    };
  }
  if (stamps.length >= feedbackRateLimit) {
    feedbackRate.set(ip, stamps);
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((stamps[0] + 60 * 60 * 1000 - now) / 1000)),
      message: "Příliš mnoho zpráv za hodinu, zkuste to později.",
    };
  }
  stamps.push(now);
  feedbackRate.set(ip, stamps);
  if (feedbackRate.size > 5000) {
    for (const [key, value] of feedbackRate) {
      if (!value.some((stamp) => stamp > windowStart)) feedbackRate.delete(key);
    }
  }
  return { ok: true };
}

function startOfUtcDay(now) {
  return Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
}

const commentRate = new Map();
const commentRateLimit = Math.max(1, Number(process.env.COMMENT_RATE_LIMIT || 10));
const commentDailyLimit = Math.max(10, Number(process.env.COMMENT_DAILY_LIMIT || 200));
const commentMaxRows = Math.max(100, Number(process.env.COMMENT_MAX_ROWS || 5000));
const commentCooldownMs = Math.max(0, Number(process.env.COMMENT_COOLDOWN_MS || 15_000));

function checkComment(ip, now = Date.now()) {
  const windowStart = now - 60 * 60 * 1000;
  const stamps = (commentRate.get(ip) || []).filter((stamp) => stamp > windowStart);
  const last = stamps[stamps.length - 1];
  if (last != null && now - last < commentCooldownMs) {
    commentRate.set(ip, stamps);
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((commentCooldownMs - (now - last)) / 1000)),
      message: "Mezi komentáři je krátká pauza, zkuste to prosím za chvíli.",
    };
  }
  if (stamps.length >= commentRateLimit) {
    commentRate.set(ip, stamps);
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((stamps[0] + 60 * 60 * 1000 - now) / 1000)),
      message: "Příliš mnoho komentářů za hodinu, zkuste to později.",
    };
  }
  stamps.push(now);
  commentRate.set(ip, stamps);
  if (commentRate.size > 5000) {
    for (const [key, value] of commentRate) {
      if (!value.some((stamp) => stamp > windowStart)) commentRate.delete(key);
    }
  }
  return { ok: true };
}

function readBody(request, limit = 16_384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function readBodyBuffer(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        chunks.length = 0;
        request.resume();
        reject(Object.assign(new Error("Payload too large"), { code: "too_large" }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    request.on("error", (error) => {
      if (failed) return;
      failed = true;
      reject(error);
    });
  });
}

function decodeHeaderValue(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function cleanPhotoText(value, limit) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

const photoRate = new Map();
const photoRateLimit = Math.max(1, Number(process.env.PHOTO_RATE_LIMIT || 8));
const photoDailyLimit = Math.max(1, Number(process.env.PHOTO_DAILY_LIMIT || 30));
const photoCooldownMs = Math.max(0, Number(process.env.PHOTO_COOLDOWN_MS || 10_000));
const photoReportRate = new Map();
const photoReportLimit = Math.max(1, Number(process.env.PHOTO_REPORT_RATE_LIMIT || 5));
const photoReportCooldownMs = Math.max(0, Number(process.env.PHOTO_REPORT_COOLDOWN_MS || 10_000));

function checkPhotoUpload(ip, now = Date.now(), { skipCooldown = false } = {}) {
  const hourStart = now - 60 * 60 * 1000;
  const dayStart = now - 24 * 60 * 60 * 1000;
  const stamps = (photoRate.get(ip) || []).filter((stamp) => stamp > dayStart);
  const last = stamps[stamps.length - 1];
  if (!skipCooldown && last != null && now - last < photoCooldownMs) {
    photoRate.set(ip, stamps);
    return {
      message: "Mezi nahráním fotek je krátká pauza, zkuste to prosím za chvíli.",
      ok: false,
      retryAfter: Math.max(1, Math.ceil((photoCooldownMs - (now - last)) / 1000)),
    };
  }
  if (stamps.filter((stamp) => stamp > hourStart).length >= photoRateLimit) {
    photoRate.set(ip, stamps);
    return {
      message: "Příliš mnoho nahraných fotek za hodinu, zkuste to později.",
      ok: false,
      retryAfter: 3600,
    };
  }
  if (stamps.length >= photoDailyLimit) {
    photoRate.set(ip, stamps);
    return {
      message: "Denní limit nahrávání fotek byl vyčerpán.",
      ok: false,
      retryAfter: 3600,
    };
  }
  stamps.push(now);
  photoRate.set(ip, stamps);
  if (photoRate.size > 5000) {
    for (const [key, value] of photoRate) {
      if (!value.some((stamp) => stamp > dayStart)) photoRate.delete(key);
    }
  }
  return { ok: true };
}

function checkPhotoReport(ip, now = Date.now()) {
  const hourStart = now - 60 * 60 * 1000;
  const stamps = (photoReportRate.get(ip) || []).filter((stamp) => stamp > hourStart);
  const last = stamps[stamps.length - 1];
  if (last != null && now - last < photoReportCooldownMs) {
    photoReportRate.set(ip, stamps);
    return {
      message: "Mezi žádostmi je krátká pauza, zkuste to prosím za chvíli.",
      ok: false,
      retryAfter: Math.max(1, Math.ceil((photoReportCooldownMs - (now - last)) / 1000)),
    };
  }
  if (stamps.length >= photoReportLimit) {
    photoReportRate.set(ip, stamps);
    return {
      message: "Příliš mnoho žádostí za hodinu, zkuste to později.",
      ok: false,
      retryAfter: 3600,
    };
  }
  stamps.push(now);
  photoReportRate.set(ip, stamps);
  if (photoReportRate.size > 5000) {
    for (const [key, value] of photoReportRate) {
      if (!value.some((stamp) => stamp > hourStart)) photoReportRate.delete(key);
    }
  }
  return { ok: true };
}

const nodeInfoRate = new Map();
const nodeInfoRateLimit = Math.max(1, Number(process.env.NODE_INFO_RATE_LIMIT || 10));
const nodeInfoDailyLimit = Math.max(1, Number(process.env.NODE_INFO_DAILY_LIMIT || 50));
const nodeInfoCooldownMs = Math.max(0, Number(process.env.NODE_INFO_COOLDOWN_MS || 5_000));

function checkNodeInfo(ip, now = Date.now()) {
  const hourStart = now - 60 * 60 * 1000;
  const dayStart = now - 24 * 60 * 60 * 1000;
  const stamps = (nodeInfoRate.get(ip) || []).filter((stamp) => stamp > dayStart);
  const last = stamps[stamps.length - 1];
  if (last != null && now - last < nodeInfoCooldownMs) {
    nodeInfoRate.set(ip, stamps);
    return {
      message: "Mezi úpravami info je krátká pauza, zkuste to prosím za chvíli.",
      ok: false,
      retryAfter: Math.max(1, Math.ceil((nodeInfoCooldownMs - (now - last)) / 1000)),
    };
  }
  if (stamps.filter((stamp) => stamp > hourStart).length >= nodeInfoRateLimit) {
    nodeInfoRate.set(ip, stamps);
    return { message: "Příliš mnoho úprav info za hodinu.", ok: false, retryAfter: 3600 };
  }
  if (stamps.length >= nodeInfoDailyLimit) {
    nodeInfoRate.set(ip, stamps);
    return { message: "Denní limit úprav info byl vyčerpán.", ok: false, retryAfter: 3600 };
  }
  stamps.push(now);
  nodeInfoRate.set(ip, stamps);
  if (nodeInfoRate.size > 5000) {
    for (const [key, value] of nodeInfoRate) {
      if (!value.some((stamp) => stamp > dayStart)) nodeInfoRate.delete(key);
    }
  }
  return { ok: true };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderFeedbackPage(entries, token) {
  const rows = entries.map((entry) => {
    const flags = [
      entry.is_public ? "veřejné" : "soukromé",
      entry.hidden ? "skryté" : null,
    ].filter(Boolean).join(" · ");
    const action = token
      ? `<a class="mod" href="/api/feedback/moderate?token=${encodeURIComponent(token)}&id=${entry.id}&hidden=${entry.hidden ? 0 : 1}">${entry.hidden ? "Zobrazit" : "Skrýt"}</a>`
      : "";
    return `
    <li${entry.hidden ? ' class="is-hidden"' : ""}>
      <div class="meta">#${entry.id} · ${escapeHtml(new Date(entry.created_at).toLocaleString("cs-CZ"))} · ${escapeHtml(entry.category || "other")} · ${escapeHtml(flags)}</div>
      ${entry.name ? `<div class="name">${escapeHtml(entry.name)}</div>` : ""}
      <p>${escapeHtml(entry.message)}</p>
      ${entry.contact ? `<div class="contact">Kontakt: ${escapeHtml(entry.contact)}</div>` : ""}
      ${action}
    </li>`;
  }).join("");
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Zpětná vazba</title>
<style>
body { margin:0; padding:24px; background:#e9e8e1; color:#182820; font:14px/1.5 Manrope, system-ui, sans-serif; }
h1 { font-size:18px; margin:0 0 4px; }
.count { color:#667b70; font-size:12px; margin-bottom:16px; }
ul { list-style:none; margin:0; padding:0; }
li { background:#fff; border:1px solid rgba(30,65,49,.16); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
.meta { color:#667b70; font:11px "DM Mono", monospace; margin-bottom:6px; }
.name { font-weight:700; margin-bottom:3px; }
p { margin:0 0 6px; white-space:pre-wrap; }
.contact { color:#49665b; font-size:12px; }
.is-hidden { opacity:.55; }
.mod { display:inline-block; margin-top:6px; font-size:12px; color:#078e62; }
.empty { color:#667b70; }
</style>
</head>
<body>
<h1>Zpětná vazba</h1>
<div class="count">${entries.length} zpráv (nejnovější první)</div>
${entries.length ? `<ul>${rows}</ul>` : '<p class="empty">Zatím žádné zprávy.</p>'}
</body>
</html>`;
}

function renderPhotoPage(entries, reports, token, status, openReports) {
  const names = photoNodeNames();
  const labels = {
    all: "Vše",
    approved: "Schválené",
    hidden: "Skryté",
    pending: "Čekající",
    reports: `Žádosti${openReports ? ` (${openReports})` : ""}`,
  };
  const tabs = ["pending", "approved", "hidden", "all", "reports"].map((value) => {
    const active = status === value ? ' class="active"' : "";
    return `<a${active} href="view?token=${encodeURIComponent(token)}&status=${value}">${labels[value]}</a>`;
  }).join("");
  const rows = entries.map((photo) => {
    const imageUrl = `../photos/${encodeURIComponent(photo.id)}?token=${encodeURIComponent(token)}`;
    const node = names.get(photo.nodeKey);
    const nodeLabel = node ? `${node} · ${photo.nodeKey.slice(0, 8)}` : photo.nodeKey.slice(0, 16);
    const actions = [
      photo.status !== "approved"
        ? `<a class="approve" href="moderate?token=${encodeURIComponent(token)}&id=${encodeURIComponent(photo.id)}&action=approve&status=${encodeURIComponent(status)}">Schválit</a>`
        : "",
      photo.status !== "hidden"
        ? `<a class="hide" href="moderate?token=${encodeURIComponent(token)}&id=${encodeURIComponent(photo.id)}&action=hide&status=${encodeURIComponent(status)}">Skrýt</a>`
        : "",
      `<a class="delete" href="moderate?token=${encodeURIComponent(token)}&id=${encodeURIComponent(photo.id)}&action=delete&status=${encodeURIComponent(status)}">Smazat</a>`,
    ].filter(Boolean).join("");
    return `
    <li class="photo ${escapeHtml(photo.status)}">
      <a class="thumb" href="${imageUrl}" target="_blank" rel="noreferrer"><img src="${imageUrl}" alt="" loading="lazy" /></a>
      <div class="body">
        <div class="meta">${isCover ? '<span class="cover-badge">Náhled</span>' : ""}${escapeHtml(photo.status)} · ${escapeHtml(new Date(photo.createdAt).toLocaleString("cs-CZ"))} · ${escapeHtml(photo.bytes)} B · ${photo.width || "?"}×${photo.height || "?"}</div>
        <div class="node"><a href="../../?node=${encodeURIComponent(photo.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>
        ${photo.author ? `<div class="author">${escapeHtml(photo.author)}</div>` : ""}
        ${photo.caption ? `<p>${escapeHtml(photo.caption)}</p>` : ""}
        <div class="actions">${actions}</div>
      </div>
    </li>`;
  }).join("");
  const reportReasons = {
    inappropriate: "Nevhodný obsah",
    other: "Jiné",
    owner: "Moje fotka",
    privacy: "Soukromí",
  };
  const reportRows = reports.map((report) => {
    const imageUrl = report.photo
      ? `../photos/${encodeURIComponent(report.photo.id)}?token=${encodeURIComponent(token)}`
      : null;
    const node = report.photo ? names.get(report.photo.nodeKey) : null;
    const nodeLabel = node ? `${node} · ${report.photo.nodeKey.slice(0, 8)}` : (report.photo ? report.photo.nodeKey.slice(0, 16) : report.photoId.slice(0, 16));
    const actions = [
      report.photo
        ? `<a class="delete" href="moderate?token=${encodeURIComponent(token)}&id=${encodeURIComponent(report.photoId)}&action=delete&status=reports">Smazat fotku</a>`
        : '<span class="missing">Fotka už není dostupná</span>',
      `<a class="resolve" href="moderate?token=${encodeURIComponent(token)}&report=${encodeURIComponent(report.id)}&action=dismiss&status=reports">Zamítnout</a>`,
    ].filter(Boolean).join("");
    return `
    <li class="photo report">
      ${imageUrl
        ? `<a class="thumb" href="${imageUrl}" target="_blank" rel="noreferrer"><img src="${imageUrl}" alt="" loading="lazy" /></a>`
        : '<div class="thumb missing"></div>'}
      <div class="body">
        <div class="meta">${escapeHtml(reportReasons[report.reason] || report.reason)} · ${escapeHtml(new Date(report.createdAt).toLocaleString("cs-CZ"))}</div>
        ${report.photo ? `<div class="node"><a href="../../?node=${encodeURIComponent(report.photo.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>` : ""}
        ${report.photo?.caption ? `<div class="author">${escapeHtml(report.photo.caption)}</div>` : ""}
        ${report.message ? `<p>${escapeHtml(report.message)}</p>` : ""}
        ${report.contact ? `<div class="contact">Kontakt: ${escapeHtml(report.contact)}</div>` : ""}
        <div class="actions">${actions}</div>
      </div>
    </li>`;
  }).join("");
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fotky nodů</title>
<style>
body { margin:0; padding:24px; background:#e9e8e1; color:#182820; font:14px/1.5 Manrope, system-ui, sans-serif; }
h1 { font-size:18px; margin:0 0 4px; }
.count { color:#667b70; font-size:12px; margin-bottom:12px; }
.tabs { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
.tabs a { padding:5px 10px; border:1px solid rgba(30,65,49,.2); border-radius:6px; color:#49665b; text-decoration:none; font-size:12px; }
.tabs a.active { color:#fff; background:#078e62; border-color:#078e62; }
ul { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
li.photo { display:flex; gap:12px; background:#fff; border:1px solid rgba(30,65,49,.16); border-radius:10px; padding:10px; }
li.photo.hidden { opacity:.55; }
.thumb { flex:0 0 150px; width:150px; height:110px; display:block; border-radius:8px; overflow:hidden; background:#f1f5f3; }
.thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.body { min-width:0; flex:1; }
.meta { color:#667b70; font:11px "DM Mono", monospace; margin-bottom:4px; }
.node { font-weight:700; }
.node a { color:#182820; text-decoration:none; }
.author { color:#49665b; font-size:12px; }
.contact { color:#49665b; font-size:12px; }
p { margin:4px 0; white-space:pre-wrap; }
.actions { display:flex; gap:10px; margin-top:6px; }
.actions a { font-size:12px; text-decoration:none; }
.approve { color:#078e62; }
.resolve { color:#078e62; }
.hide { color:#b27616; }
.delete { color:#c0392b; }
.missing { color:#667b70; font-size:12px; }
.thumb.missing { border:1px dashed rgba(30,65,49,.2); }
.empty { color:#667b70; }
</style>
</head>
<body>
<h1>Fotky nodů</h1>
<div class="count">${status === "reports" ? `${reports.length} žádostí` : `${entries.length} fotek`} (nejnovější první)</div>
<nav class="tabs">${tabs}</nav>
${status === "reports"
  ? (reports.length ? `<ul>${reportRows}</ul>` : '<p class="empty">Žádné otevřené žádosti.</p>')
  : (entries.length ? `<ul>${rows}</ul>` : '<p class="empty">Žádné fotky v této kategorii.</p>')}
</body>
</html>`;
}

function cachedNodeByKey(key) {
  if (!nodesCache?.body) return null;
  try {
    const wanted = String(key || "").toLowerCase();
    const data = JSON.parse(nodesCache.body);
    return (data.nodes || []).find((node) => String(node.public_key || "").toLowerCase() === wanted) || null;
  } catch {
    return null;
  }
}

function photoNodeNames() {
  const result = new Map();
  if (!nodesCache?.body) return result;
  try {
    const data = JSON.parse(nodesCache.body);
    for (const node of data.nodes || []) {
      const key = String(node.public_key || "").toLowerCase();
      if (key) result.set(key, node.name || key.slice(0, 8));
    }
  } catch {}
  return result;
}

function notifyTelegram(text) {
  if (!telegramNotifier.enabled) return;
  void telegramNotifier.send(text, { silent: telegramSilent }).catch((error) => {
    console.error(`Telegram notification failed: ${error.message}`);
  });
}

function telegramAdminUrl(path) {
  if (!telegramAdminLink) return null;
  if (path.startsWith("/api/feedback")) return `${publicBaseUrl}/admin/feedback`;
  if (path.startsWith("/api/node-info")) return `${publicBaseUrl}/admin/node-info`;
  if (path.startsWith("/admin/")) return `${publicBaseUrl}${path}`;
  if (path.endsWith("/reports")) return `${publicBaseUrl}/admin/photos?status=reports`;
  if (path.endsWith("/approved")) return `${publicBaseUrl}/admin/photos?status=approved`;
  return `${publicBaseUrl}/admin/photos`;
}

const photoNotificationBatches = new Map();

function notifyNewPhotos(photos) {
  if (!telegramNotifier.enabled || !telegramNotifyPhotos || !photos?.length) return;
  const photosToNotify = photos.slice(0, 5);
  const first = photosToNotify[0];
  const name = photoNodeNames().get(first.nodeKey) || first.nodeKey.slice(0, 8);
  const stats = photoStore.stats();
  const published = photosToNotify.every((photo) => photo.status === "approved");
  const lines = [
    photosToNotify.length === 1
      ? (published ? "📷 Nová fotka byla zveřejněna" : "📷 Nová fotka čeká na schválení")
      : (published ? "📷 Nové fotky byly zveřejněny" : "📷 Nové fotky čekají na schválení"),
    `Nod: ${name}`,
  ];
  if (photosToNotify.length > 1) lines.push(`Počet: ${photosToNotify.length}`);
  if (first.caption) lines.push(`Popis: ${first.caption}`);
  const author = photosToNotify.find((photo) => photo.author)?.author;
  if (author) lines.push(`Autor: ${author}`);
  if (published) lines.push("Fotky můžeš zkontrolovat a případně smazat v administraci.");
  else lines.push(`Čeká na schválení: ${stats.pending}`);
  const url = telegramAdminUrl(published ? "/api/photos/approved" : "/api/photos/view");
  if (url) lines.push(url);
  notifyTelegram(lines.join("\n"));
}

function notifyNewPhoto(photo) {
  notifyNewPhotos([photo]);
}

function flushPhotoNotificationBatch(batchId) {
  const batch = photoNotificationBatches.get(batchId);
  if (!batch) return;
  clearTimeout(batch.timer);
  photoNotificationBatches.delete(batchId);
  notifyNewPhotos(batch.photos);
}

function queueNewPhotoNotification(photo, batchId, batchSize) {
  if (!telegramNotifier.enabled || !telegramNotifyPhotos) return;
  if (!batchId || batchSize <= 1 || photoNotificationBatches.size >= 100) {
    notifyNewPhoto(photo);
    return;
  }
  let batch = photoNotificationBatches.get(batchId);
  if (!batch) {
    batch = { photos: [], size: Math.min(5, batchSize), timer: null };
    photoNotificationBatches.set(batchId, batch);
  }
  batch.photos.push(photo);
  if (batch.photos.length >= batch.size) {
    flushPhotoNotificationBatch(batchId);
    return;
  }
  clearTimeout(batch.timer);
  batch.timer = setTimeout(() => flushPhotoNotificationBatch(batchId), 3_000);
  batch.timer.unref?.();
}

const PHOTO_REPORT_REASONS = {
  inappropriate: "Nevhodný obsah",
  other: "Jiné",
  owner: "Moje fotka",
  privacy: "Soukromí",
};

function notifyNewReport({ contact, message, photo, reason }) {
  if (!telegramNotifier.enabled || !telegramNotifyReports || !photo) return;
  const name = photoNodeNames().get(photo.nodeKey) || photo.nodeKey.slice(0, 8);
  const lines = [
    "🚩 Žádost o smazání fotky",
    `Nod: ${name}`,
    `Důvod: ${PHOTO_REPORT_REASONS[reason] || reason}`,
  ];
  if (message) lines.push(`Zpráva: ${message}`);
  if (contact) lines.push(`Kontakt: ${contact}`);
  lines.push(`Otevřené žádosti: ${photoStore.openReportCount()}`);
  const url = telegramAdminUrl("/api/photos/reports");
  if (url) lines.push(url);
  notifyTelegram(lines.join("\n"));
}

function notifyNodeInfo(info, status = "published") {
  if (!telegramNotifier.enabled || !telegramNotifyNodeInfo || !info) return;
  const name = photoNodeNames().get(info.nodeKey) || info.nodeKey.slice(0, 8);
  const text = String(info.text || "");
  const preview = text.length > 320 ? `${text.slice(0, 320)}…` : text;
  const lines = [
    status === "pending"
      ? "📝 Změna uživatelského info čeká na schválení"
      : "📝 Uživatelské info nodu bylo zveřejněno",
    `Nod: ${name}`,
  ];
  if (info.author) lines.push(`Autor: ${info.author}`);
  lines.push(preview);
  const url = telegramAdminUrl("/api/node-info");
  if (url) lines.push(url);
  notifyTelegram(lines.join("\n"));
}

function notifyNewComment({ author, nodeKey, text }) {
  if (!telegramNotifier.enabled || !telegramNotifyComments) return;
  const name = photoNodeNames().get(nodeKey) || nodeKey.slice(0, 8);
  const lines = [
    "💬 Nový komentář k nodu",
    `Nod: ${name}`,
  ];
  if (author) lines.push(`Autor: ${author}`);
  lines.push(text.length > 500 ? `${text.slice(0, 500)}…` : text);
  const url = telegramAdminUrl("/admin/comments");
  if (url) lines.push(url);
  notifyTelegram(lines.join("\n"));
}

function notifyNewFeedback({ category, isPublic, message, name }) {
  if (!telegramNotifier.enabled || !telegramNotifyFeedback) return;
  const categoryLabel = { bug: "Chyba", idea: "Návrh", other: "Vzkaz" }[category] || category;
  const lines = [
    "💬 Nová zpráva v knize návštěv",
    `Typ: ${categoryLabel}`,
    `Zveřejněná: ${isPublic ? "ano" : "ne"}`,
  ];
  if (name) lines.push(`Jméno: ${name}`);
  lines.push(`Zpráva: ${message}`);
  const url = telegramAdminUrl("/api/feedback/view");
  if (url) lines.push(url);
  notifyTelegram(lines.join("\n"));
}

function clientIp(request) {
  const peer = request.socket?.remoteAddress || "";
  const trustedPeer = peer === "127.0.0.1"
    || peer === "::1"
    || peer === "::ffff:127.0.0.1"
    || process.env.TRUST_PROXY === "1";
  const forwarded = request.headers["x-forwarded-for"];
  if (trustedPeer && typeof forwarded === "string" && forwarded) {
    const last = forwarded.split(",").at(-1).trim();
    if (last) return last;
  }
  return peer || "unknown";
}

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

function toStoreRow(packet, now) {
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

function historyRowToPacket(row) {
  const iso = new Date(row.observed_at).toISOString();
  return {
    decoded_json: row.decoded_json,
    first_seen: iso,
    hash: row.hash,
    latest: iso,
    observer_iata: row.observer_iata,
    observer_id: row.observer_id,
    observer_name: row.observer_name,
    path_hash_bytes: row.path_hash_bytes,
    path_json: row.path_json,
    payload_type: row.payload_type,
    resolved_path: row.resolved_path,
    route_type: row.route_type,
    rssi: row.rssi,
    scope_name: row.scope_name,
    snr: row.snr,
    timestamp: iso,
  };
}

function closePacketStream(client) {
  packetStreams.delete(client);
  client.response.off("drain", client.onDrain);
  if (!client.response.writableEnded) client.response.end();
}

function dropPacketStream(client) {
  packetStreams.delete(client);
  client.response.off("drain", client.onDrain);
  client.response.destroy();
}

function writePacketStream(client, payload) {
  const { response } = client;
  const payloadBytes = Buffer.byteLength(payload);
  if (
    response.destroyed
    || response.writableEnded
    || client.blocked
    || response.writableLength + payloadBytes > maxStreamBufferBytes
  ) {
    dropPacketStream(client);
    return false;
  }

  if (!response.write(payload)) {
    client.blocked = true;
    response.once("drain", client.onDrain);
    return false;
  }
  return true;
}

function sendStreamEvent(client, event, data) {
  return writePacketStream(client, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of packetStreams) writePacketStream(client, payload);
}

function statusPayload() {
  return { build: currentBuild(), connected: mqttConnected, time: Date.now(), viewers: packetStreams.size };
}

function statBytes(path) {
  let total = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      total += statSync(`${path}${suffix}`).size;
    } catch {}
  }
  return total;
}

function cacheHealth(entry, softTtlMs) {
  if (!entry) return { ageSec: null, present: false, stale: true };
  const at = Number(entry.at || 0);
  const ageMs = Math.max(0, Date.now() - at);
  return {
    ageSec: Math.round(ageMs / 1000),
    present: true,
    stale: !at || ageMs > softTtlMs,
  };
}

function systemDiskUsage() {
  try {
    const stats = statfsSync(process.cwd());
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return {
      free,
      total,
      usedPercent: total > 0 ? ((total - free) / total) * 100 : 0,
    };
  } catch {
    return null;
  }
}

function certificateDays(host) {
  return new Promise((resolve) => {
    const socket = connectTls({ host, port: 443, servername: host, rejectUnauthorized: false });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(8_000, () => finish(null));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      const expires = Date.parse(certificate?.valid_to || "");
      finish(Number.isFinite(expires) ? Math.floor((expires - Date.now()) / 86_400_000) : null);
    });
    socket.once("error", () => finish(null));
  });
}

async function checkOperationalAlerts() {
  if (!monitorAlertsEnabled) return;
  const issues = [];
  if (mqttEnabled && !mqttConnected) {
    issues.push("MQTT je odpojené");
  } else if (mqttEnabled && lastMqttPacketAt && Date.now() - lastMqttPacketAt > monitorPacketAgeSec * 1000) {
    issues.push(`z MQTT nepřišel paket ${Math.round((Date.now() - lastMqttPacketAt) / 60_000)} min`);
  }
  const disk = systemDiskUsage();
  if (disk && disk.usedPercent >= monitorDiskPercent) {
    issues.push(`disk je zaplněný z ${disk.usedPercent.toFixed(0)} % (volné ${(disk.free / 1e9).toFixed(1)} GB)`);
  }
  for (const url of monitorUrls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(monitorTimeoutMs), headers: { "User-Agent": "meshcore-monitor/1" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) issues.push(`${url} vrací HTTP ${response.status}`);
      else if (data.status && data.status !== "ok") issues.push(`${url} hlásí ${data.status}`);
    } catch {
      issues.push(`${url} není dostupné`);
    }
  }
  const hosts = [...new Set(monitorUrls
    .filter((value) => value.startsWith("https://"))
    .map((value) => { try { return new URL(value).hostname; } catch { return null; } })
    .filter(Boolean))];
  for (const host of hosts) {
    const days = await certificateDays(host);
    if (days != null && days < 14) issues.push(`TLS certifikát ${host} vyprší za ${days} dní`);
  }
  if (!issues.length) {
    monitorFailureStreak = 0;
    if (monitorAlertKey) notifyTelegram("✅ Monitoring: všechny kontroly jsou v pořádku.");
    monitorAlertKey = "";
    monitorAlertedAt = 0;
    return;
  }
  monitorFailureStreak += 1;
  if (monitorFailureStreak < monitorFailureThreshold) return;
  const key = issues.join("|");
  if (key === monitorAlertKey && Date.now() - monitorAlertedAt < monitorRepeatMs) return;
  monitorAlertKey = key;
  monitorAlertedAt = Date.now();
  notifyTelegram(`⚠️ Monitoring\n${issues.map((issue) => `• ${issue}`).join("\n")}`);
}

function healthPayload() {
  const now = Date.now();
  const nodes = cacheHealth(nodesCache, nodesSoftTtlMs);
  const stats = cacheHealth(statsCache, statsSoftTtlMs);
  const degraded = (mqttEnabled && !mqttConnected) || nodes.stale;
  return {
    status: degraded ? "degraded" : "ok",
    build: currentBuild(),
    time: now,
    uptimeSec: Math.floor((now - serverStartedAt) / 1000),
    upstream,
    mqtt: {
      enabled: mqttEnabled,
      connected: mqttConnected,
      connectedForSec: mqttConnectedSince ? Math.floor((now - mqttConnectedSince) / 1000) : null,
      reconnects: mqttReconnects,
      lastPacketAgeSec: lastMqttPacketAt ? Math.floor((now - lastMqttPacketAt) / 1000) : null,
    },
    streams: packetStreams.size,
    caches: {
      elevation: elevationCache.size,
      nodes,
      resolve: resolveCache.size,
      stats,
      terrain: terrainCache.size,
    },
    packets: {
      bufferedRecent: recentPackets.values(now).length,
      distinct24h: packetStore.countDistinctSince(now - 24 * 60 * 60 * 1000),
      stored: packetStore.count(),
    },
    photos: photoStore.stats(),
    notifications: { telegram: telegramNotifier.enabled },
    databases: {
      feedback: { bytes: statBytes(feedbackDbPath) },
      packets: { bytes: statBytes(packetDbPath) },
      scores: { bytes: statBytes(scoreDbPath) },
      visits: { bytes: statBytes(visitsDbPath) },
    },
  };
}

function broadcastStatus() {
  broadcast("status", statusPayload());
}

const mqttUrl = process.env.MQTT_URL;
const mqttEnabled = Boolean(mqttUrl && process.env.MQTT_USERNAME && process.env.MQTT_PASSWORD);
if (mqttEnabled) {
  const MQTT_KEEPALIVE_S = Math.min(300, Math.max(10, Number(process.env.MQTT_KEEPALIVE || 30)));
  const MQTT_RECONNECT_MS = Math.max(1_000, Number(process.env.MQTT_RECONNECT_MS || 3_000));
  const MQTT_RECONNECT_MAX_MS = Math.max(MQTT_RECONNECT_MS, Number(process.env.MQTT_RECONNECT_MAX_MS || 60_000));
  const MQTT_STABLE_MS = 30_000;
  const MQTT_JITTER = 0.2;
  let mqttReconnectDelay = MQTT_RECONNECT_MS;
  let mqttReconnectTimer = null;
  let mqttConnectedAt = 0;
  const scheduleMqttReconnect = () => {
    if (mqttReconnectTimer) return;
    mqttReconnects += 1;
    const jitter = 1 - MQTT_JITTER + Math.random() * MQTT_JITTER * 2;
    const delay = Math.round(mqttReconnectDelay * jitter);
    console.log(`MQTT reconnect in ${delay} ms`);
    mqttReconnectTimer = setTimeout(() => {
      mqttReconnectTimer = null;
      mqttClient.reconnect();
    }, delay);
    mqttReconnectDelay = Math.min(mqttReconnectDelay * 2, MQTT_RECONNECT_MAX_MS);
  };
  const mqttClient = mqtt.connect(mqttUrl, {
    clean: true,
    clientId: `meshcore-map-${Math.random().toString(16).slice(2)}`,
    connectTimeout: 10_000,
    keepalive: MQTT_KEEPALIVE_S,
    password: process.env.MQTT_PASSWORD,
    protocolVersion: 4,
    reconnectPeriod: 0,
    username: process.env.MQTT_USERNAME,
  });
  mqttClient.on("connect", () => {
    console.log("MQTT connected");
    mqttConnectedAt = Date.now();
    mqttConnectedSince = mqttConnectedAt;
    mqttReconnectDelay = MQTT_RECONNECT_MS;
    mqttConnected = true;
    const topic = process.env.MQTT_TOPIC || "meshcore/+/+/packets";
    mqttClient.subscribe(topic, { qos: 0 }, (error) => {
      if (error) console.error(`MQTT subscribe failed: ${error.message}`);
      else console.log(`MQTT subscribed to ${topic}`);
    });
    broadcastStatus();
  });
  mqttClient.on("close", () => {
    mqttConnected = false;
    mqttConnectedSince = 0;
    if (mqttConnectedAt && Date.now() - mqttConnectedAt >= MQTT_STABLE_MS) {
      mqttReconnectDelay = MQTT_RECONNECT_MS;
    }
    mqttConnectedAt = 0;
    broadcastStatus();
    scheduleMqttReconnect();
  });
  let lastMqttErrorLog = 0;
  let lastMqttErrorMessage = "";
  mqttClient.on("error", (error) => {
    const now = Date.now();
    if (error.message !== lastMqttErrorMessage || now - lastMqttErrorLog > 5 * 60 * 1000) {
      console.error(`MQTT error: ${error.message}`);
      lastMqttErrorMessage = error.message;
      lastMqttErrorLog = now;
    }
  });
  mqttClient.on("message", (topic, message) => {
    try {
      const packet = parseMqttPacket(topic, message);
      if (packet?.hash) {
        lastMqttPacketAt = Date.now();
        recentPackets.add(packet);
        broadcast("packet", packet);
      }
    } catch (error) {
      console.error(`Invalid MQTT packet on ${topic}: ${error.message}`);
    }
  });
} else {
  console.warn("MQTT is disabled: configure MQTT_URL, MQTT_USERNAME and MQTT_PASSWORD");
}

setInterval(() => {
  for (const client of packetStreams) writePacketStream(client, ": keepalive\n\n");
}, 20_000).unref();

// Pravidelný status: klienti si obnoví čas (kvůli posunu hodin) i počet diváků.
setInterval(broadcastStatus, 60_000).unref();

let metricsCollectionActive = false;
async function collectNodeMetrics() {
  if (metricsCollectionActive) return;
  metricsCollectionActive = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  timeout.unref();
  try {
    const response = await fetch(`${upstream}/api/nodes?limit=2000`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CoreScope returned HTTP ${response.status}`);
    const data = await response.json();
    storeNodesCache(data);
    const recorded = metricsStore.recordNodes(Array.isArray(data.nodes) ? data.nodes : []);
    console.log(`Node metrics updated: ${recorded} hourly samples`);
  } catch (error) {
    console.error(`Node metrics update failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    metricsCollectionActive = false;
  }
}

void collectNodeMetrics();
setInterval(collectNodeMetrics, metricsCollectionMs).unref();

let statsCollectionActive = false;
async function collectStats() {
  if (statsCollectionActive) return;
  statsCollectionActive = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), statsTimeoutMs);
  timeout.unref();
  try {
    const response = await fetch(`${upstream}/api/stats`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CoreScope returned HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const data = JSON.parse(body.toString("utf8"));
    metricsStore.recordStats(data);
    storeStatsCache(body, response.headers.get("content-type"));
  } catch (error) {
    console.error(`Stats collection failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    statsCollectionActive = false;
  }
}

if (statsCollectMs > 0) {
  void collectStats();
  setInterval(collectStats, statsCollectMs).unref();
}

function mergeStoreRows(resolvedPackets, scopedPackets, now) {
  const rows = new Map();
  for (const packet of resolvedPackets) {
    const row = toStoreRow(packet, now);
    if (row) rows.set(`${row.hash}:${row.observer_id}`, row);
  }
  for (const packet of scopedPackets) {
    const scope = packet.scope_name;
    if (!scope) continue;
    const key = `${String(packet.hash || "")}:${String(packet.observer_id || "")}`;
    const existing = rows.get(key);
    if (existing) {
      existing.scope_name = scope;
      continue;
    }
    const row = toStoreRow(packet, now);
    if (row) {
      row.scope_name = scope;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

let packetCollectionActive = false;
async function collectPackets() {
  if (packetCollectionActive) return;
  packetCollectionActive = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  timeout.unref();
  try {
    const headers = { Accept: "application/json" };
    const scopeSince = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const [resolvedResponse, scopedResponse] = await Promise.all([
      fetch(`${upstream}/api/packets?limit=2000`, { headers, signal: controller.signal }),
      fetch(`${upstream}/api/packets?limit=4000&since=${encodeURIComponent(scopeSince)}`, { headers, signal: controller.signal }),
    ]);
    if (!resolvedResponse.ok) throw new Error(`CoreScope returned HTTP ${resolvedResponse.status}`);
    const resolvedData = await resolvedResponse.json();
    const scopedData = scopedResponse.ok ? await scopedResponse.json() : { packets: [] };
    const now = Date.now();
    const rows = mergeStoreRows(
      Array.isArray(resolvedData.packets) ? resolvedData.packets : [],
      Array.isArray(scopedData.packets) ? scopedData.packets : [],
      now,
    );
    const stored = packetStore.record(rows);
    packetStore.prune(now);
    console.log(`Packet routes updated: ${stored} stored, ${packetStore.count()} total`);
  } catch (error) {
    console.error(`Packet route update failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    packetCollectionActive = false;
  }
}

void collectPackets();
setInterval(collectPackets, packetCollectionMs).unref();

visitStore.prune();
setInterval(() => visitStore.prune(), 24 * 60 * 60 * 1000).unref();

function elevationKey(lat, lon) {
  return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
}

function elevationCacheGet(key) {
  if (!elevationCache.has(key)) return undefined;
  const value = elevationCache.get(key);
  elevationCache.delete(key);
  elevationCache.set(key, value);
  return value;
}

function elevationCacheSet(key, value) {
  if (elevationCache.has(key)) elevationCache.delete(key);
  elevationCache.set(key, value);
  while (elevationCache.size > elevationCacheLimit) {
    elevationCache.delete(elevationCache.keys().next().value);
  }
}

async function fetchOpenMeteoElevations(chunk, signal) {
  const params = new URLSearchParams({
    latitude: chunk.map((point) => Number(point.lat).toFixed(5)).join(","),
    longitude: chunk.map((point) => Number(point.lon).toFixed(5)).join(","),
  });
  const response = await fetch(`${elevationUpstream}?${params}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.elevation)) throw new Error("Open-Meteo invalid response");
  return data.elevation;
}

async function fetchOpenElevationElevations(chunk, signal) {
  const response = await fetch(elevationFallbackUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: chunk.map((point) => ({ latitude: Number(point.lat), longitude: Number(point.lon) })),
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Open-Elevation HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.results)) throw new Error("Open-Elevation invalid response");
  return data.results.map((row) => (row?.elevation == null ? null : row.elevation));
}

async function fetchElevationChunk(chunk, signal) {
  try {
    return await fetchOpenMeteoElevations(chunk, signal);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return fetchOpenElevationElevations(chunk, signal);
  }
}

async function resolveElevations(points, signal) {
  const elevations = new Array(points.length);
  const missing = [];
  points.forEach((point, index) => {
    const cached = elevationCacheGet(elevationKey(point.lat, point.lon));
    if (Number.isFinite(cached)) elevations[index] = cached;
    else missing.push(index);
  });
  for (let offset = 0; offset < missing.length; offset += elevationBatchSize) {
    const indices = missing.slice(offset, offset + elevationBatchSize);
    const chunk = indices.map((index) => points[index]);
    const values = await fetchElevationChunk(chunk, signal);
    indices.forEach((index, slot) => {
      const value = values[slot] == null ? NaN : Number(values[slot]);
      if (Number.isFinite(value)) {
        elevations[index] = value;
        elevationCacheSet(elevationKey(points[index].lat, points[index].lon), value);
      } else {
        elevations[index] = null;
      }
    });
  }
  return elevations;
}

function queueElevation(task) {
  const run = elevationQueue.then(task, task);
  elevationQueue = run.catch(() => {});
  return run;
}

function terrainCacheGet(key) {
  const entry = terrainCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > terrainCacheTtlMs) {
    terrainCache.delete(key);
    return null;
  }
  terrainCache.delete(key);
  terrainCache.set(key, entry);
  return entry;
}

function terrainCacheSet(key, body, contentType) {
  terrainCache.delete(key);
  terrainCache.set(key, { body, contentType, at: Date.now() });
  while (terrainCache.size > terrainCacheLimit) {
    terrainCache.delete(terrainCache.keys().next().value);
  }
}

function checkTerrainRate(ip) {
  const now = Date.now();
  const windowStart = now - terrainRateWindowMs;
  const stamps = (terrainRate.get(ip) || []).filter((stamp) => stamp > windowStart);
  if (stamps.length >= terrainRateLimit) {
    const retryAfter = Math.max(1, Math.ceil((stamps[0] + terrainRateWindowMs - now) / 1000));
    terrainRate.set(ip, stamps);
    return { ok: false, retryAfter };
  }
  stamps.push(now);
  terrainRate.set(ip, stamps);
  if (terrainRate.size > 5000) {
    for (const [key, value] of terrainRate) {
      if (!value.some((stamp) => stamp > windowStart)) terrainRate.delete(key);
    }
  }
  return { ok: true, retryAfter: 0 };
}

async function fetchTerrainTile(zoom, x, y) {
  const key = `${zoom}/${x}/${y}`;
  const cached = terrainCacheGet(key);
  if (cached) return cached;
  if (terrainInFlight.has(key)) return terrainInFlight.get(key);
  const task = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), terrainTimeoutMs);
    timeout.unref();
    try {
      const response = await fetch(`${terrainUpstream}/${zoom}/${x}/${y}.png`, {
        signal: controller.signal,
        headers: { "User-Agent": "meshcore-live-map/1.0" },
      });
      if (!response.ok) {
        const error = new Error(`Terrain upstream HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length || body.length > 512 * 1024) {
        const error = new Error("Invalid terrain tile");
        error.status = 502;
        throw error;
      }
      const contentType = response.headers.get("content-type") || "image/png";
      terrainCacheSet(key, body, contentType);
      return { body, contentType };
    } finally {
      clearTimeout(timeout);
    }
  })();
  terrainInFlight.set(key, task);
  try {
    return await task;
  } finally {
    terrainInFlight.delete(key);
  }
}


const adminLoginAttempts = new Map();

function parseCookieHeader(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function adminSessionValid(request) {
  if (!adminPassword || !adminSessionSecret) return false;
  const token = parseCookieHeader(request.headers.cookie).mc_admin;
  if (!token) return false;
  const [expires, signature] = String(token).split(".");
  if (!/^\d+$/.test(expires) || !signature || Number(expires) <= Date.now()) return false;
  const expected = createHmac("sha256", adminSessionSecret).update(expires).digest("base64url");
  return safeEqualText(signature, expected);
}

function createAdminSessionToken(now = Date.now()) {
  const expires = String(now + adminSessionTtlMs);
  const signature = createHmac("sha256", adminSessionSecret).update(expires).digest("base64url");
  return `${expires}.${signature}`;
}

function adminCookie(request, value, maxAge = Math.floor(adminSessionTtlMs / 1000)) {
  const secure = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https"
    || Boolean(request.socket?.encrypted);
  return `mc_admin=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict;${secure ? " Secure;" : ""} Max-Age=${maxAge}`;
}

function checkAdminLogin(ip, now = Date.now()) {
  const windowMs = 15 * 60 * 1000;
  const stamps = (adminLoginAttempts.get(ip) || []).filter((stamp) => stamp > now - windowMs);
  if (stamps.length >= 10) {
    adminLoginAttempts.set(ip, stamps);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((stamps[0] + windowMs - now) / 1000)) };
  }
  stamps.push(now);
  adminLoginAttempts.set(ip, stamps);
  if (adminLoginAttempts.size > 5000) {
    for (const [key, value] of adminLoginAttempts) {
      if (!value.some((stamp) => stamp > now - windowMs)) adminLoginAttempts.delete(key);
    }
  }
  return { ok: true };
}

function sameOriginRequest(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function safeAdminNext(value) {
  const next = String(value || "");
  const prefix = adminBasePath;
  return (next === prefix || next.startsWith(`${prefix}/`)) && !next.startsWith("//")
    ? next
    : prefix;
}

async function readAdminForm(request) {
  try {
    return new URLSearchParams(await readBody(request, 8192));
  } catch {
    return null;
  }
}

function redirectAdmin(response, location) {
  response.writeHead(303, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function renderAdminLogin({ error = "", next = adminBasePath, retryAfter = 0 } = {}) {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Administrace · MeshCore CZ</title>
<style>
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:#e9e8e1; color:#182820; font:14px/1.5 Manrope, system-ui, sans-serif; }
.card { width:min(390px, 100%); padding:26px; border:1px solid rgba(30,65,49,.16); border-radius:16px; background:#fffef9; box-shadow:0 18px 50px rgba(20,42,32,.12); }
.brand { color:#078e62; font:800 18px/1.1 Manrope, system-ui, sans-serif; letter-spacing:.02em; }
.brand span { color:#87978f; font:10px "DM Mono", monospace; letter-spacing:.08em; vertical-align:2px; margin-left:5px; }
h1 { margin:22px 0 4px; font-size:22px; }
p { margin:0 0 16px; color:#667b70; }
label { display:flex; flex-direction:column; gap:6px; color:#49665b; font:10px "DM Mono", monospace; }
input { width:100%; padding:10px 11px; border:1px solid rgba(30,65,49,.22); border-radius:8px; color:#182820; background:#fff; font:14px Manrope, system-ui, sans-serif; }
input:focus { outline:2px solid #078e62; outline-offset:1px; }
button { width:100%; margin-top:14px; padding:10px 14px; border:1px solid #078e62; border-radius:8px; color:#fff; background:#078e62; font:700 13px Manrope, system-ui, sans-serif; cursor:pointer; }
button:hover { background:#067a54; }
.error { padding:8px 10px; border-radius:7px; color:#a32920; background:#fbeceb; font-size:12px; }
.hint { margin:14px 0 0; font:10px/1.5 "DM Mono", monospace; color:#87978f; }
.back { display:inline-block; margin-top:18px; color:#49665b; font-size:12px; text-decoration:none; }
.back:hover { color:#078e62; }
</style>
</head>
<body>
<main class="card">
  <div class="brand">MESHCORE <span>ADMIN</span></div>
  <h1>Administrace</h1>
  <p>Zadejte heslo pro přístup ke správě fotek a zpětné vazby.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="${adminPath("/login")}">
    <input type="hidden" name="next" value="${escapeHtml(next)}" />
    <label>Heslo
      <input type="password" name="password" autocomplete="current-password" required autofocus />
    </label>
    <button type="submit">Přihlásit se</button>
  </form>
  ${retryAfter ? `<p class="hint">Další pokus za ${Math.ceil(retryAfter / 60)} min.</p>` : ""}
  <a class="back" href="${sitePath("/")}">← Zpět na mapu</a>
</main>
</body>
</html>`;
}

function adminLayout({ active = "", content = "", title = "Administrace" }) {
  const links = [
    ["dashboard", adminPath(), "Přehled"],
    ["photos", adminPath("/photos"), "Fotky"],
    ["reports", adminPath("/photos?status=reports"), "Žádosti"],
    ["feedback", adminPath("/feedback"), "Zpětná vazba"],
    ["comments", adminPath("/comments"), `Komentáře${commentStore.count() ? ` (${commentStore.count()})` : ""}`],
    ["nodeinfo", adminPath("/node-info"), `Info nodů${nodeInfoStore.pendingCount() ? ` (${nodeInfoStore.pendingCount()})` : ""}`],
    ...(repeaterImportEnabled ? [["import", adminPath("/repeater-import"), "Import z wiki"], ["sync", adminPath("/repeater-sync"), "Sync z wiki"], ["syncall", adminPath("/repeater-sync-all"), "Sync vše"]] : []),
  ].map(([key, href, label]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("");
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>${escapeHtml(title)} · MeshCore CZ</title>
<style>
* { box-sizing:border-box; }
body { margin:0; padding:0 0 40px; background:#e9e8e1; color:#182820; font:14px/1.5 Manrope, system-ui, sans-serif; }
header { display:flex; flex-wrap:wrap; align-items:center; gap:12px 18px; padding:14px 24px; border-bottom:1px solid rgba(30,65,49,.14); background:#fffef9; }
.brand { color:#078e62; font:800 16px/1.1 Manrope, system-ui, sans-serif; text-decoration:none; }
.brand span { color:#87978f; font:9px "DM Mono", monospace; letter-spacing:.08em; vertical-align:2px; margin-left:5px; }
nav { display:flex; flex-wrap:wrap; gap:4px; }
nav a { padding:6px 10px; border-radius:6px; color:#49665b; text-decoration:none; font-size:12px; }
nav a:hover { background:#f1f5f3; }
nav a.active { color:#fff; background:#078e62; }
.header-actions { display:flex; align-items:center; gap:12px; margin-left:auto; }
.header-actions a { color:#49665b; font-size:12px; text-decoration:none; }
.header-actions a:hover { color:#078e62; }
.logout { padding:6px 10px; border:1px solid rgba(30,65,49,.2); border-radius:6px; color:#49665b; background:#fff; font:12px Manrope, system-ui, sans-serif; cursor:pointer; }
.logout:hover { color:#a32920; border-color:#d9a6a2; }
main { width:min(1120px, 100%); margin:24px auto; padding:0 16px; }
h1 { margin:0 0 4px; font-size:22px; }
h2 { margin:0 0 12px; font-size:16px; }
.sub { margin:0 0 18px; color:#667b70; font-size:12px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(155px, 1fr)); gap:12px; margin-bottom:22px; }
.card { padding:14px 16px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fffef9; }
.card .label { margin-bottom:4px; color:#667b70; font:10px "DM Mono", monospace; text-transform:uppercase; letter-spacing:.04em; }
.card .value { font-size:22px; font-weight:800; line-height:1.15; }
.card .value.online { color:#078e62; }
.card .value.offline { color:#b27616; }
.card a { color:inherit; text-decoration:none; }
.card a:hover .value { color:#078e62; }
.card small { display:block; margin-top:4px; color:#87978f; font-size:11px; }
.split { display:grid; grid-template-columns:1.2fr .8fr; gap:18px; align-items:start; }
@media (max-width: 760px) { .split { grid-template-columns:1fr; } header { padding:12px 14px; } }
.panel { padding:16px 18px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fffef9; }
.panel + .panel { margin-top:16px; }
.tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
.tabs a { padding:5px 10px; border:1px solid rgba(30,65,49,.2); border-radius:6px; color:#49665b; text-decoration:none; font-size:12px; }
.tabs a.active { color:#fff; border-color:#078e62; background:#078e62; }
.list { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
.photo { display:flex; gap:12px; padding:10px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fff; }
.photo.hidden { opacity:.55; }
.thumb { flex:0 0 150px; width:150px; height:110px; display:block; overflow:hidden; border-radius:8px; background:#f1f5f3; }
.thumb img { display:block; width:100%; height:100%; object-fit:cover; }
.thumb.missing { border:1px dashed rgba(30,65,49,.2); }
.body { min-width:0; flex:1; }
.meta { margin-bottom:4px; color:#667b70; font:11px "DM Mono", monospace; }
.node { font-weight:700; }
.node a { color:#182820; text-decoration:none; }
.node a:hover { color:#078e62; }
.author, .contact { color:#49665b; font-size:12px; }
p { margin:4px 0; white-space:pre-wrap; }
.actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:8px; }
.actions button { padding:5px 10px; border:1px solid rgba(30,65,49,.2); border-radius:6px; background:#fff; font:12px Manrope, system-ui, sans-serif; cursor:pointer; }
.actions button:hover { border-color:#078e62; color:#078e62; }
.actions button.approve { color:#078e62; border-color:rgba(7,142,98,.45); }
.actions button.cover { color:#078e62; border-color:rgba(7,142,98,.45); }
.actions button.hide { color:#b27616; border-color:rgba(178,118,22,.4); }
.cover-badge { display:inline-block; margin-right:6px; padding:1px 6px; border-radius:999px; color:#078e62; background:rgba(7,142,98,.12); font:700 9px "DM Mono", monospace; letter-spacing:.04em; text-transform:uppercase; }
.admin-comment { padding:11px 13px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fff; }
.admin-comment .meta { margin-bottom:3px; color:#667b70; font:11px "DM Mono", monospace; }
.admin-comment .node a { color:#182820; text-decoration:none; }
.admin-comment .node a:hover { color:#078e62; }
.admin-comment p { margin:5px 0; white-space:pre-wrap; }
.sync-compare { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:10px 0; }
.sync-compare > div { min-width:0; padding:9px; border:1px solid rgba(30,65,49,.14); border-radius:8px; background:#fffef9; }
.sync-compare strong { display:block; margin-bottom:5px; color:#667b70; font:10px "DM Mono", monospace; text-transform:uppercase; }
.sync-compare pre { max-height:220px; margin:0; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.45 Manrope, system-ui, sans-serif; }
.sync-photos { display:grid; gap:5px; margin:6px 0 12px; padding:0; list-style:none; }
.sync-photos label, .sync-check { display:flex; align-items:center; gap:7px; font-size:12px; }
.sync-photos input, .sync-check input { accent-color:#078e62; }
.sync-all-list { margin:10px 0 14px; }
.sync-all-list li { padding:10px 12px; border:1px solid rgba(30,65,49,.14); border-radius:8px; background:#fff; }
.sync-all-list li + li { margin-top:7px; }
.sync-all-list .sync-check { display:flex; align-items:center; gap:8px; }
.sync-preview { max-height:180px; margin:5px 0 8px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:10px/1.4 "DM Mono", monospace; }
@media (max-width:700px) { .sync-compare { grid-template-columns:1fr; } }
.actions button.delete { color:#c0392b; border-color:rgba(192,57,43,.4); }
.actions a.edit { padding:5px 10px; border:1px solid rgba(7,142,98,.45); border-radius:6px; color:#078e62; background:#fff; font:12px Manrope, system-ui, sans-serif; text-decoration:none; }
.actions a.edit:hover { color:#fff; background:#078e62; }
.admin-edit-form { display:flex; flex-direction:column; gap:12px; max-width:760px; }
.admin-edit-form label { display:flex; flex-direction:column; gap:5px; color:#49665b; font:10px "DM Mono", monospace; }
.admin-edit-form input, .admin-edit-form textarea { width:100%; padding:9px 10px; border:1px solid rgba(30,65,49,.22); border-radius:7px; color:#182820; background:#fff; font:13px Manrope, system-ui, sans-serif; }
.admin-edit-form textarea { min-height:180px; resize:vertical; }
.feedback-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; }
.feedback-actions a, .feedback-actions button { padding:8px 13px; border:1px solid rgba(30,65,49,.2); border-radius:7px; color:#49665b; background:#fff; font:12px Manrope, system-ui, sans-serif; text-decoration:none; cursor:pointer; }
.feedback-actions button { color:#fff; border-color:#078e62; background:#078e62; }
.feedback-actions button:hover { background:#067a54; }
.empty { margin:0; color:#667b70; }
.feedback li { padding:12px 14px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fff; }
.feedback li.is-hidden { opacity:.55; }
.feedback .actions { margin-top:8px; }
.quick { display:flex; flex-wrap:wrap; gap:8px; }
.quick a { padding:7px 11px; border:1px solid rgba(7,142,98,.35); border-radius:7px; color:#078e62; background:#fff; text-decoration:none; font-size:12px; }
.quick a:hover { color:#fff; background:#078e62; }
</style>
</head>
<body>
<header>
  <a class="brand" href="${adminPath()}">MESHCORE <span>ADMIN</span></a>
  <nav>${links}</nav>
  <div class="header-actions">
    <a href="${sitePath("/")}" target="_blank" rel="noreferrer">Mapa ↗</a>
    <form method="post" action="${adminPath("/logout")}"><button class="logout" type="submit">Odhlásit</button></form>
  </div>
</header>
<main>
${content}
</main>
</body>
</html>`;
}

function adminDashboardPage() {
  const stats = photoStore.stats();
  const visits = visitStore.report(Date.now(), 14);
  const feedbackCount = feedbackStore.count();
  const commentCount = commentStore.count();
  const nodeInfoCount = nodeInfoStore.count();
  const nodeInfoPending = nodeInfoStore.pendingCount();
  const uptime = Math.floor(process.uptime());
  const uptimeLabel = `${Math.floor(uptime / 3600)} h ${Math.floor((uptime % 3600) / 60)} min`;
  return adminLayout({
    active: "dashboard",
    title: "Přehled",
    content: `
<h1>Přehled</h1>
<p class="sub">Stav administrace a rychlé odkazy.${photoAutoApprove ? " Fotky se zveřejňují automaticky a nové najdeš v sekci Fotky." : ""}</p>
<div class="cards">
  <div class="card"><div class="label">Fotky čekající</div><a href="${adminPath("/photos?status=pending")}"><div class="value">${formatAdminNumber(stats.pending)}</div></a><small>ke schválení</small></div>
  <div class="card"><div class="label">Otevřené žádosti</div><a href="${adminPath("/photos?status=reports")}"><div class="value">${formatAdminNumber(stats.reports)}</div></a><small>o smazání / nahlášení</small></div>
  <div class="card"><div class="label">Fotky celkem</div><a href="${adminPath("/photos?status=all")}"><div class="value">${formatAdminNumber(stats.total)}</div></a><small>${formatAdminNumber(stats.bytes)} B</small></div>
  <div class="card"><div class="label">Zpětná vazba</div><a href="${adminPath("/feedback")}"><div class="value">${formatAdminNumber(feedbackCount)}</div></a><small>uložených zpráv</small></div>
  <div class="card"><div class="label">Komentáře</div><a href="${adminPath("/comments")}"><div class="value">${formatAdminNumber(commentCount)}</div></a><small>u nodů</small></div>
  <div class="card"><div class="label">Info nodů</div><a href="${adminPath("/node-info")}"><div class="value">${formatAdminNumber(nodeInfoCount)}</div></a><small>${nodeInfoPending ? `${formatAdminNumber(nodeInfoPending)} změn ke schválení` : "uživatelských popisů"}</small></div>
  <div class="card"><div class="label">Dnes návštěv</div><div class="value">${formatAdminNumber(visits.today.visits)}</div><small>${formatAdminNumber(visits.today.uniqueVisitors)} unikátních · peak ${formatAdminNumber(visits.today.peakViewers)}</small></div>
  <div class="card"><div class="label">MQTT</div><div class="value ${mqttConnected ? "online" : "offline"}">${mqttConnected ? "online" : "offline"}</div><small>${packetStreams.size} připojených klientů</small></div>
</div>
<div class="split">
  <section class="panel">
    <h2>Rychlé akce</h2>
    <div class="quick">
      <a href="${adminPath("/photos?status=pending")}">Schvalovat fotky</a>
      <a href="${adminPath("/photos?status=reports")}">Řešit žádosti</a>
      <a href="${adminPath("/feedback")}">Projít zpětnou vazbu</a>
      <a href="${adminPath("/comments")}">Projít komentáře</a>
      <a href="${adminPath("/node-info")}">Kontrolovat info nodů</a>
      ${repeaterImportEnabled ? `<a href="${adminPath("/repeater-import")}">Import z meshcore.cz</a>` : ""}
      <a href="${sitePath("/api/health")}" target="_blank" rel="noreferrer">Health JSON</a>
    </div>
    <p class="sub" style="margin-top:16px; margin-bottom:0;">Provoz aplikace: ${escapeHtml(uptimeLabel)}.</p>
  </section>
  <section class="panel">
    <h2>Návštěvy</h2>
    <p class="sub" style="margin-bottom:8px;">Dnes: ${formatAdminNumber(visits.today.visits)} zobrazení, ${formatAdminNumber(visits.today.uniqueVisitors)} unikátních návštěvníků.</p>
    <p class="sub" style="margin-bottom:0;">Celkem: ${formatAdminNumber(visits.totals.visits)} zobrazení, peak ${formatAdminNumber(visits.totals.peakViewers)} diváků.</p>
  </section>
</div>`,
  });
}

function formatAdminNumber(value) {
  return new Intl.NumberFormat("cs-CZ").format(Number(value) || 0);
}

function adminPhotoRows(entries, names, status, covers = new Map()) {
  return entries.map((photo) => {
    const node = names.get(photo.nodeKey);
    const isCover = covers.get(photo.nodeKey) === photo.id;
    const nodeLabel = node ? `${node} · ${photo.nodeKey.slice(0, 8)}` : photo.nodeKey.slice(0, 16);
    const imageUrl = sitePath(`/api/photos/${encodeURIComponent(photo.id)}`);
    const actions = [
      photo.status !== "approved"
        ? '<button class="approve" name="action" value="approve" type="submit">Schválit</button>'
        : "",
      photo.status === "approved" && !isCover
        ? '<button class="cover" name="action" value="cover" type="submit">Nastavit jako náhled</button>'
        : "",
      photo.status !== "hidden"
        ? '<button class="hide" name="action" value="hide" type="submit">Skrýt</button>'
        : "",
      '<button class="delete" name="action" value="delete" type="submit">Smazat</button>',
    ].filter(Boolean).join("");
    return `
    <li class="photo ${escapeHtml(photo.status)}">
      <a class="thumb" href="${imageUrl}" target="_blank" rel="noreferrer"><img src="${imageUrl}" alt="" loading="lazy" /></a>
      <div class="body">
        <div class="meta">${isCover ? '<span class="cover-badge">Náhled</span>' : ""}${escapeHtml(photo.status)} · ${escapeHtml(new Date(photo.createdAt).toLocaleString("cs-CZ"))} · ${escapeHtml(photo.bytes)} B · ${photo.width || "?"}×${photo.height || "?"}</div>
        <div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(photo.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>
        ${photo.author ? `<div class="author">${escapeHtml(photo.author)}</div>` : ""}
        ${photo.caption ? `<p>${escapeHtml(photo.caption)}</p>` : ""}
        <form class="actions" method="post" action="${adminPath("/photos/moderate")}">
          <input type="hidden" name="id" value="${escapeHtml(photo.id)}" />
          <input type="hidden" name="status" value="${escapeHtml(status)}" />
          ${actions}
        </form>
      </div>
    </li>`;
  }).join("");
}

function adminPhotoPage(status) {
  const entries = status === "reports" ? [] : photoStore.listAdmin(status, 300);
  const reports = status === "reports" ? photoStore.listReports("open", 300) : [];
  const names = photoNodeNames();
  const covers = new Map(photoStore.listApprovedNodeCounts(10_000).map((node) => [node.nodeKey, node.coverId]));
  const stats = photoStore.stats();
  const labels = {
    all: "Vše",
    approved: "Schválené",
    hidden: "Skryté",
    pending: "Čekající",
    reports: `Žádosti${stats.reports ? ` (${stats.reports})` : ""}`,
  };
  const tabs = ["pending", "approved", "hidden", "all", "reports"].map((value) => {
    const active = status === value ? ' class="active"' : "";
    return `<a${active} href="${adminPath(`/photos?status=${value}`)}">${labels[value]}</a>`;
  }).join("");
  const reportReasons = {
    inappropriate: "Nevhodný obsah",
    other: "Jiné",
    owner: "Moje fotka",
    privacy: "Soukromí",
  };
  const reportRows = reports.map((report) => {
    const imageUrl = report.photo ? sitePath(`/api/photos/${encodeURIComponent(report.photo.id)}`) : null;
    const node = report.photo ? names.get(report.photo.nodeKey) : null;
    const nodeLabel = node ? `${node} · ${report.photo.nodeKey.slice(0, 8)}` : (report.photo ? report.photo.nodeKey.slice(0, 16) : report.photoId.slice(0, 16));
    const actions = [
      report.photo
        ? `<form class="actions" method="post" action="${adminPath("/photos/moderate")}">
             <input type="hidden" name="id" value="${escapeHtml(report.photoId)}" />
             <input type="hidden" name="status" value="reports" />
             <button class="delete" name="action" value="delete" type="submit">Smazat fotku</button>
           </form>`
        : '<span class="meta">Fotka už není dostupná</span>',
      `<form class="actions" method="post" action="${adminPath("/photos/moderate")}">
         <input type="hidden" name="report" value="${escapeHtml(report.id)}" />
         <input type="hidden" name="status" value="reports" />
         <button class="approve" name="action" value="dismiss" type="submit">Zamítnout žádost</button>
       </form>`,
    ].filter(Boolean).join("");
    return `
    <li class="photo report">
      ${imageUrl
        ? `<a class="thumb" href="${imageUrl}" target="_blank" rel="noreferrer"><img src="${imageUrl}" alt="" loading="lazy" /></a>`
        : '<div class="thumb missing"></div>'}
      <div class="body">
        <div class="meta">${escapeHtml(reportReasons[report.reason] || report.reason)} · ${escapeHtml(new Date(report.createdAt).toLocaleString("cs-CZ"))}</div>
        ${report.photo ? `<div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(report.photo.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>` : ""}
        ${report.message ? `<p>${escapeHtml(report.message)}</p>` : ""}
        ${report.contact ? `<div class="contact">Kontakt: ${escapeHtml(report.contact)}</div>` : ""}
        <div class="actions">${actions}</div>
      </div>
    </li>`;
  }).join("");
  return adminLayout({
    active: status === "reports" ? "reports" : "photos",
    title: "Fotky",
    content: `
<h1>Fotky</h1>
<p class="sub">${status === "reports" ? `${formatAdminNumber(reports.length)} otevřených žádostí` : `${formatAdminNumber(entries.length)} fotek v této kategorii`}.</p>
<nav class="tabs">${tabs}</nav>
${status === "reports"
  ? (reports.length ? `<ul class="list">${reportRows}</ul>` : '<p class="empty">Žádné otevřené žádosti.</p>')
  : (entries.length ? `<ul class="list">${adminPhotoRows(entries, names, status, covers)}</ul>` : '<p class="empty">Žádné fotky v této kategorii.</p>')}`,
  });
}

function adminCommentsPage() {
  const entries = commentStore.listAdmin(300);
  const names = photoNodeNames();
  const rows = entries.map((comment) => {
    const name = names.get(comment.nodeKey) || comment.nodeKey.slice(0, 16);
    return `
    <li class="admin-comment">
      <div class="meta">${escapeHtml(new Date(comment.createdAt).toLocaleString("cs-CZ"))}${comment.author ? ` · ${escapeHtml(comment.author)}` : ""}</div>
      <div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(comment.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a></div>
      <p>${escapeHtml(comment.text)}</p>
      <form class="actions" method="post" action="${adminPath("/comments/delete")}">
        <input type="hidden" name="id" value="${escapeHtml(comment.id)}" />
        <button class="delete" type="submit">Smazat komentář</button>
      </form>
    </li>`;
  }).join("");
  return adminLayout({
    active: "comments",
    title: "Komentáře",
    content: `
<h1>Komentáře</h1>
<p class="sub">${formatAdminNumber(entries.length)} komentářů. Zveřejňují se ihned; zde je můžete smazat.</p>
${entries.length ? `<ul class="list">${rows}</ul>` : '<p class="empty">Zatím žádné komentáře.</p>'}`,
  });
}

function adminFeedbackPage() {
  const entries = feedbackStore.list(200);
  const rows = entries.map((entry) => {
    const flags = [entry.is_public ? "veřejné" : "soukromé", entry.hidden ? "skryté" : null].filter(Boolean).join(" · ");
    return `
    <li class="${entry.hidden ? "is-hidden" : ""}">
      <div class="meta">#${entry.id} · ${escapeHtml(new Date(entry.created_at).toLocaleString("cs-CZ"))} · ${escapeHtml(entry.category || "other")} · ${escapeHtml(flags)}</div>
      ${entry.name ? `<div class="node">${escapeHtml(entry.name)}</div>` : ""}
      <p>${escapeHtml(entry.message)}</p>
      ${entry.contact ? `<div class="contact">Kontakt: ${escapeHtml(entry.contact)}</div>` : ""}
      <form class="actions" method="post" action="${adminPath("/feedback/moderate")}">
        <input type="hidden" name="id" value="${escapeHtml(entry.id)}" />
        <input type="hidden" name="hidden" value="${entry.hidden ? "0" : "1"}" />
        <button class="${entry.hidden ? "approve" : "hide"}" type="submit">${entry.hidden ? "Zobrazit" : "Skrýt"}</button>
      </form>
    </li>`;
  }).join("");
  return adminLayout({
    active: "feedback",
    title: "Zpětná vazba",
    content: `
<h1>Zpětná vazba</h1>
<p class="sub">${formatAdminNumber(entries.length)} zpráv (nejnovější první).</p>
${entries.length ? `<ul class="list feedback">${rows}</ul>` : '<p class="empty">Zatím žádné zprávy.</p>'}`,
  });
}

function resolveImportNode(value) {
  const raw = String(value || "").trim();
  if (!raw) return { error: "Zadejte klíč nebo název nodu." };
  const names = photoNodeNames();
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    const key = raw.toLowerCase();
    return { key, name: names.get(key) || "" };
  }
  const wanted = raw.toLowerCase();
  const exact = [...names.entries()].filter(([, name]) => String(name).toLowerCase() === wanted);
  if (exact.length === 1) return { key: exact[0][0], name: exact[0][1] };
  const partial = [...names.entries()].filter(([, name]) => String(name).toLowerCase().includes(wanted));
  if (partial.length === 1) return { key: partial[0][0], name: partial[0][1] };
  if (partial.length > 1) return { error: `Název odpovídá ${partial.length} nodům; zadejte veřejný klíč.` };
  return { error: "Nod nebyl nalezen." };
}

function trustedRepeaterSourceUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const pageId = url.searchParams.get("id") || "";
    const slug = pageId.startsWith("repeatery:") ? pageId.slice("repeatery:".length) : "";
    if (url.protocol !== "https:" || url.hostname !== "meshcore.cz"
      || url.pathname !== "/doku.php" || !validRepeaterSlug(slug)) return null;
    return `https://meshcore.cz/doku.php?id=repeatery:${encodeURIComponent(slug)}`;
  } catch {
    return null;
  }
}

function repeaterPageSlug(sourceUrl) {
  try {
    const url = new URL(String(sourceUrl || ""));
    const id = url.searchParams.get("id") || "";
    const slug = id.startsWith("repeatery:") ? id.slice("repeatery:".length) : "";
    return validRepeaterSlug(slug) ? slug : "";
  } catch {
    return "";
  }
}

async function importRepeaterPhoto(nodeKey, page, fileName) {
  if (!page?.images?.includes(fileName)) return { error: "invalid_photo" };
  const caption = `${page.title || page.slug} · ${fileName}`.slice(0, 240);
  const existing = photoStore.listApproved(nodeKey, 12);
  if (existing.some((photo) => photo.caption === caption)) return { skipped: true };
  if (existing.length >= 8) return { error: "node_limit" };
  const temp = mkdtempSync(join(tmpdir(), "meshcore-sync-photo-"));
  try {
    const response = await fetch(`https://meshcore.cz/_media/repeatery:${encodeURIComponent(fileName)}`, {
      headers: { "User-Agent": "meshcore-map-sync/1" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").startsWith("image/")) {
      return { error: "download" };
    }
    const input = join(temp, "input.img");
    const output = join(temp, "output.webp");
    writeFileSync(input, Buffer.from(await response.arrayBuffer()));
    execFileSync("convert", [input, "-auto-orient", "-resize", "2000x2000>", "-strip", "-quality", "82", output], { stdio: "ignore" });
    const photo = photoStore.create({
      author: "meshcore.cz",
      buffer: readFileSync(output),
      caption,
      nodeKey,
      status: "approved",
    });
    return { photo };
  } catch (error) {
    return { error: error?.message || "photo_failed" };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function adminRepeaterImportPage({ node = null, page = null, slug = "", keyValue = "", error = "" } = {}) {
  const nodeLabel = node ? `${node.name || "Nod"} · ${node.key.slice(0, 8)}` : "";
  const preview = page && node ? `
    <section class="panel">
      <h2>Náhled stránky</h2>
      <p class="sub"><a href="${escapeHtml(page.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(page.title || page.slug)}</a>
        · ${formatAdminNumber(page.imageCount)} obrázků (import fotek zatím není zapnutý)</p>
      ${String(page.text || "").trim().length < 5 ? '<p class="feedback-status error">Stránka neobsahuje použitelný text k importu. Můžete použít jen odkaz ze stránky.</p>' : `
      <form class="admin-edit-form" method="post" action="${adminPath("/repeater-import")}">
        <input type="hidden" name="key" value="${escapeHtml(node.key)}" />
        <input type="hidden" name="sourceUrl" value="${escapeHtml(page.sourceUrl)}" />
        <input type="hidden" name="sourceTitle" value="${escapeHtml(page.title || page.slug)}" />
        <label>Text k importu
          <textarea name="text" rows="14" maxlength="1000" required>${escapeHtml(page.text)}</textarea>
        </label>
        <p class="sub">Zdroj: ${escapeHtml(page.sourceUrl)} · licence stránky je CC BY-SA, u fotek ji ověřte zvlášť.</p>
        <div class="feedback-actions">
          <a href="${adminPath("/node-info")}">Zrušit</a>
          <button type="submit">Uložit a zveřejnit info</button>
        </div>
      </form>`}
    </section>` : "";
  return adminLayout({
    active: "import",
    title: "Import z meshcore.cz",
    content: `
<h1>Import z meshcore.cz</h1>
<p class="sub">Načte text z veřejné stránky repeateru v namespace <code>repeatery</code>. Před uložením se zobrazí náhled; fotky se zatím neimportují.</p>
${error ? `<p class="feedback-status error">${escapeHtml(error)}</p>` : ""}
<section class="panel">
  <form class="admin-edit-form" method="get" action="${adminPath("/repeater-import")}">
    <label>Klíč nebo název nodu
      <input type="text" name="key" value="${escapeHtml(keyValue)}" placeholder="např. rip5.meshcore.cz" required />
    </label>
    <label>Stránka (slug, nepovinné)
      <input type="text" name="slug" value="${escapeHtml(slug)}" placeholder="rip5" />
    </label>
    <div class="feedback-actions"><button type="submit">Načíst náhled</button></div>
  </form>
  ${node ? `<p class="sub">Vybraný nod: <strong>${escapeHtml(nodeLabel)}</strong></p>` : ""}
</section>
${preview}`,
  });
}

async function repeaterSyncPlan(info, nodeName) {
  const slug = repeaterPageSlug(info?.sourceUrl);
  if (!slug) return null;
  const page = await fetchRepeaterPage(slug);
  if (!page) return { error: "Wiki stránka není dostupná.", info, nodeName };
  const existing = photoStore.listApproved(info.nodeKey, 12);
  const captions = new Set(existing.map((photo) => photo.caption));
  const missing = page.images.filter((file) => !captions.has(`${page.title || page.slug} · ${file}`));
  return {
    error: "",
    info,
    missing,
    nodeName,
    page,
    textChanged: String(info.text || "") !== String(page.text || ""),
  };
}

function adminRepeaterSyncAllPage({ plans = [], message = "", error = "" } = {}) {
  const changed = plans.filter((plan) => !plan.error && (plan.textChanged || plan.missing.length));
  const rows = plans.map((plan) => {
    const name = plan.nodeName || plan.info.nodeKey.slice(0, 12);
    if (plan.error) {
      return `<li><strong>${escapeHtml(name)}</strong><p class="sub">${escapeHtml(plan.error)}</p></li>`;
    }
    const changes = [
      plan.textChanged ? "text se změnil" : "text bez změny",
      plan.missing.length ? `${plan.missing.length} nových obrázků` : "žádné nové obrázky",
    ].join(" · ");
    const selectable = plan.textChanged || plan.missing.length;
    return `<li>
      <label class="sync-check"><input type="checkbox" name="key" value="${escapeHtml(plan.info.nodeKey)}" ${selectable ? "checked" : ""} ${selectable ? "" : "disabled"} />
        <strong>${escapeHtml(name)}</strong></label>
      <p class="sub">${escapeHtml(changes)}</p>
      <details><summary>Zobrazit text z wiki</summary><pre class="sync-preview">${escapeHtml(plan.page.text || "—")}</pre></details>
      <a class="edit" href="${adminPath(`/repeater-sync?key=${encodeURIComponent(plan.info.nodeKey)}`)}">Detailní sync</a>
    </li>`;
  }).join("");
  return adminLayout({
    active: "syncall",
    title: "Hromadný sync z wiki",
    content: `
<h1>Hromadný sync z wiki</h1>
<p class="sub">Porovnání všech importovaných nodů s aktuální wiki. Vyber nody a potvrď hromadný sync. Nic se nespouští automaticky.</p>
${message ? `<p class="sub imported">${escapeHtml(message)}</p>` : ""}
${error ? `<p class="feedback-status error">${escapeHtml(error)}</p>` : ""}
${changed.length ? `<form method="post" action="${adminPath("/repeater-sync-all")}"><ul class="list sync-all-list">${rows}</ul><div class="feedback-actions"><button type="submit">Synchronizovat vybrané (${formatAdminNumber(changed.length)})</button></div></form>` : '<p class="empty">Vše je aktuální, žádné změny k synchronizaci.</p>'}
`,
  });
}

function adminRepeaterSyncPage({ node = null, page = null, current = null, keyValue = "", error = "", message = "" } = {}) {
  const currentText = String(current?.text || "");
  const existingPhotos = node ? photoStore.listApproved(node.key, 12) : [];
  const existingCaptions = new Set(existingPhotos.map((photo) => photo.caption));
  const missing = page ? page.images.filter((file) => !existingCaptions.has(`${page.title || page.slug} · ${file}`)) : [];
  const nodeLabel = node ? `${node.name || "Nod"} · ${node.key.slice(0, 8)}` : "";
  const preview = page && node ? `
    <section class="panel">
      <h2>Stránka na meshcore.cz</h2>
      <p class="sub"><a href="${escapeHtml(page.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(page.title || page.slug)}</a>
        · ${formatAdminNumber(page.imageCount)} obrázků</p>
      <div class="sync-compare">
        <div><strong>Aktuální uložené info</strong><pre>${escapeHtml(currentText || "—")}</pre></div>
        <div><strong>Text na wiki</strong><pre>${escapeHtml(page.text || "—")}</pre></div>
      </div>
      <form class="admin-edit-form" method="post" action="${adminPath("/repeater-sync")}">
        <input type="hidden" name="key" value="${escapeHtml(node.key)}" />
        <input type="hidden" name="slug" value="${escapeHtml(page.slug)}" />
        <input type="hidden" name="sourceUrl" value="${escapeHtml(page.sourceUrl)}" />
        <input type="hidden" name="sourceTitle" value="${escapeHtml(page.title || page.slug)}" />
        <label class="sync-check"><input type="checkbox" name="syncText" value="1" ${current?.sourceUrl ? "checked" : ""} /> Aktualizovat text z wiki</label>
        ${missing.length ? `<h3>Nové obrázky</h3><ul class="sync-photos">${missing.map((file) => `
          <li><label><input type="checkbox" name="photo" value="${escapeHtml(file)}" checked /> ${escapeHtml(file)}</label></li>`).join("")}</ul>` : '<p class="sub">Na wiki nejsou žádné nové obrázky.</p>'}
        <div class="feedback-actions">
          <a href="${adminPath("/node-info")}">Zrušit</a>
          <button type="submit">Provést ruční sync</button>
        </div>
      </form>
    </section>` : "";
  return adminLayout({
    active: "sync",
    title: "Sync z wiki",
    content: `
<h1>Ruční sync z meshcore.cz</h1>
<p class="sub">Porovná uložené uživatelské info s aktuální wiki stránkou. Nic se nespouští automaticky; změny potvrdíte tlačítkem.</p>
<p class="sub"><a href="${adminPath("/repeater-sync-all")}">Přejít na hromadný sync</a></p>
${message ? `<p class="sub imported">${escapeHtml(message)}</p>` : ""}
${error ? `<p class="feedback-status error">${escapeHtml(error)}</p>` : ""}
<section class="panel">
  <form class="admin-edit-form" method="get" action="${adminPath("/repeater-sync")}">
    <label>Klíč nebo název nodu
      <input type="text" name="key" value="${escapeHtml(keyValue)}" placeholder="např. rip5.meshcore.cz" required />
    </label>
    <div class="feedback-actions"><button type="submit">Načíst rozdíly</button></div>
  </form>
  ${node ? `<p class="sub">Vybraný nod: <strong>${escapeHtml(nodeLabel)}</strong></p>` : ""}
</section>
${preview}`,
  });
}

function adminNodeInfoPage(imported = false, synced = false) {
  const entries = nodeInfoStore.list(500);
  const pending = nodeInfoStore.listPending(500);
  const names = photoNodeNames();
  const pendingRows = pending.map((info) => {
    const node = names.get(info.nodeKey);
    const nodeLabel = node ? `${node} · ${info.nodeKey.slice(0, 8)}` : info.nodeKey.slice(0, 16);
    return `
    <li>
      <div class="meta">${escapeHtml(new Date(info.createdAt).toLocaleString("cs-CZ"))}${info.author ? ` · ${escapeHtml(info.author)}` : ""}</div>
      <div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(info.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>
      <div class="meta">Aktuální zveřejněný text</div>
      <p>${escapeHtml(info.currentText || "—")}</p>
      <div class="meta">Navrhovaná změna</div>
      <p>${escapeHtml(info.text)}</p>
      <form class="actions" method="post" action="${adminPath("/node-info/moderate")}">
        <input type="hidden" name="key" value="${escapeHtml(info.nodeKey)}" />
        <button class="approve" name="action" value="approve" type="submit">Schválit změnu</button>
        <button class="delete" name="action" value="reject" type="submit">Zamítnout</button>
      </form>
    </li>`;
  }).join("");
  const rows = entries.map((info) => {
    const node = names.get(info.nodeKey);
    const nodeLabel = node ? `${node} · ${info.nodeKey.slice(0, 8)}` : info.nodeKey.slice(0, 16);
    return `
    <li>
      <div class="meta">${escapeHtml(new Date(info.updatedAt).toLocaleString("cs-CZ"))}${info.author ? ` · ${escapeHtml(info.author)}` : ""}</div>
      <div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(info.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>
      <p>${escapeHtml(info.text)}</p>
      <div class="actions">
        <a class="edit" href="${adminPath(`/node-info/edit?key=${encodeURIComponent(info.nodeKey)}`)}">Upravit</a>
        ${repeaterImportEnabled ? (info.sourceUrl
          ? `<a class="edit" href="${adminPath(`/repeater-sync?key=${encodeURIComponent(info.nodeKey)}`)}">Sync z wiki</a>`
          : `<a class="edit" href="${adminPath(`/repeater-import?key=${encodeURIComponent(info.nodeKey)}`)}">Import z wiki</a>`) : ""}
        <form method="post" action="${adminPath("/node-info/delete")}">
          <input type="hidden" name="key" value="${escapeHtml(info.nodeKey)}" />
          <button class="delete" type="submit">Smazat info</button>
        </form>
      </div>
    </li>`;
  }).join("");
  return adminLayout({
    active: "nodeinfo",
    title: "Info nodů",
    content: `
<h1>Info nodů</h1>
<p class="sub">${formatAdminNumber(entries.length)} zveřejněných popisů${pending.length ? ` · ${formatAdminNumber(pending.length)} změn ke schválení` : ""}.</p>
${imported ? '<p class="sub imported">Import z meshcore.cz byl uložen.</p>' : ""}
${synced ? '<p class="sub imported">Sync z meshcore.cz byl uložen.</p>' : ""}
${pending.length ? `<h2>Změny ke schválení</h2><ul class="list feedback">${pendingRows}</ul>` : ""}
<h2>Zveřejněné info</h2>
${entries.length ? `<ul class="list feedback">${rows}</ul>` : '<p class="empty">Zatím žádné uživatelské info.</p>'}`,
  });
}

function adminNodeInfoEditPage(info) {
  const pending = nodeInfoStore.getPending(info.nodeKey);
  return adminLayout({
    active: "nodeinfo",
    title: "Upravit info nodu",
    content: `
<h1>Upravit info nodu</h1>
<p class="sub">${info.protected ? "Záznam je chráněný heslem." : "Záznam není chráněný heslem."} Uložení se zveřejní ihned.</p>
${pending ? '<p class="sub">Pozor: existuje čekající návrh změny. Uložením tohoto textu se návrh zruší.</p>' : ""}
<form class="admin-edit-form" method="post" action="${adminPath("/node-info/edit")}">
  <input type="hidden" name="key" value="${escapeHtml(info.nodeKey)}" />
  <label>Text info
    <textarea name="text" rows="10" maxlength="1000" required>${escapeHtml(info.text)}</textarea>
  </label>
  <label>Autor (nepovinné)
    <input type="text" name="author" maxlength="60" value="${escapeHtml(info.author || "")}" />
  </label>
  <div class="feedback-actions">
    <a href="${adminPath("/node-info")}">Zrušit</a>
    <button type="submit">Uložit a zveřejnit</button>
  </div>
</form>`,
  });
}

async function handleAdminRequest(request, response, url) {
  response.setHeader("Cache-Control", "no-store");
  if (!adminPassword || !adminSessionSecret) {
    response.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html lang=\"cs\"><meta charset=\"utf-8\"><body style=\"font:16px system-ui;padding:40px\">Administrace není nakonfigurovaná. Nastavte <code>ADMIN_PASSWORD</code> nebo <code>FEEDBACK_TOKEN</code>.</body></html>");
    return;
  }
  const method = request.method || "GET";
  const path = url.pathname;
  if (path === "/admin/login" && method === "GET") {
    if (adminSessionValid(request)) {
      redirectAdmin(response, adminBasePath);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderAdminLogin({ next: safeAdminNext(url.searchParams.get("next")) }));
    return;
  }
  if (path === "/admin/login" && method === "POST") {
    if (!sameOriginRequest(request)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
      return;
    }
    const ip = clientIp(request);
    const rate = checkAdminLogin(ip);
    if (!rate.ok) {
      response.writeHead(429, { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(rate.retryAfter) });
      response.end(renderAdminLogin({ error: "Příliš mnoho pokusů o přihlášení.", retryAfter: rate.retryAfter }));
      return;
    }
    const form = await readAdminForm(request);
    if (!form) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad Request");
      return;
    }
    const next = safeAdminNext(form.get("next"));
    if (!safeEqualText(form.get("password"), adminPassword)) {
      response.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderAdminLogin({ error: "Nesprávné heslo.", next }));
      return;
    }
    adminLoginAttempts.delete(ip);
    response.writeHead(303, {
      "Cache-Control": "no-store",
      "Location": next,
      "Set-Cookie": adminCookie(request, createAdminSessionToken()),
    });
    response.end();
    return;
  }
  if (path === "/admin/logout" && method === "POST") {
    response.writeHead(303, {
      "Cache-Control": "no-store",
      "Location": adminBasePath,
      "Set-Cookie": adminCookie(request, "", 0),
    });
    response.end();
    return;
  }
  if ((path === "/admin" || path === "/admin/") && method === "GET") {
    if (!adminSessionValid(request)) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderAdminLogin({ next: safeAdminNext(url.searchParams.get("next")) }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(adminDashboardPage());
    return;
  }
  if (path.startsWith("/admin/") && method === "GET") {
    if (!adminSessionValid(request)) {
      const externalPath = `${adminBasePath}${path.slice("/admin".length)}${url.search}`;
      redirectAdmin(response, `${adminBasePath}/login?next=${encodeURIComponent(externalPath)}`);
      return;
    }
    if (path === "/admin/photos") {
      const defaultStatus = photoAutoApprove ? "approved" : "pending";
      const status = ["pending", "approved", "hidden", "all", "reports"].includes(url.searchParams.get("status"))
        ? url.searchParams.get("status")
        : defaultStatus;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminPhotoPage(status));
      return;
    }
    if (path === "/admin/comments") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminCommentsPage());
      return;
    }
    if (path === "/admin/feedback") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminFeedbackPage());
      return;
    }
    if (path === "/admin/node-info") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminNodeInfoPage(url.searchParams.get("imported") === "1", url.searchParams.get("synced") === "1"));
      return;
    }
    if (path === "/admin/repeater-sync-all" && repeaterImportEnabled) {
      const names = photoNodeNames();
      const infos = nodeInfoStore.list(500).filter((info) => info.sourceUrl);
      const plans = [];
      for (const info of infos) plans.push(await repeaterSyncPlan(info, names.get(info.nodeKey) || info.nodeKey.slice(0, 12)));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminRepeaterSyncAllPage({ plans }));
      return;
    }
    if (path === "/admin/repeater-sync-all" && repeaterImportEnabled) {
      const names = photoNodeNames();
      let synced = 0;
      for (const key of form.getAll("key").map(String)) {
        const info = nodeInfoStore.get(key);
        if (!info?.sourceUrl) continue;
        const plan = await repeaterSyncPlan(info, names.get(info.nodeKey) || info.nodeKey.slice(0, 12));
        if (!plan?.page) continue;
        if (plan.page.text.trim().length >= 5) {
          nodeInfoStore.importText(info.nodeKey, {
            author: "meshcore.cz",
            sourceTitle: plan.page.title || plan.page.slug,
            sourceUrl: plan.page.sourceUrl,
            text: plan.page.text,
          });
        }
        for (const fileName of plan.missing) await importRepeaterPhoto(info.nodeKey, plan.page, fileName);
        synced += 1;
      }
      redirectAdmin(response, `${adminBasePath}/node-info?synced=1`);
      return;
    }
    if (path === "/admin/repeater-sync" && repeaterImportEnabled) {
      const keyValue = String(url.searchParams.get("key") || "").trim();
      if (!keyValue) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(adminRepeaterSyncPage({ keyValue }));
        return;
      }
      const node = resolveImportNode(keyValue);
      let error = node.error || "";
      let page = null;
      let current = null;
      if (!error) {
        current = nodeInfoStore.get(node.key);
        const slug = repeaterPageSlug(current?.sourceUrl);
        page = slug ? await fetchRepeaterPage(slug) : await findRepeaterPage(node.name || node.key);
        if (!page) error = "Pro tento nod nebyla nalezena wiki stránka.";
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminRepeaterSyncPage({ current, error, keyValue, node, page }));
      return;
    }
    if (path === "/admin/repeater-import" && repeaterImportEnabled) {
      const keyValue = String(url.searchParams.get("key") || "").trim();
      const slug = String(url.searchParams.get("slug") || "").trim().toLowerCase();
      if (!keyValue) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(adminRepeaterImportPage({ keyValue, slug }));
        return;
      }
      const node = resolveImportNode(keyValue);
      let page = null;
      let error = node.error || "";
      if (!error) {
        if (slug && !validRepeaterSlug(slug)) error = "Neplatný slug stránky.";
        else if (slug) page = await fetchRepeaterPage(slug);
        else page = await findRepeaterPage(node.name || node.key);
        if (!page && !error) error = slug
          ? "Stránka nebyla nalezena nebo neobsahuje čitelný text."
          : "Stránka nebyla automaticky nalezena; zadejte slug ručně.";
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminRepeaterImportPage({ error, keyValue, node, page, slug }));
      return;
    }
    if (path === "/admin/node-info/edit") {
      const info = nodeInfoStore.get(url.searchParams.get("key"));
      if (!info) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminNodeInfoEditPage(info));
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
    return;
  }
  if (path.startsWith("/admin/") && method === "POST") {
    if (!adminSessionValid(request)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
      return;
    }
    if (!sameOriginRequest(request)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
      return;
    }
    const form = await readAdminForm(request);
    if (!form) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad Request");
      return;
    }
    if (path === "/admin/repeater-sync" && repeaterImportEnabled) {
      const key = String(form.get("key") || "").trim().toLowerCase();
      const slug = String(form.get("slug") || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key) || !validRepeaterSlug(slug)) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Neplatný sync.");
        return;
      }
      const page = await fetchRepeaterPage(slug);
      if (!page) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Wiki stránka není dostupná.");
        return;
      }
      if (form.get("syncText") === "1") {
        nodeInfoStore.importText(key, {
          author: "meshcore.cz",
          sourceTitle: page.title || slug,
          sourceUrl: page.sourceUrl,
          text: page.text,
        });
      }
      const selectedPhotos = new Set(form.getAll("photo").map(String));
      for (const fileName of page.images) {
        if (selectedPhotos.has(fileName)) await importRepeaterPhoto(key, page, fileName);
      }
      redirectAdmin(response, `${adminBasePath}/node-info?synced=1`);
      return;
    }
    if (path === "/admin/repeater-import" && repeaterImportEnabled) {
      const key = String(form.get("key") || "").trim().toLowerCase();
      const text = String(form.get("text") || "").trim();
      const sourceUrl = trustedRepeaterSourceUrl(form.get("sourceUrl"));
      if (!/^[0-9a-f]{64}$/.test(key) || text.length < 5 || text.length > 1000 || !sourceUrl) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Neplatný import.");
        return;
      }
      const sourceTitle = String(form.get("sourceTitle") || "meshcore.cz").trim().slice(0, 200);
      const info = nodeInfoStore.importText(key, { author: "meshcore.cz", sourceTitle, sourceUrl, text });
      if (!info) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Import se nepodařilo uložit.");
        return;
      }
      redirectAdmin(response, `${adminBasePath}/node-info?imported=1`);
      return;
    }
    if (path === "/admin/photos/moderate") {
      const id = String(form.get("id") || "");
      const reportId = String(form.get("report") || "");
      const action = String(form.get("action") || "");
      const status = ["pending", "approved", "hidden", "all", "reports"].includes(form.get("status"))
        ? form.get("status")
        : "pending";
      if (action === "delete") photoStore.remove(id);
      else if (action === "approve") photoStore.setStatus(id, "approved");
      else if (action === "cover") photoStore.setCover(id);
      else if (action === "hide") photoStore.setStatus(id, "hidden");
      else if (action === "dismiss") photoStore.resolveReport(reportId);
      redirectAdmin(response, `${adminBasePath}/photos?status=${encodeURIComponent(status)}`);
      return;
    }
    if (path === "/admin/comments/delete") {
      commentStore.remove(form.get("id"));
      redirectAdmin(response, adminBasePath + "/comments");
      return;
    }
    if (path === "/admin/feedback/moderate") {
      const id = Number(form.get("id"));
      if (Number.isFinite(id)) feedbackStore.setHidden(id, form.get("hidden") === "1");
      redirectAdmin(response, `${adminBasePath}/feedback`);
      return;
    }
    if (path === "/admin/node-info/edit") {
      const key = String(form.get("key") || "");
      const text = String(form.get("text") || "").trim();
      const author = String(form.get("author") || "").trim().slice(0, 60);
      if (text.length < 5 || text.length > 1000) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Text musí mít 5 až 1000 znaků.");
        return;
      }
      const info = nodeInfoStore.adminUpdate(key, { author, text });
      if (!info) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      redirectAdmin(response, `${adminBasePath}/node-info`);
      return;
    }
    if (path === "/admin/node-info/moderate") {
      const key = form.get("key");
      const action = form.get("action");
      if (action === "approve") nodeInfoStore.approve(key);
      else if (action === "reject") nodeInfoStore.reject(key);
      redirectAdmin(response, `${adminBasePath}/node-info`);
      return;
    }
    if (path === "/admin/node-info/delete") {
      nodeInfoStore.remove(form.get("key"));
      redirectAdmin(response, `${adminBasePath}/node-info`);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
    return;
  }
  response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, POST" }).end("Method Not Allowed");
}

async function handleRequest(request, response) {
  for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
  let url;
  let decodedPathname;
  try {
    url = new URL(request.url || "", requestBase);
    decodedPathname = decodeURIComponent(url.pathname);
    decodeURIComponent(url.search);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Malformed request URL");
    return;
  }

  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    await handleAdminRequest(request, response, url);
    return;
  }

  if (url.pathname === "/events/packets") {
    if (packetStreams.size >= maxPacketStreams) {
      response.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "10",
      });
      response.end("Too many event stream clients");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    const client = {
      blocked: false,
      onDrain: null,
      response,
    };
    client.onDrain = () => {
      client.blocked = false;
    };
    packetStreams.add(client);
    visitStore.recordVisit(clientIp(request));
    visitStore.updatePeak(packetStreams.size);
    broadcastStatus();
    if (url.searchParams.get("replay") !== "0") {
      for (const packet of recentPackets.values()) {
        if (!sendStreamEvent(client, "packet", packet)) break;
      }
    }
    response.once("close", () => {
      packetStreams.delete(client);
      visitStore.updatePeak(packetStreams.size);
      broadcastStatus();
    });
    return;
  }

  if (url.pathname === "/api/version") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const body = JSON.stringify({
      build: currentBuild(),
      environment: publicBasePath === "/beta" ? "beta" : "production",
    });
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  if (url.pathname === "/api/health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const body = JSON.stringify(healthPayload());
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  if (url.pathname === "/api/search") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const prefix = String(url.searchParams.get("hash") || "").trim();
    if (!/^[0-9a-fA-F]{2,64}$/.test(prefix)) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Neplatný prefix hashe." }));
      return;
    }
    const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 20), 50);
    const body = JSON.stringify({ hashes: packetStore.searchHashPrefix(prefix, limit), prefix });
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(body);
    return;
  }

  if (url.pathname === "/api/node-relay") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
      return;
    }
    const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    const node = cachedNodeByKey(key);
    const declaredHashBytes = Math.max(Number(node?.hash_size) || 0, Number(node?.multi_byte_max_hash_size) || 0);
    const hashBytes = declaredHashBytes >= 2 ? declaredHashBytes : 0;
    const prefix = hashBytes && node?.public_key ? String(node.public_key).slice(0, hashBytes * 2).toUpperCase() : "";
    const stats = prefix ? packetStore.relayStats(prefix, hashBytes) : null;
    sendJson(response, 200, { key, ...(stats || { hashBytes, prefix, lastRelayed: null, relayActive: false, relayCount1h: 0, relayCount24h: 0, unscopedRelay24h: 0 }) });
    return;
  }

  if (url.pathname === "/api/node-info") {
    if (request.method === "GET" || request.method === "HEAD") {
      const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) {
        sendJson(response, 400, { error: "Neplatný klíč nodu." });
        return;
      }
      sendJson(response, 200, { info: nodeInfoStore.get(key) });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "GET, HEAD, POST" }).end("Method Not Allowed");
      return;
    }
    const ip = clientIp(request);
    const rate = checkNodeInfo(ip);
    if (!rate.ok) {
      sendJson(response, 429, { error: rate.message }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(request, 8192));
    } catch {
      sendJson(response, 400, { error: "Neplatný požadavek." });
      return;
    }
    const key = String(payload?.key || "").trim().toLowerCase();
    const text = String(payload?.text || "").trim();
    const author = String(payload?.author || "").trim().slice(0, 60);
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    if (text.length < 5 || text.length > 1000) {
      sendJson(response, 400, { error: "Info musí mít 5 až 1000 znaků." });
      return;
    }
    const password = String(payload?.password || "");
    if (password && (password.length < 6 || password.length > 128)) {
      sendJson(response, 400, { error: "Heslo musí mít 6 až 128 znaků." });
      return;
    }
    const result = nodeInfoStore.submit({
      author,
      ipHash: createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16),
      nodeKey: key,
      password,
      text,
    });
    if (!result) {
      sendJson(response, 400, { error: "Info se nepodařilo uložit." });
      return;
    }
    if (result.error === "bad_password") {
      sendJson(response, 403, { error: "Nesprávné heslo pro úpravu tohoto info." });
      return;
    }
    if (result.error === "invalid_password") {
      sendJson(response, 400, { error: "Heslo musí mít 6 až 128 znaků." });
      return;
    }
    notifyNodeInfo(result.info, result.status);
    sendJson(response, 200, { info: result.info, ok: true, status: result.status });
    return;
  }

  if (url.pathname === "/api/photos/config") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
      return;
    }
    sendJson(response, 200, { autoApprove: photoAutoApprove });
    return;
  }

  if (url.pathname === "/api/photos") {
    if (request.method === "GET" || request.method === "HEAD") {
      const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) {
        sendJson(response, 400, { error: "Neplatný klíč nodu." });
        return;
      }
      const photos = photoStore.listApproved(key, 12).map((photo) => ({
        author: photo.author,
        bytes: photo.bytes,
        caption: photo.caption,
        createdAt: photo.createdAt,
        height: photo.height,
        id: photo.id,
        width: photo.width,
      }));
      sendJson(response, 200, { photos });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "GET, HEAD, POST" }).end("Method Not Allowed");
      return;
    }
    const key = String(request.headers["x-photo-key"] || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    if (request.headers["x-photo-consent"] !== "1") {
      sendJson(response, 400, { error: "Je potřeba potvrdit právo fotku zveřejnit." });
      return;
    }
    if (!photoToken) {
      sendJson(response, 503, { error: "Nahrávání fotek není nakonfigurované." });
      return;
    }
    const ip = clientIp(request);
    const batchSize = Number(request.headers["x-photo-batch-size"]);
    const batchIndex = Number(request.headers["x-photo-batch-index"]);
    const batch = Number.isInteger(batchSize) && batchSize > 0 && batchSize <= 5
      && Number.isInteger(batchIndex) && batchIndex >= 0 && batchIndex < batchSize;
    const rate = checkPhotoUpload(ip, Date.now(), { skipCooldown: batch && batchIndex > 0 });
    if (!rate.ok) {
      sendJson(response, 429, { error: rate.message }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > photoMaxBytes) {
      sendJson(response, 413, { error: "Fotka je příliš velká." });
      return;
    }
    let buffer;
    try {
      buffer = await readBodyBuffer(request, photoMaxBytes);
    } catch (error) {
      sendJson(response, error.code === "too_large" ? 413 : 400, {
        error: error.code === "too_large" ? "Fotka je příliš velká." : "Fotku se nepodařilo načíst.",
      });
      return;
    }
    if (!detectImage(buffer)) {
      sendJson(response, 415, { error: "Nepodporovaný formát fotky. Použijte JPEG, PNG nebo WebP." });
      return;
    }
    try {
      const photo = photoStore.create({
        author: cleanPhotoText(decodeHeaderValue(request.headers["x-photo-author"]), 60),
        buffer,
        caption: cleanPhotoText(decodeHeaderValue(request.headers["x-photo-caption"]), 240),
        ipHash: createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16),
        nodeKey: key,
        status: photoAutoApprove ? "approved" : "pending",
      });
      if (request.headers["x-photo-cover"] === "1") photoStore.requestCover(photo.id);
      queueNewPhotoNotification(
        photo,
        String(request.headers["x-photo-batch-id"] || "").slice(0, 64),
        batch ? batchSize : 1,
      );
      sendJson(response, 202, { id: photo.id, ok: true, status: photo.status });
    } catch (error) {
      if (error instanceof PhotoError) {
        const status = error.code === "too_large" || error.code === "too_large_dimensions" ? 413
          : error.code === "store_full" ? 507
            : error.code === "node_limit" ? 409
              : error.code === "invalid_image" ? 415 : 400;
        sendJson(response, status, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (url.pathname === "/api/photos/report") {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end("Method Not Allowed");
      return;
    }
    const ip = clientIp(request);
    const rate = checkPhotoReport(ip);
    if (!rate.ok) {
      sendJson(response, 429, { error: rate.message }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(request, 8192));
    } catch {
      sendJson(response, 400, { error: "Neplatný požadavek." });
      return;
    }
    const photoId = String(payload?.photoId || "").toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(photoId)) {
      sendJson(response, 400, { error: "Neplatná fotka." });
      return;
    }
    const reason = String(payload?.reason || "other");
    if (!["inappropriate", "other", "owner", "privacy"].includes(reason)) {
      sendJson(response, 400, { error: "Neplatný důvod." });
      return;
    }
    const message = cleanPhotoText(payload?.message, 500);
    if (message.length < 5) {
      sendJson(response, 400, { error: "Napište prosím důvod žádosti (alespoň 5 znaků)." });
      return;
    }
    const contact = cleanPhotoText(payload?.contact, 200);
    const reportId = photoStore.createReport({
      contact,
      ipHash: createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16),
      message,
      photoId,
      reason,
    });
    if (reportId) {
      notifyNewReport({ contact, message, photo: photoStore.get(photoId), reason });
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/photos/nodes") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const nodes = photoStore.listApprovedNodeCounts();
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : JSON.stringify({ nodes, total: nodes.length }));
    return;
  }

  if (url.pathname === "/api/photos/view") {
    if (!photoToken || url.searchParams.get("token") !== photoToken) {
      response.writeHead(404).end("Not Found");
      return;
    }
    const status = ["pending", "approved", "hidden", "all", "reports"].includes(url.searchParams.get("status"))
      ? url.searchParams.get("status")
      : "pending";
    const entries = status === "reports" ? [] : photoStore.listAdmin(status, 300);
    const reports = status === "reports" ? photoStore.listReports("open", 300) : [];
    const openReports = photoStore.openReportCount();
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(renderPhotoPage(entries, reports, photoToken, status, openReports));
    return;
  }

  if (url.pathname === "/api/photos/moderate") {
    if (!photoToken || url.searchParams.get("token") !== photoToken) {
      response.writeHead(404).end("Not Found");
      return;
    }
    const id = String(url.searchParams.get("id") || "");
    const reportId = String(url.searchParams.get("report") || "");
    const action = String(url.searchParams.get("action") || "");
    const status = ["pending", "approved", "hidden", "all", "reports"].includes(url.searchParams.get("status"))
      ? url.searchParams.get("status")
      : "pending";
    if (action === "delete") photoStore.remove(id);
    else if (action === "approve") photoStore.setStatus(id, "approved");
    else if (action === "hide") photoStore.setStatus(id, "hidden");
    else if (action === "dismiss") photoStore.resolveReport(reportId);
    response.writeHead(303, {
      Location: `view?token=${encodeURIComponent(photoToken)}&status=${encodeURIComponent(status)}`,
    });
    response.end();
    return;
  }

  if (url.pathname.startsWith("/api/photos/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/photos/".length)).toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      response.writeHead(404).end("Not Found");
      return;
    }
    const photo = photoStore.get(id);
    const token = url.searchParams.get("token") || "";
    const admin = adminSessionValid(request);
    if (!photo || (photo.status !== "approved" && !admin && (!photoToken || token !== photoToken))) {
      response.writeHead(404).end("Not Found");
      return;
    }
    const filePath = photoStore.filePath(id);
    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404).end("Not Found");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": photo.status === "approved" ? "public, max-age=31536000, immutable" : "no-store",
      "Content-Length": photo.bytes,
      "Content-Type": photo.mime,
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).on("error", () => {
      if (!response.writableEnded) response.destroy();
    }).pipe(response);
    return;
  }

  if (url.pathname === "/api/node-detail") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    try {
      const { data, stale } = await fetchNodeDetail(key);
      sendJson(response, 200, data, stale ? { "X-Data-Stale": "1" } : {});
    } catch {
      sendJson(response, 502, { error: "Detail nodu není dostupný." });
    }
    return;
  }

  if (url.pathname === "/api/visit-stats") {
    const days = Math.min(Math.max(1, Number(url.searchParams.get("days")) || 14), 365);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(visitStore.report(Date.now(), days)));
    return;
  }

  if (url.pathname === "/api/comments/count") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
      return;
    }
    const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    sendJson(response, 200, { count: commentStore.countForNode(key) });
    return;
  }

  if (url.pathname === "/api/comments") {
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
      response.writeHead(405, { Allow: "GET, HEAD, POST" }).end("Method Not Allowed");
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) {
        sendJson(response, 400, { error: "Neplatný klíč nodu." });
        return;
      }
      const comments = commentStore.list(key);
      sendJson(response, 200, { comments, total: commentStore.countForNode(key) });
      return;
    }
    const ip = clientIp(request);
    const rate = checkComment(ip);
    if (!rate.ok) {
      sendJson(response, 429, { error: rate.message }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(request));
    } catch {
      sendJson(response, 400, { error: "Neplatný požadavek." });
      return;
    }
    const key = String(payload?.key || url.searchParams.get("key") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    const text = String(payload?.text || "").trim();
    const author = String(payload?.author || "").trim().slice(0, 60);
    if (text.length < 2 || text.length > 500) {
      sendJson(response, 400, { error: "Komentář musí mít 2 až 500 znaků." });
      return;
    }
    const now = Date.now();
    if (commentStore.countSince(startOfUtcDay(now)) >= commentDailyLimit) {
      sendJson(response, 429, { error: "Denní limit komentářů vyčerpán." }, { "Retry-After": "3600" });
      return;
    }
    const comment = commentStore.create({
      author,
      ipHash: createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16),
      nodeKey: key,
      text,
    }, now);
    if (!comment) {
      sendJson(response, 400, { error: "Komentář se nepodařilo vytvořit." });
      return;
    }
    commentStore.pruneTo(commentMaxRows);
    notifyNewComment(comment);
    sendJson(response, 200, { comment, ok: true });
    return;
  }

  if (url.pathname === "/api/feedback/public") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const entries = feedbackStore.listPublic(50);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ count: entries.length, entries }));
    return;
  }

  if (url.pathname === "/api/feedback"
    || url.pathname === "/api/feedback/view"
    || url.pathname === "/api/feedback/moderate") {
    const isView = url.pathname.endsWith("/view");
    const isModerate = url.pathname.endsWith("/moderate");
    if (request.method === "POST" && url.pathname === "/api/feedback") {
      const ip = clientIp(request);
      const rate = checkFeedback(ip);
      if (!rate.ok) {
        response.writeHead(429, {
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": String(rate.retryAfter),
        });
        response.end(JSON.stringify({ error: rate.message }));
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(request));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Neplatný požadavek." }));
        return;
      }
      const message = String(payload?.message || "").trim();
      if (message.length < 5 || message.length > 2000) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Zpráva musí mít 5 až 2000 znaků." }));
        return;
      }
      const now = Date.now();
      if (feedbackStore.countSince(startOfUtcDay(now)) >= feedbackDailyLimit) {
        response.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Retry-After": "3600" });
        response.end(JSON.stringify({ error: "Denní limit zpráv vyčerpán." }));
        return;
      }
      const category = ["bug", "idea", "other"].includes(payload?.category) ? payload.category : "other";
      const contact = String(payload?.contact || "").trim().slice(0, 200);
      const name = String(payload?.name || "").trim().slice(0, 60);
      const isPublic = payload?.isPublic === true;
      const userAgent = String(request.headers["user-agent"] || "").slice(0, 300);
      const ipHash = createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16);
      const id = feedbackStore.record({ category, message, contact, name, isPublic, ipHash, userAgent }, now);
      feedbackStore.pruneTo(feedbackMaxRows);
      notifyNewFeedback({ category, isPublic, message, name });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, id }));
      return;
    }
    if (!feedbackToken || url.searchParams.get("token") !== feedbackToken) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    if (isModerate) {
      const id = Number(url.searchParams.get("id"));
      const hidden = url.searchParams.get("hidden") !== "0";
      if (Number.isFinite(id)) feedbackStore.setHidden(id, hidden);
      response.writeHead(303, { Location: `/api/feedback/view?token=${encodeURIComponent(feedbackToken)}` });
      response.end();
      return;
    }
    const entries = feedbackStore.list(200);
    if (isView) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(renderFeedbackPage(entries, feedbackToken));
    } else {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ count: entries.length, entries }));
    }
    return;
  }

  if (url.pathname === "/api/packet-routes") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const hash = String(url.searchParams.get("hash") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{4,64}$/.test(hash)) {
      sendJson(response, 400, { error: "Neplatný hash paketu." });
      return;
    }
    const packets = packetStore.queryHash(hash).map(historyRowToPacket);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ count: packets.length, packets }));
    return;
  }

  if (url.pathname === "/api/history") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const sinceParam = url.searchParams.has("since") ? Number(url.searchParams.get("since")) : NaN;
    const limitParam = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : NaN;
    const since = Number.isFinite(sinceParam) ? sinceParam : Date.now() - 24 * 60 * 60 * 1000;
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 20_000) : 4_000;
    const packets = packetStore.querySince(since, limit).map(historyRowToPacket);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ count: packets.length, packets, since }));
    return;
  }

  if (url.pathname === "/api/packet-history") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const hoursParam = url.searchParams.has("hours") ? Number(url.searchParams.get("hours")) : NaN;
    const hours = Number.isFinite(hoursParam) ? Math.min(Math.max(1, Math.round(hoursParam)), 8760) : 24;
    const granularity = hours <= 168 ? "hour" : "day";
    const bucketMs = granularity === "hour" ? 3_600_000 : 86_400_000;
    const points = granularity === "hour" ? hours : Math.ceil(hours / 24);
    const end = granularity === "hour"
      ? Math.floor(Date.now() / bucketMs) * bucketMs
      : addLocalDays(startOfLocalDay(Date.now()), -1);
    const since = granularity === "hour"
      ? end - (points - 1) * bucketMs
      : addLocalDays(end, -(points - 1));
    const series = [];
    if (granularity === "hour") {
      const byHour = new Map();
      for (const sample of metricsStore.statsSeries(since)) {
        const hour = Math.floor(sample.bucketAt / bucketMs) * bucketMs;
        const previous = byHour.get(hour);
        if (!previous || sample.bucketAt > previous.bucketAt) byHour.set(hour, sample);
      }
      for (let index = 0; index < points; index += 1) {
        const hour = since + index * bucketMs;
        const sample = byHour.get(hour);
        const value = sample ? Number(sample.packetsLastHour) : NaN;
        series.push({
          hour,
          packets: Number.isFinite(value) ? value : null,
          sampledAt: sample?.sampledAt || null,
        });
      }
    } else {
      const byDay = new Map(metricsStore.statsRollupSeries(since, "day").map((sample) => [sample.bucketAt, sample]));
      for (let index = 0; index < points; index += 1) {
        const day = addLocalDays(since, index);
        const sample = byDay.get(day);
        const value = sample ? Number(sample.packetsLastHour) : NaN;
        series.push({
          hour: day,
          packets: Number.isFinite(value) ? value : null,
          peak: sample?.peak ?? null,
          samples: sample?.samples ?? 0,
          sampledAt: sample?.sampledAt || null,
        });
      }
    }
    sendJson(response, 200, {
      bucketMs,
      collectMs: statsCollectMs,
      granularity,
      hours,
      points: series.length,
      retentionDays: granularity === "day" ? statsDailyRetentionDays : statsHistoryDays,
      series,
      since,
      source: granularity === "day" ? "stats-daily" : "stats-history",
    });
    return;
  }

  if (url.pathname === "/api/recent") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const secondsParam = url.searchParams.has("seconds") ? Number(url.searchParams.get("seconds")) : NaN;
    const seconds = Number.isFinite(secondsParam) ? Math.min(Math.max(1, secondsParam), 120) : 30;
    const limitParam = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : NaN;
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 5_000) : 5_000;
    const cutoff = Date.now() - seconds * 1000;
    const packets = recentPackets.values()
      .filter((packet) => {
        const observedAt = Date.parse(packet.latest);
        return Number.isFinite(observedAt) && observedAt >= cutoff;
      })
      .slice(-limit);
    sendJson(response, 200, { count: packets.length, packets, seconds });
    return;
  }

  if (url.pathname === "/api/node-history") {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const key = String(url.searchParams.get("key") || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč uzlu." });
      return;
    }
    const requestedDays = Number(url.searchParams.get("days") || 7);
    const days = Number.isFinite(requestedDays) ? Math.min(30, Math.max(1, requestedDays)) : 7;
    sendJson(response, 200, { key, days, samples: metricsStore.history(key, days) });
    return;
  }

  const terrainMatch = /^\/api\/terrain\/(\d{1,2})\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
  if (terrainMatch) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const zoom = Number(terrainMatch[1]);
    const x = Number(terrainMatch[2]);
    const y = Number(terrainMatch[3]);
    const maxIndex = zoom >= 0 && zoom <= 14 ? 2 ** zoom - 1 : -1;
    if (maxIndex < 0 || x > maxIndex || y > maxIndex) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Invalid tile");
      return;
    }
    const cached = terrainCacheGet(`${zoom}/${x}/${y}`);
    if (!cached) {
      const rate = checkTerrainRate(clientIp(request));
      if (!rate.ok) {
        response.writeHead(429, {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": String(rate.retryAfter),
        }).end("Too Many Requests");
        return;
      }
    }
    try {
      const tile = await fetchTerrainTile(zoom, x, y);
      response.writeHead(200, {
        "Content-Type": tile.contentType,
        "Content-Length": tile.body.length,
        "Cache-Control": "public, max-age=604800, immutable",
      });
      response.end(request.method === "HEAD" ? undefined : tile.body);
    } catch (error) {
      const status = error?.status === 404 ? 404 : 502;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(status === 404 ? "Tile not found" : "Terrain unavailable");
    }
    return;
  }

  if (url.pathname === "/api/elevation") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    const lats = (url.searchParams.get("latitude") || "").split(",").filter((value) => value.trim() !== "");
    const lons = (url.searchParams.get("longitude") || "").split(",").filter((value) => value.trim() !== "");
    if (!lats.length || lats.length !== lons.length || lats.length > elevationMaxPoints) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Neplatný seznam souřadnic." }));
      return;
    }
    const points = lats.map((lat, index) => ({ lat: Number(lat), lon: Number(lons[index]) }));
    if (points.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lon))) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Neplatný seznam souřadnic." }));
      return;
    }
    const controller = new AbortController();
    let clientDisconnected = false;
    const disconnect = () => {
      if (!response.writableEnded) {
        clientDisconnected = true;
        controller.abort();
      }
    };
    response.once("close", disconnect);
    const timeout = setTimeout(() => controller.abort(), elevationTimeoutMs);
    timeout.unref();
    try {
      const elevations = await queueElevation(() => resolveElevations(points, controller.signal));
      if (clientDisconnected || response.destroyed) return;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ elevation: elevations }));
    } catch {
      if (clientDisconnected || response.destroyed) return;
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Výšky se nepodařilo načíst." }));
    } finally {
      clearTimeout(timeout);
      response.off("close", disconnect);
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const allowed = allowedApiPaths.some((path) => url.pathname === path);
    if (!allowed) {
      response.writeHead(404).end("Unknown API endpoint");
      return;
    }

    const controller = new AbortController();
    const isStatsPath = url.pathname === "/api/stats" && !url.search;
    let clientDisconnected = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, isStatsPath ? statsTimeoutMs : upstreamTimeoutMs);
    timeout.unref();
    const disconnect = () => {
      if (!response.writableEnded) {
        clientDisconnected = true;
        controller.abort();
      }
    };
    response.once("close", disconnect);

    const isNodes = url.pathname === "/api/nodes";
    const isResolve = url.pathname === "/api/resolve-hops";
    const isStats = isStatsPath;
    const cacheKey = `${url.pathname}${url.search}`;
    if (isNodes && nodesCache && nodesCacheFresh()) {
      const stale = Date.now() - Number(nodesCache.at || 0) > nodesSoftTtlMs;
      clearTimeout(timeout);
      sendJson(
        response,
        200,
        buildNodesPayload(JSON.parse(nodesCache.body)),
        stale ? { "X-Data-Stale": "1" } : {},
      );
      if (stale) void collectNodeMetrics();
      return;
    }
    if (isStats && statsCache && statsCacheFresh()) {
      const stale = Date.now() - Number(statsCache.at || 0) > statsSoftTtlMs;
      clearTimeout(timeout);
      sendStatsCache(response, stale);
      if (stale) void refreshStatsCache();
      return;
    }
    try {
      const upstreamResponse = await fetch(`${upstream}${url.pathname}${url.search}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (isNodes && upstreamResponse.ok) {
        const data = await upstreamResponse.json();
        storeNodesCache(data);
        sendJson(response, upstreamResponse.status, buildNodesPayload(data));
        return;
      }
      const body = Buffer.from(await upstreamResponse.arrayBuffer());
      if (upstreamResponse.ok && isStats) {
        storeStatsCache(body, upstreamResponse.headers.get("content-type"));
      }
      if (upstreamResponse.ok && isResolve) {
        resolveCacheSet(cacheKey, body, upstreamResponse.headers.get("content-type"));
      }
      if (!upstreamResponse.ok && isNodes && nodesCacheFresh()) {
        sendJson(response, 200, buildNodesPayload(JSON.parse(nodesCache.body)), { "X-Data-Stale": "1" });
        return;
      }
      if (!upstreamResponse.ok && isStats && statsCacheFresh()) {
        sendStatsCache(response, true);
        return;
      }
      if (!upstreamResponse.ok && isStats && sendStatsFallback(response)) {
        return;
      }
      if (!upstreamResponse.ok && isResolve) {
        const cached = resolveCacheGet(cacheKey);
        if (cached) {
          response.writeHead(200, {
            "Content-Type": cached.contentType || "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Data-Stale": "1",
          });
          response.end(cached.body);
          return;
        }
      }
      response.writeHead(upstreamResponse.status, {
        "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      if (clientDisconnected || response.destroyed) return;
      if (isNodes && nodesCacheFresh()) {
        sendJson(response, 200, buildNodesPayload(JSON.parse(nodesCache.body)), { "X-Data-Stale": "1" });
        return;
      }
      if (isStats && statsCacheFresh()) {
        sendStatsCache(response, true);
        return;
      }
      if (isStats && sendStatsFallback(response)) {
        return;
      }
      if (isResolve) {
        const cached = resolveCacheGet(cacheKey);
        if (cached) {
          response.writeHead(200, {
            "Content-Type": cached.contentType || "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Data-Stale": "1",
          });
          response.end(cached.body);
          return;
        }
      }
      response.writeHead(timedOut ? 504 : 502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: timedOut ? "Analyzer API timed out" : "Analyzer API is unavailable",
      }));
    } finally {
      clearTimeout(timeout);
      response.off("close", disconnect);
    }
    return;
  }

  const changelogPath = sitePath("/changelog");
  const changelogPaths = new Set(["/changelog", "/changelog/", changelogPath, `${changelogPath}/`]);
  if (changelogPaths.has(decodedPathname)) {
    const changelogFile = join(dist, "changelog.html");
    if (!existsSync(changelogFile)) {
      response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Changelog není k dispozici");
      return;
    }
    sendFile(response, changelogFile);
    return;
  }

  const relativePath = normalize(decodedPathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(dist, relativePath === "/" ? "index.html" : relativePath);
  if (!filePath.startsWith(dist)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(dist, "index.html");
  if (!existsSync(filePath)) {
    response.writeHead(503).end("Run npm run build first");
    return;
  }
  sendFile(response, filePath);
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error(`Request failed: ${error?.stack || error}`);
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Internal Server Error");
  });
});

server.listen(port, host, () => {
  console.log(`MeshCore CZ map listening on http://${host}:${port}`);
});

if (monitorAlertsEnabled) {
  setTimeout(() => { void checkOperationalAlerts(); }, 15_000).unref();
  setInterval(() => { void checkOperationalAlerts(); }, monitorIntervalMs).unref();
}

function shutdown() {
  for (const client of packetStreams) closePacketStream(client);
  metricsStore.close();
  packetStore.close();
  visitStore.close();
  feedbackStore.close();
  nodeInfoStore.close();
  commentStore.close();
  photoStore.close?.();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
