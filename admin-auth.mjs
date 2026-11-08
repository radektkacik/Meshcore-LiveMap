import { createHmac } from "node:crypto";
import { createRateLimiter, safeEqualText } from "./http-utils.mjs";

export function createAdminAuth({
  adminBasePath,
  fallbackPassword = "",
  readBody,
}) {
  const password = process.env.ADMIN_PASSWORD || fallbackPassword || "";
  const sessionSecret = process.env.ADMIN_SESSION_SECRET || password;
  const sessionTtlMs = Math.max(60_000, Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000));
  const checkLogin = createRateLimiter({
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });

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

  function sessionValid(request) {
    if (!configured) return false;
    const token = parseCookieHeader(request.headers.cookie).mc_admin;
    if (!token) return false;
    const [expires, signature] = String(token).split(".");
    if (!/^\d+$/.test(expires) || !signature || Number(expires) <= Date.now()) return false;
    const expected = createHmac("sha256", sessionSecret).update(expires).digest("base64url");
    return safeEqualText(signature, expected);
  }

  function createSessionToken(now = Date.now()) {
    const expires = String(now + sessionTtlMs);
    const signature = createHmac("sha256", sessionSecret).update(expires).digest("base64url");
    return `${expires}.${signature}`;
  }

  function cookie(request, value, maxAge = Math.floor(sessionTtlMs / 1000)) {
    const secure = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https"
      || Boolean(request.socket?.encrypted);
    return `mc_admin=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict;${secure ? " Secure;" : ""} Max-Age=${maxAge}`;
  }

  function sameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
    }
  }

  function safeNext(value) {
    const next = String(value || "");
    return (next === adminBasePath || next.startsWith(`${adminBasePath}/`)) && !next.startsWith("//")
      ? next
      : adminBasePath;
  }

  async function readForm(request) {
    try {
      return new URLSearchParams(await readBody(request, 8192));
    } catch {
      return null;
    }
  }

  function redirect(response, location) {
    response.writeHead(303, { "Cache-Control": "no-store", Location: location });
    response.end();
  }

  const configured = Boolean(password && sessionSecret);

  return {
    checkLogin,
    configured,
    cookie,
    createSessionToken,
    readForm,
    redirect,
    safeNext,
    sameOrigin,
    sessionValid,
    verifyPassword: (value) => safeEqualText(value, password),
  };
}
