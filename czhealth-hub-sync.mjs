const ENDPOINT = "https://czhealth-api.meshcore.website/czhealth/v1/changes";
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

export function createCzHealthHubSync({ store, apiKey, clientId, clientSecret, fetchImpl = fetch, logger = console }) {
  let timer = null, stopped = true, running = false, backoffUntil = 0, controller = null;
  let lastSuccess = null, lastError = null;
  const configured = Boolean(apiKey && clientId && clientSecret);

  async function run() {
    if (!configured || running || Date.now() < backoffUntil) return;
    running = true;
    try {
      for (let count = 0; count < 1000 && !stopped; count += 1) {
        const url = new URL(ENDPOINT);
        url.searchParams.set("cursor", String(store.cursor()));
        url.searchParams.set("limit", "500");
        controller = new AbortController();
        const response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${apiKey}`, "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret },
          redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (stopped) return;
        if (response.status === 429) {
          lastError = "rate-limit";
          backoffUntil = Date.now() + Math.max(INTERVAL, retryAfterMs(response.headers.get("retry-after")));
          logger.warn("CzHealth Hub: rate limit; synchronizace odložena.");
          return;
        }
        if (!response.ok) {
          lastError = `http-${response.status}`;
          logger.warn(`CzHealth Hub: HTTP ${response.status}; zachovávám uložená data.`);
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
