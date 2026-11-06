import { createHash } from "node:crypto";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createRateLimiter({ windowMs = HOUR_MS, cooldownMs = 0, limit = 1, dailyLimit = null, messages = {} }) {
  const map = new Map();
  function check(ip, now = Date.now(), options = {}) {
    const windowStart = now - windowMs;
    const dayStart = now - DAY_MS;
    const retentionStart = dailyLimit != null ? dayStart : windowStart;
    const stamps = (map.get(ip) || []).filter((stamp) => stamp > retentionStart);
    const last = stamps[stamps.length - 1];
    if (!options.skipCooldown && cooldownMs > 0 && last != null && now - last < cooldownMs) {
      map.set(ip, stamps);
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((cooldownMs - (now - last)) / 1000)),
        message: messages.cooldown,
      };
    }
    const windowCount = dailyLimit != null ? stamps.filter((stamp) => stamp > windowStart).length : stamps.length;
    if (windowCount >= limit) {
      map.set(ip, stamps);
      const retryAfter = dailyLimit != null ? 3600 : Math.max(1, Math.ceil((stamps[0] + windowMs - now) / 1000));
      return { ok: false, retryAfter, message: messages.limit };
    }
    if (dailyLimit != null && stamps.length >= dailyLimit) {
      map.set(ip, stamps);
      return { ok: false, retryAfter: 3600, message: messages.daily };
    }
    stamps.push(now);
    map.set(ip, stamps);
    if (map.size > 5000) {
      for (const [key, value] of map) {
        if (!value.some((stamp) => stamp > retentionStart)) map.delete(key);
      }
    }
    return { ok: true };
  }
  check.reset = (ip) => {
    map.delete(ip);
  };
  return check;
}

export function hashIp(ip) {
  return createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16);
}

export function formatCsDate(value) {
  return new Date(value).toLocaleString("cs-CZ");
}

export function methodNotAllowed(response, allow, extraHeaders = {}) {
  response.writeHead(405, { Allow: allow, ...extraHeaders }).end("Method Not Allowed");
}
