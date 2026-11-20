const DEFAULT_ENDPOINT = "https://czhealth-api.meshcore.website";
const INTERVAL = 5 * 60_000;

export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

async function readJsonBounded(response, limit = 4 * 1024 * 1024) {
  if (!response.body) throw new Error("empty-response");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("oversized-response"); }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createCzHealthHubSync({ store, baseUrl = DEFAULT_ENDPOINT, apiKey, clientId, clientSecret, fetchImpl = fetch, logger = console }) {
  let timer = null, stopped = true, running = false, backoffUntil = 0, controller = null;
  let lastSuccess = null, lastError = null;
  const base = String(baseUrl || DEFAULT_ENDPOINT).trim().replace(/\/$/, "");
  const key = String(apiKey || "").trim();
  const accessId = String(clientId || "").trim();
  const accessSecret = String(clientSecret || "").trim();
  const configured = Boolean(base && key && accessId && accessSecret);

  async function describeFailure(response) {
    const type = response.headers.get("content-type") || "";
    const via = (response.headers.get("via") || "").toLowerCase();
    const source = via.includes("caddy") ? "API" : "Cloudflare";
    let body = "";
    if (type.includes("application/json") || type.startsWith("text/")) {
      try { body = (await response.text()).slice(0, 200); } catch {}
    }
    return `${source} HTTP ${response.status} ${type} cf-ray=${response.headers.get("cf-ray") || "-"}`
      + ` location=${response.headers.get("location") || "-"} body=${JSON.stringify(body)}`;
  }

  async function run() {
    if (!configured || running || Date.now() < backoffUntil) return;
    running = true;
    try {
      for (let count = 0; count < 1000 && !stopped; count += 1) {
        const url = new URL(`${base}/czhealth/v1/changes`);
        url.searchParams.set("cursor", String(store.cursor()));
        url.searchParams.set("limit", "500");
        controller = new AbortController();
        const response = await fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${key}`,
            "CF-Access-Client-Id": accessId,
            "CF-Access-Client-Secret": accessSecret,
            "User-Agent": "mapa-sync/1.0",
          },
          redirect: "manual",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        });
        if (stopped) return;
        if (response.status === 429) {
          lastError = "rate-limit";
          backoffUntil = Date.now() + Math.max(INTERVAL, retryAfterMs(response.headers.get("retry-after")));
          logger.warn("CzHealth Hub: rate limit; synchronizace odložena.");
          return;
        }
        if (!response.ok) {
          lastError = response.status === 401 ? "unauthorized"
            : response.status === 403 ? "forbidden" : `http-${response.status}`;
          if (response.status === 401 || response.status === 403) {
            backoffUntil = Date.now() + 30 * 60_000;
          }
          logger.warn(`CzHealth Hub: ${await describeFailure(response)}; zachovávám uložená data.`);
          return;
        }
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) throw new Error("invalid-response");
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > 4 * 1024 * 1024) throw new Error("invalid-response");
        const page = await readJsonBounded(response);
        if (stopped) return;
        if (!Array.isArray(page.changes) || page.changes.length > 500) throw new Error("invalid-response");
        store.applyPage(page);
        if (!page.more) { lastSuccess = Date.now(); lastError = null; return; }
      }
      if (!stopped) logger.warn("CzHealth Hub: dosažen limit stránek, pokračování v dalším cyklu.");
    } catch {
      if (stopped) return;
      lastError = "sync-failed";
      logger.warn("CzHealth Hub: synchronizace selhala; zachovávám uložená data.");
    } finally {
      controller = null;
      running = false;
    }
  }

  return {
    configured,
    getState: () => ({ configured, lastSuccess, lastError }),
    start() {
      if (!stopped) return;
      stopped = false;
      if (!configured) { logger.warn("CzHealth Hub: chybí konfigurace přístupu."); return; }
      void run();
      timer = setInterval(() => void run(), INTERVAL);
      timer.unref?.();
    },
    stop() { stopped = true; controller?.abort(); if (timer) clearInterval(timer); timer = null; },
    run,
  };
}
