import { createRateLimiter } from "./http-utils.mjs";

const WRITE_PATHS = new Set(["/api/photos", "/api/photos/report", "/api/comments", "/api/feedback", "/api/node-info"]);

export function requiresTurnstile(method, path) {
  return method === "POST" && (WRITE_PATHS.has(path) || /^\/api\/photos\/[0-9a-f-]{36}\/vote$/.test(path));
}

export function createTurnstile({ enabled = false, siteKey = "", secretKey = "", hostname = "", fetchImpl = fetch } = {}) {
  if (enabled && (!siteKey || !secretKey || !hostname)) {
    throw new Error("Turnstile requires TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY and PUBLIC_BASE_URL hostname");
  }
  const check = createRateLimiter({ windowMs: 60_000, limit: 120 });
  return {
    enabled,
    publicConfig: () => ({ enabled, siteKey: enabled ? siteKey : "" }),
    async verify(request, ip) {
      if (!enabled) return { ok: true };
      const token = request.headers["x-turnstile-token"];
      if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, status: 403 };
      const rate = check(ip);
      if (!rate.ok) return { ok: false, status: 429, retryAfter: rate.retryAfter };
      try {
        const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: secretKey, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return { ok: false, status: 503 };
        const result = await response.json();
        return {
          ok: result.success === true && result.hostname === hostname && result.action === "map_write",
          status: 403,
        };
      } catch {
        return { ok: false, status: 503 };
      }
    },
  };
}
