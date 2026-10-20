const DEFAULT_ENDPOINT = "https://api.open-meteo.com/v1/elevation";
const DEFAULT_CHUNK_SIZE = 100;
const DEFAULT_CACHE_LIMIT = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_CAP_MS = 10000;
const DEFAULT_COOLDOWN_MS = 30000;
const DEFAULT_BACKOFF_MS = 500;

function abortError() {
  if (typeof DOMException === "function") return new DOMException("The operation was aborted.", "AbortError");
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

export class ElevationError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = "ElevationError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function createElevationService({
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_ENDPOINT,
  chunkSize = DEFAULT_CHUNK_SIZE,
  cacheLimit = DEFAULT_CACHE_LIMIT,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryAfterCapMs = DEFAULT_RETRY_AFTER_CAP_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  backoffMs = DEFAULT_BACKOFF_MS,
} = {}) {
  const cache = new Map();
  let chain = Promise.resolve();
  let cooldownUntil = 0;

  function key(point) {
    return `${Number(point.lat).toFixed(4)},${Number(point.lon).toFixed(4)}`;
  }

  function cacheGet(point) {
    const cacheKey = key(point);
    if (!cache.has(cacheKey)) return undefined;
    const value = cache.get(cacheKey);
    cache.delete(cacheKey);
    cache.set(cacheKey, value);
    return value;
  }

  function cacheSet(point, value) {
    const cacheKey = key(point);
    if (cache.has(cacheKey)) cache.delete(cacheKey);
    cache.set(cacheKey, value);
    if (cache.size > cacheLimit) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  function buildUrl(chunk) {
    const lats = chunk.map((point) => Number(point.lat).toFixed(5)).join(",");
    const lons = chunk.map((point) => Number(point.lon).toFixed(5)).join(",");
    return `${endpoint}?latitude=${lats}&longitude=${lons}`;
  }

  async function requestChunk(chunk, signal) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (signal?.aborted) throw abortError();
      try {
        const response = await fetchImpl(buildUrl(chunk), { signal });
        if (response.ok) {
          const data = await response.json();
          if (!Array.isArray(data.elevation)) throw new ElevationError("Neplatná odpověď");
          return data.elevation;
        }
        const status = response.status;
        const retryAfterMs = parseRetryAfter(response.headers?.get?.("retry-after"));
        if (status === 429) {
          cooldownUntil = Date.now() + (retryAfterMs || cooldownMs);
          if (retryAfterMs > 0 && retryAfterMs <= retryAfterCapMs && attempt < maxRetries) {
            await delay(retryAfterMs, signal);
            continue;
          }
          throw new ElevationError("HTTP 429", {
            status,
            retryAfterMs: retryAfterMs || cooldownMs,
          });
        }
        if (status < 500) throw new ElevationError(`HTTP ${status}`, { status });
        lastError = new ElevationError(`HTTP ${status}`, { status });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (error instanceof ElevationError && error.status > 0 && error.status < 500) throw error;
        lastError = error;
      }
      if (attempt < maxRetries) await delay(backoffMs * 2 ** attempt + Math.random() * backoffMs * 0.5, signal);
    }
    throw lastError || new ElevationError("Výšky se nepodařilo načíst");
  }

  function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }

  async function fetchElevations(points, signal) {
    const elevations = new Array(points.length);
    const missing = [];
    points.forEach((point, index) => {
      const cached = cacheGet(point);
      if (Number.isFinite(cached)) elevations[index] = cached;
      else missing.push(index);
    });
    if (!missing.length) return elevations;
    const waitMs = cooldownUntil - Date.now();
    if (waitMs > 0) throw new ElevationError("Dočasné omezení načítání výšek", { status: 429, retryAfterMs: waitMs });
    for (let offset = 0; offset < missing.length; offset += chunkSize) {
      const indices = missing.slice(offset, offset + chunkSize);
      const chunk = indices.map((index) => points[index]);
      const values = await enqueue(() => requestChunk(chunk, signal));
      indices.forEach((index, slot) => {
        const raw = values[slot];
        const value = raw == null ? null : Number(raw);
        elevations[index] = Number.isFinite(value) ? value : null;
        if (Number.isFinite(value)) cacheSet(points[index], value);
      });
    }
    return elevations;
  }

  return { fetchElevations, cache };
}
