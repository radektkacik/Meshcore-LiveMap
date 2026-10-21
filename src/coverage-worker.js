import {
  chooseTerrainZoom,
  computeCoverage,
  latLonToTileFraction,
  terrariumHeight,
  terrainTileRange,
} from "./coverage.js";

const TILE_SIZE = 256;
const MAX_PARALLEL = 6;
const TERRAIN_BASE = `${import.meta.env.BASE_URL || "/"}api/terrain`;

function tileKey(x, y) {
  return `${x},${y}`;
}

async function loadTile(zoom, x, y, signal) {
  const response = await fetch(`${TERRAIN_BASE}/${zoom}/${x}/${y}.png`, { signal });
  if (!response.ok) return null;
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  const heights = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let index = 0; index < heights.length; index += 1) {
    const offset = index * 4;
    heights[index] = terrariumHeight(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
  }
  return heights;
}

function createSampler(zoom, tiles) {
  const worldSize = TILE_SIZE * 2 ** zoom;
  function valueAt(px, py) {
    const tileX = Math.floor(px / TILE_SIZE);
    const tileY = Math.floor(py / TILE_SIZE);
    const heights = tiles.get(tileKey(tileX, tileY));
    if (!heights) return null;
    const localX = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(px) - tileX * TILE_SIZE));
    const localY = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(py) - tileY * TILE_SIZE));
    return heights[localY * TILE_SIZE + localX];
  }
  return (lat, lon) => {
    const fraction = latLonToTileFraction(lat, lon, zoom);
    const px = Math.min(worldSize - 1e-3, Math.max(0, fraction.x * TILE_SIZE));
    const py = Math.min(worldSize - 1e-3, Math.max(0, fraction.y * TILE_SIZE));
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const fx = px - x0;
    const fy = py - y0;
    const v00 = valueAt(x0, y0);
    const v10 = valueAt(x1, y0);
    const v01 = valueAt(x0, y1);
    const v11 = valueAt(x1, y1);
    if (v00 == null || v10 == null || v01 == null || v11 == null) return null;
    return v00 * (1 - fx) * (1 - fy)
      + v10 * fx * (1 - fy)
      + v01 * (1 - fx) * fy
      + v11 * fx * fy;
  };
}

self.onmessage = async (event) => {
  const { center, radiusKm, antennaM, frequencyMHz, azimuthSteps, samplesPerRay } = event.data || {};
  if (!center || !(radiusKm > 0)) return;
  const zoom = chooseTerrainZoom(radiusKm);
  const range = terrainTileRange(center, radiusKm, zoom);
  const coordinates = [];
  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      coordinates.push([x, y]);
    }
  }
  const tiles = new Map();
  let loaded = 0;
  let decoded = 0;
  try {
    for (let offset = 0; offset < coordinates.length; offset += MAX_PARALLEL) {
      const batch = coordinates.slice(offset, offset + MAX_PARALLEL);
      await Promise.all(batch.map(async ([x, y]) => {
        try {
          const heights = await loadTile(zoom, x, y);
          if (heights) {
            tiles.set(tileKey(x, y), heights);
            decoded += 1;
          }
        } catch {
          tiles.set(tileKey(x, y), null);
        }
        loaded += 1;
      }));
      self.postMessage({ type: "progress", loaded, total: coordinates.length });
    }
    if (!decoded) throw new Error("Výšková data nejsou dostupná.");
    const sampleHeight = createSampler(zoom, tiles);
    self.postMessage({ type: "compute" });
    const result = computeCoverage({
      center,
      radiusKm,
      antennaM,
      frequencyMHz,
      azimuthSteps,
      samplesPerRay,
      sampleHeight,
    });
    self.postMessage({
      type: "done",
      ...result,
      statuses: result.statuses,
      zoom,
      tiles: coordinates.length,
    }, [result.statuses.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || "Výpočet pokrytí selhal." });
  }
};
