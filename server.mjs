import { createHmac, randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { TimeBoundRingBuffer } from "./backend-utils.mjs";
import { createNodeMetricsStore } from "./node-metrics.mjs";
import { createPacketStore } from "./packet-store.mjs";
import { createCzHealthStore } from "./cz-health-store.mjs";
import { createVisitStatsStore } from "./visit-stats.mjs";
import { createFeedbackStore } from "./feedback.mjs";
import { createPhotoStore, detectImage, PhotoError } from "./photos.mjs";
import { createNodeInfoStore } from "./node-info.mjs";
import { createCommentStore } from "./comments.mjs";
import { fetchRepeaterPage, findRepeaterPage, validRepeaterSlug } from "./repeater-pages.mjs";
import { createTelegramNotifier } from "./notify.mjs";
import { escapeHtml } from "./html.mjs";
import { createAdminAuth } from "./admin-auth.mjs";
import { createAdminPages } from "./admin-pages.mjs";
import { createCollectors } from "./collectors.mjs";
import { createElevationTerrain } from "./elevation-terrain.mjs";
import { createMonitor } from "./monitor.mjs";
import { createHttpRequestHandler } from "./http-server.mjs";
import { createMqttIngest } from "./mqtt-ingest.mjs";
import { createLegacyPages } from "./legacy-pages.mjs";
import { createRateLimiter, formatCsDate, hashIp, methodNotAllowed, safeEqualText } from "./http-utils.mjs";

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
const healthDbPath = process.env.CZ_HEALTH_DB_PATH || join(process.cwd(), "data", "cz-health.sqlite");
const healthStore = createCzHealthStore(healthDbPath, {
  retentionMs: Math.max(1, Number(process.env.CZ_HEALTH_RETENTION_MS || 90 * 24 * 60 * 60 * 1000)),
});
const visitsDbPath = process.env.VISITS_DB_PATH || join(process.cwd(), "data", "visits.sqlite");
const visitStore = createVisitStatsStore(visitsDbPath);
const feedbackDbPath = process.env.FEEDBACK_DB_PATH || join(process.cwd(), "data", "feedback.sqlite");
const feedbackStore = createFeedbackStore(feedbackDbPath);
const nodeInfoDbPath = process.env.NODE_INFO_DB_PATH || join(process.cwd(), "data", "node-info.sqlite");
const nodeInfoStore = createNodeInfoStore(nodeInfoDbPath);
const commentsDbPath = process.env.COMMENTS_DB_PATH || join(process.cwd(), "data", "comments.sqlite");
const commentStore = createCommentStore(commentsDbPath);
const feedbackToken = process.env.FEEDBACK_TOKEN || "";
const photoDir = process.env.PHOTO_DIR || join(process.cwd(), "uploads");
const photoMaxBytes = Math.max(1024, Number(process.env.PHOTO_MAX_BYTES || 5 * 1024 * 1024));
const photoAutoApprove = process.env.PHOTO_AUTO_APPROVE === "1";
const photoStore = createPhotoStore(photoDir, {
  maxBytes: photoMaxBytes,
  maxDimension: Math.max(100, Number(process.env.PHOTO_MAX_DIMENSION || 2400)),
  maxPerNode: Math.max(1, Number(process.env.PHOTO_MAX_PER_NODE || 12)),
  maxRows: Math.max(10, Number(process.env.PHOTO_MAX_ROWS || 10_000)),
  maxTotalBytes: Math.max(1024 * 1024, Number(process.env.PHOTO_MAX_TOTAL_BYTES || 2 * 1024 * 1024 * 1024)),
});
const photoToken = process.env.PHOTO_TOKEN || feedbackToken;
if (!photoToken) {
  console.warn("Photo uploads are disabled: set PHOTO_TOKEN or FEEDBACK_TOKEN");
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
const adminAuth = createAdminAuth({
  adminBasePath,
  fallbackPassword: feedbackToken || process.env.PHOTO_TOKEN || "",
  readBody,
});
const {
  checkLogin: checkAdminLogin,
  cookie: adminCookie,
  createSessionToken: createAdminSessionToken,
  readForm: readAdminForm,
  redirect: redirectAdmin,
  safeNext: safeAdminNext,
  sameOrigin: sameOriginRequest,
  sessionValid: adminSessionValid,
} = adminAuth;
if (!adminAuth.configured) {
  console.warn("Admin UI is disabled: set ADMIN_PASSWORD or FEEDBACK_TOKEN");
}
const repeaterImportEnabled = publicBasePath === "/beta" || process.env.REPEATER_IMPORT === "1";

function sitePath(path = "/") {
  return `${publicBasePath}${path}`;
}

function adminPath(path = "") {
  return `${adminBasePath}${path}`;
}

const telegramChatId = process.env.TELEGRAM_CHAT_ID || "";
const telegramNotifier = createTelegramNotifier({
  apiBase: process.env.TELEGRAM_API_BASE || "https://api.telegram.org",
  chatId: telegramChatId,
  timeoutMs: Math.max(1000, Number(process.env.TELEGRAM_TIMEOUT_MS || 5000)),
  token: process.env.TELEGRAM_BOT_TOKEN || "",
});
const telegramInteractive = process.env.TELEGRAM_INTERACTIVE === "1";
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const telegramInteractiveEnabled = telegramInteractive && Boolean(telegramWebhookSecret) && telegramNotifier.enabled;
const telegramAllowedUserIds = new Set(String(process.env.TELEGRAM_ADMIN_USER_IDS || "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const telegramNotifyPhotos = process.env.TELEGRAM_NOTIFY_PHOTOS !== "0";
const telegramNotifyReports = process.env.TELEGRAM_NOTIFY_REPORTS !== "0";
const telegramNotifyFeedback = process.env.TELEGRAM_NOTIFY_FEEDBACK === "1";
const telegramNotifyNodeInfo = process.env.TELEGRAM_NOTIFY_NODE_INFO !== "0";
const telegramNotifyComments = process.env.TELEGRAM_NOTIFY_COMMENTS !== "0";
const telegramAdminLink = process.env.TELEGRAM_ADMIN_LINK === "1";
const telegramSilent = process.env.TELEGRAM_SILENT === "1";
if (telegramNotifier.enabled) {
  console.log("Telegram admin notifications enabled");
}
if (telegramInteractive && !telegramWebhookSecret) {
  console.warn("Telegram interactive approvals disabled: set TELEGRAM_WEBHOOK_SECRET");
} else if (telegramInteractive && !telegramNotifier.enabled) {
  console.warn("Telegram interactive approvals disabled: bot token or chat id missing");
}
const elevationTerrain = createElevationTerrain();
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
let advert24hCache = { at: 0, counts: new Map() };
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

function advertCounts24h(now = Date.now()) {
  if (now - advert24hCache.at < 60_000) return advert24hCache.counts;
  let counts = new Map();
  try {
    counts = packetStore.advertCountsSince(now - 24 * 60 * 60 * 1000);
  } catch (error) {
    console.error(`Advert 24h count failed: ${error.message}`);
  }
  advert24hCache = { at: now, counts };
  return counts;
}

function buildNodesPayload(data) {
  const payload = { ...data };
  const advertCounts = advertCounts24h();
  const nodes = metricsStore.decorateNodes(Array.isArray(payload.nodes) ? payload.nodes : [])
    .map((node) => ({
      ...node,
      advert_count_24h: advertCounts.get(String(node.public_key || "").toLowerCase()) || 0,
    }));
  payload.nodes = healthStore.decorateNodes(nodes);
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

const feedbackRateLimit = Math.max(1, Number(process.env.FEEDBACK_RATE_LIMIT || 15));
const feedbackDailyLimit = Math.max(10, Number(process.env.FEEDBACK_DAILY_LIMIT || 300));
const feedbackMaxRows = Math.max(100, Number(process.env.FEEDBACK_MAX_ROWS || 5000));
const feedbackCooldownMs = Math.max(0, Number(process.env.FEEDBACK_COOLDOWN_MS || 30_000));
const checkFeedback = createRateLimiter({
  limit: feedbackRateLimit,
  cooldownMs: feedbackCooldownMs,
  messages: {
    cooldown: "Mezi zprávami je krátká pauza, zkuste to prosím za chvíli.",
    limit: "Příliš mnoho zpráv za hodinu, zkuste to později.",
  },
});

function startOfUtcDay(now) {
  return Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
}

const commentRateLimit = Math.max(1, Number(process.env.COMMENT_RATE_LIMIT || 10));
const commentDailyLimit = Math.max(10, Number(process.env.COMMENT_DAILY_LIMIT || 200));
const commentMaxRows = Math.max(100, Number(process.env.COMMENT_MAX_ROWS || 5000));
const commentCooldownMs = Math.max(0, Number(process.env.COMMENT_COOLDOWN_MS || 15_000));
const checkComment = createRateLimiter({
  limit: commentRateLimit,
  cooldownMs: commentCooldownMs,
  messages: {
    cooldown: "Mezi komentáři je krátká pauza, zkuste to prosím za chvíli.",
    limit: "Příliš mnoho komentářů za hodinu, zkuste to později.",
  },
});

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

const photoRateLimit = Math.max(1, Number(process.env.PHOTO_RATE_LIMIT || 8));
const photoDailyLimit = Math.max(1, Number(process.env.PHOTO_DAILY_LIMIT || 30));
const photoCooldownMs = Math.max(0, Number(process.env.PHOTO_COOLDOWN_MS || 10_000));
const photoReportLimit = Math.max(1, Number(process.env.PHOTO_REPORT_RATE_LIMIT || 5));
const photoReportCooldownMs = Math.max(0, Number(process.env.PHOTO_REPORT_COOLDOWN_MS || 10_000));

const checkPhotoUpload = createRateLimiter({
  limit: photoRateLimit,
  dailyLimit: photoDailyLimit,
  cooldownMs: photoCooldownMs,
  messages: {
    cooldown: "Mezi nahráním fotek je krátká pauza, zkuste to prosím za chvíli.",
    limit: "Příliš mnoho nahraných fotek za hodinu, zkuste to později.",
    daily: "Denní limit nahrávání fotek byl vyčerpán.",
  },
});

const checkPhotoReport = createRateLimiter({
  limit: photoReportLimit,
  cooldownMs: photoReportCooldownMs,
  messages: {
    cooldown: "Mezi žádostmi je krátká pauza, zkuste to prosím za chvíli.",
    limit: "Příliš mnoho žádostí za hodinu, zkuste to později.",
  },
});
const checkPhotoManage = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
});
const checkPhotoVote = createRateLimiter({
  cooldownMs: Math.max(0, Number(process.env.PHOTO_VOTE_COOLDOWN_MS || 0)),
  limit: Math.max(1, Number(process.env.PHOTO_VOTE_RATE_LIMIT || 40)),
  windowMs: 60 * 1000,
  messages: {
    cooldown: "Mezi hlasy je krátká pauza, zkuste to prosím za chvíli.",
    limit: "Příliš mnoho hlasů za minutu, zkuste to později.",
  },
});

const nodeInfoRateLimit = Math.max(1, Number(process.env.NODE_INFO_RATE_LIMIT || 10));
const nodeInfoDailyLimit = Math.max(1, Number(process.env.NODE_INFO_DAILY_LIMIT || 50));
const nodeInfoCooldownMs = Math.max(0, Number(process.env.NODE_INFO_COOLDOWN_MS || 5_000));
const checkNodeInfo = createRateLimiter({
  limit: nodeInfoRateLimit,
  dailyLimit: nodeInfoDailyLimit,
  cooldownMs: nodeInfoCooldownMs,
  messages: {
    cooldown: "Mezi úpravami info je krátká pauza, zkuste to prosím za chvíli.",
    limit: "Příliš mnoho úprav info za hodinu.",
    daily: "Denní limit úprav info byl vyčerpán.",
  },
});



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

function telegramCallbackData(action, value) {
  if (!telegramInteractiveEnabled) return "";
  const raw = `${action}:${value}`;
  const signature = createHmac("sha256", telegramWebhookSecret).update(raw).digest("base64url").slice(0, 12);
  return `${raw}.${signature}`;
}

function parseTelegramCallbackData(value) {
  const text = String(value || "");
  const separator = text.lastIndexOf(".");
  if (separator <= 0) return null;
  const raw = text.slice(0, separator);
  const signature = text.slice(separator + 1);
  if (signature.length !== 12) return null;
  const expected = createHmac("sha256", telegramWebhookSecret).update(raw).digest("base64url").slice(0, 12);
  if (!safeEqualText(signature, expected)) return null;
  const colon = raw.indexOf(":");
  if (colon <= 0 || colon === raw.length - 1) return null;
  return { action: raw.slice(0, colon), value: raw.slice(colon + 1) };
}

function encodeTelegramNodeKey(value) {
  const key = String(value || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return "";
  return Buffer.from(key, "hex").toString("base64url");
}

function decodeTelegramNodeKey(value) {
  try {
    const key = Buffer.from(String(value || ""), "base64url").toString("hex").toLowerCase();
    return /^[0-9a-f]{64}$/.test(key) ? key : "";
  } catch {
    return "";
  }
}

function telegramInlineKeyboard(rows) {
  if (!telegramInteractiveEnabled) return null;
  const keyboard = rows.filter((row) => Array.isArray(row) && row.length);
  return keyboard.length ? { inline_keyboard: keyboard } : null;
}

function photoTelegramKeyboard(photo) {
  if (!photo?.id) return null;
  return telegramInlineKeyboard([[
    { callback_data: telegramCallbackData("pa", photo.id), text: "✅ Schválit" },
    { callback_data: telegramCallbackData("dp", photo.id), text: "🗑 Smazat" },
  ]]);
}

function reportTelegramKeyboard(reportId, photoId) {
  if (!reportId || !photoId) return null;
  return telegramInlineKeyboard([[
    { callback_data: telegramCallbackData("dp", photoId), text: "🗑 Smazat fotku" },
    { callback_data: telegramCallbackData("rr", reportId), text: "✖ Zamítnout žádost" },
  ]]);
}

function nodeInfoTelegramKeyboard(nodeKey) {
  const encoded = encodeTelegramNodeKey(nodeKey);
  if (!encoded) return null;
  return telegramInlineKeyboard([[
    { callback_data: telegramCallbackData("na", encoded), text: "✅ Schválit změnu" },
    { callback_data: telegramCallbackData("nr", encoded), text: "✖ Zamítnout" },
  ]]);
}

function notifyTelegram(text, { replyMarkup = null } = {}) {
  if (!telegramNotifier.enabled) return;
  void telegramNotifier.send(text, { replyMarkup, silent: telegramSilent }).catch((error) => {
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
  const replyMarkup = !published && photosToNotify.length === 1 ? photoTelegramKeyboard(first) : null;
  notifyTelegram(lines.join("\n"), { replyMarkup });
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

function notifyNewReport({ contact, message, photo, reason, reportId }) {
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
  notifyTelegram(lines.join("\n"), { replyMarkup: reportTelegramKeyboard(reportId, photo.id) });
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
  const replyMarkup = status === "pending" ? nodeInfoTelegramKeyboard(info.nodeKey) : null;
  notifyTelegram(lines.join("\n"), { replyMarkup });
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

function telegramCallbackAllowed(callback) {
  const chatId = String(callback?.message?.chat?.id || "");
  if (!telegramChatId || !safeEqualText(chatId, telegramChatId)) return false;
  const fromId = String(callback?.from?.id || "");
  if (telegramAllowedUserIds.size) return telegramAllowedUserIds.has(fromId);
  return safeEqualText(fromId, telegramChatId);
}

async function updateTelegramCallbackMessage(callback, message, ok) {
  const chatId = callback?.message?.chat?.id;
  const messageId = callback?.message?.message_id;
  if (!chatId || !messageId) return;
  const original = String(callback.message.text || "").trim();
  const base = original.replace(/\n\n(?:✅|⚠️) [^\n]*$/, "").trimEnd();
  const result = `${base ? `${base}\n\n` : ""}${ok ? "✅" : "⚠️"} ${message}`;
  const edited = await telegramNotifier.editMessageText(chatId, messageId, result, {
    replyMarkup: { inline_keyboard: [] },
  });
  if (!edited) await telegramNotifier.send(result);
}

async function processTelegramCallback(callback) {
  const callbackId = callback?.id;
  if (!callbackId) return;
  if (!telegramCallbackAllowed(callback)) {
    await telegramNotifier.answerCallbackQuery(callbackId, {
      showAlert: true,
      text: "Nemáš oprávnění k této akci.",
    });
    return;
  }
  const parsed = parseTelegramCallbackData(callback.data);
  if (!parsed) {
    await telegramNotifier.answerCallbackQuery(callbackId, {
      showAlert: true,
      text: "Neplatná nebo expirovaná akce.",
    });
    return;
  }

  let ok = false;
  let message = "Akce není dostupná.";
  if (parsed.action === "pa") {
    ok = photoStore.setStatus(parsed.value, "approved");
    message = ok ? "Fotka byla schválena." : "Fotku už nelze schválit.";
  } else if (parsed.action === "dp") {
    ok = photoStore.remove(parsed.value);
    if (ok) photoStore.resolvePhotoReports(parsed.value);
    message = ok ? "Fotka byla smazána." : "Fotka už není dostupná.";
  } else if (parsed.action === "rr") {
    ok = photoStore.resolveReport(parsed.value);
    message = ok ? "Žádost byla zamítnuta, fotka zůstala." : "Žádost už není otevřená.";
  } else if (parsed.action === "na" || parsed.action === "nr") {
    const nodeKey = decodeTelegramNodeKey(parsed.value);
    if (nodeKey) {
      if (parsed.action === "na") {
        ok = Boolean(nodeInfoStore.approve(nodeKey));
        message = ok ? "Změna uživatelského info byla schválena." : "Změna už není dostupná.";
      } else {
        ok = nodeInfoStore.reject(nodeKey);
        message = ok ? "Změna uživatelského info byla zamítnuta." : "Změna už není dostupná.";
      }
    }
  }

  await telegramNotifier.answerCallbackQuery(callbackId, { text: message });
  await updateTelegramCallbackMessage(callback, message, ok);
}

async function handleTelegramWebhook(request, response) {
  if (!telegramInteractiveEnabled) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
    return;
  }
  if (request.method !== "POST") {
    methodNotAllowed(response, "POST");
    return;
  }
  const providedSecret = request.headers["x-telegram-bot-api-secret-token"];
  if (typeof providedSecret !== "string" || !safeEqualText(providedSecret, telegramWebhookSecret)) {
    response.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }).end("Unauthorized");
    return;
  }
  let update;
  try {
    update = JSON.parse(await readBody(request, 65_536));
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad Request");
    return;
  }
  sendJson(response, 200, { ok: true });
  if (!update?.callback_query) return;
  void processTelegramCallback(update.callback_query).catch((error) => {
    console.error(`Telegram callback failed: ${error.message}`);
  });
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
  return { build: currentBuild(), connected: mqttIngest.getState().connected, time: Date.now(), viewers: packetStreams.size };
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


function healthPayload() {
  const now = Date.now();
  const nodes = cacheHealth(nodesCache, nodesSoftTtlMs);
  const stats = cacheHealth(statsCache, statsSoftTtlMs);
  const mqttState = mqttIngest.getState();
  const cacheStats = elevationTerrain.stats();
  const degraded = (mqttIngest.enabled && !mqttState.connected) || nodes.stale;
  return {
    status: degraded ? "degraded" : "ok",
    build: currentBuild(),
    time: now,
    uptimeSec: Math.floor((now - serverStartedAt) / 1000),
    upstream,
    mqtt: {
      enabled: mqttIngest.enabled,
      connected: mqttState.connected,
      connectedForSec: mqttState.connectedSince ? Math.floor((now - mqttState.connectedSince) / 1000) : null,
      reconnects: mqttState.reconnects,
      lastPacketAgeSec: mqttState.lastPacketAt ? Math.floor((now - mqttState.lastPacketAt) / 1000) : null,
    },
    streams: packetStreams.size,
    caches: {
      elevation: cacheStats.elevation,
      nodes,
      resolve: resolveCache.size,
      stats,
      terrain: cacheStats.terrain,
    },
    packets: {
      bufferedRecent: recentPackets.values(now).length,
      distinct24h: packetStore.countDistinctSince(now - 24 * 60 * 60 * 1000),
      stored: packetStore.count(),
    },
    photos: photoStore.stats(),
    notifications: {
      telegram: telegramNotifier.enabled,
      telegramInteractive: telegramInteractiveEnabled,
    },
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

const mqttIngest = createMqttIngest({
  broadcast,
  broadcastStatus,
  healthStore,
  packetStore,
  recentPackets,
  toStoreRow,
});
mqttIngest.start();

setInterval(() => {
  for (const client of packetStreams) writePacketStream(client, ": keepalive\n\n");
}, 20_000).unref();

// Pravidelný status: klienti si obnoví čas (kvůli posunu hodin) i počet diváků.
setInterval(broadcastStatus, 60_000).unref();

const collectors = createCollectors({
  metricsCollectionMs,
  metricsStore,
  mqttIngest,
  packetCollectionMs,
  packetStore,
  statsCollectMs,
  statsTimeoutMs,
  storeNodesCache,
  storeStatsCache,
  toStoreRow,
  upstream,
  upstreamTimeoutMs,
});
mqttIngest.backfillHealth();
collectors.start();

setInterval(() => healthStore.prune(), 6 * 60 * 60 * 1000).unref();

visitStore.prune();
setInterval(() => visitStore.prune(), 24 * 60 * 60 * 1000).unref();



const {
  renderAdminLogin,
  adminDashboardPage,
  adminPhotoPage,
  adminCommentsPage,
  adminFeedbackPage,
  adminRepeaterImportPage,
  adminRepeaterSyncAllPage,
  adminRepeaterSyncPage,
  adminNodeInfoPage,
  adminNodeInfoEditPage,
} = createAdminPages({
  adminBasePath,
  adminPath,
  sitePath,
  formatCsDate,
  photoStore,
  visitStore,
  feedbackStore,
  commentStore,
  nodeInfoStore,
  photoAutoApprove,
  repeaterImportEnabled,
  photoNodeNames,
  isMqttConnected: () => mqttIngest.getState().connected,
  packetStreamCount: () => packetStreams.size,
});
const { renderPhotoPage, renderFeedbackPage } = createLegacyPages({
  photoStore,
  photoNodeNames,
  formatCsDate,
});

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





const handleRequest = createHttpRequestHandler({
  addLocalDays,
  adminAuth,
  adminBasePath,
  adminCommentsPage,
  adminCookie,
  adminDashboardPage,
  adminFeedbackPage,
  adminNodeInfoEditPage,
  adminNodeInfoPage,
  adminPhotoPage,
  adminRepeaterImportPage,
  adminRepeaterSyncAllPage,
  adminRepeaterSyncPage,
  adminSessionValid,
  allowedApiPaths,
  broadcastStatus,
  buildNodesPayload,
  cachedNodeByKey,
  checkAdminLogin,
  checkComment,
  checkFeedback,
  checkNodeInfo,
  checkPhotoManage,
  checkPhotoReport,
  checkPhotoUpload,
  checkPhotoVote,
  checkTerrainRate: elevationTerrain.checkTerrainRate,
  cleanPhotoText,
  clientIp,
  collectNodeMetrics: collectors.collectNodeMetrics,
  commentDailyLimit,
  commentMaxRows,
  commentStore,
  createAdminSessionToken,
  currentBuild,
  decodeHeaderValue,
  dist,
  elevationMaxPoints: elevationTerrain.elevationMaxPoints,
  elevationTimeoutMs: elevationTerrain.elevationTimeoutMs,
  feedbackDailyLimit,
  feedbackMaxRows,
  feedbackStore,
  feedbackToken,
  fetchNodeDetail,
  fetchTerrainTile: elevationTerrain.fetchTerrainTile,
  handleTelegramWebhook,
  healthPayload,
  healthStore,
  historyRowToPacket,
  importRepeaterPhoto,
  maxPacketStreams,
  metricsStore,
  nodeInfoStore,
  nodesCacheFresh,
  nodesSoftTtlMs,
  notifyNewComment,
  notifyNewFeedback,
  notifyNewReport,
  notifyNodeInfo,
  packetStore,
  packetStreams,
  photoAutoApprove,
  photoMaxBytes,
  photoNodeNames,
  photoStore,
  photoToken,
  publicBasePath,
  queueElevation: elevationTerrain.queueElevation,
  queueNewPhotoNotification,
  readAdminForm,
  readBody,
  readBodyBuffer,
  recentPackets,
  redirectAdmin,
  refreshStatsCache: collectors.refreshStatsCache,
  renderAdminLogin,
  renderFeedbackPage,
  renderPhotoPage,
  repeaterImportEnabled,
  repeaterPageSlug,
  repeaterSyncPlan,
  requestBase,
  resolveCacheGet,
  resolveCacheSet,
  resolveElevations: elevationTerrain.resolveElevations,
  resolveImportNode,
  safeAdminNext,
  sameOriginRequest,
  securityHeaders,
  sendFile,
  sendJson,
  sendStatsCache,
  sendStatsFallback,
  sendStreamEvent,
  sitePath,
  startOfLocalDay,
  startOfUtcDay,
  statsCacheFresh,
  statsCollectMs,
  statsDailyRetentionDays,
  statsHistoryDays,
  statsSoftTtlMs,
  statsTimeoutMs,
  storeNodesCache,
  storeStatsCache,
  terrainCacheGet: elevationTerrain.terrainCacheGet,
  trustedRepeaterSourceUrl,
  upstream,
  upstreamTimeoutMs,
  visitStore,
  getNodesCache: () => nodesCache,
  getStatsCache: () => statsCache,
});

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
  if (telegramInteractiveEnabled) {
    const webhookUrl = `${publicBaseUrl}/api/telegram/webhook`;
    void telegramNotifier.setWebhook(webhookUrl, { secretToken: telegramWebhookSecret }).then((ok) => {
      if (ok) console.log("Telegram interactive approvals enabled");
      else console.warn(`Telegram webhook registration failed: ${webhookUrl}`);
    }).catch((error) => {
      console.error(`Telegram webhook registration failed: ${error.message}`);
    });
  }
});

const monitor = createMonitor({
  getLastPacketAt: () => mqttIngest.getState().lastPacketAt,
  getMqttState: () => ({ connected: mqttIngest.getState().connected, enabled: mqttIngest.enabled }),
  notify: notifyTelegram,
});
monitor.start();

function shutdown() {
  for (const client of packetStreams) closePacketStream(client);
  metricsStore.close();
  packetStore.close();
  healthStore.close();
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
