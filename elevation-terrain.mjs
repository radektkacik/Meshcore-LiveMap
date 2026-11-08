import { createRateLimiter } from "./http-utils.mjs";

export function createElevationTerrain() {
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
      body: JSON.stringify({
        locations: chunk.map((point) => ({ latitude: Number(point.lat), longitude: Number(point.lon) })),
      }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
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
    terrainCache.set(key, { at: Date.now(), body, contentType });
    while (terrainCache.size > terrainCacheLimit) {
      terrainCache.delete(terrainCache.keys().next().value);
    }
  }

  const checkTerrainRate = createRateLimiter({
    limit: terrainRateLimit,
    windowMs: terrainRateWindowMs,
  });

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
          headers: { "User-Agent": "meshcore-live-map/1.0" },
          signal: controller.signal,
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

  return {
    checkTerrainRate,
    elevationMaxPoints,
    elevationTimeoutMs,
    fetchTerrainTile,
    queueElevation,
    resolveElevations,
    stats: () => ({ elevation: elevationCache.size, terrain: terrainCache.size }),
    terrainCacheGet,
  };
}
