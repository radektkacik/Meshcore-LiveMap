import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKED,
  CLEAR,
  PARTIAL,
  chooseTerrainZoom,
  computeCoverage,
  destinationPoint,
  fresnelRadiusM,
  latLonToTileFraction,
  terrariumHeight,
  terrainTileRange,
} from "../src/coverage.js";

test("terrarium heights decode to metres", () => {
  assert.equal(terrariumHeight(128, 0, 0), 0);
  assert.equal(terrariumHeight(0, 0, 0), -32768);
  assert.equal(terrariumHeight(128, 100, 0), 100);
  assert.equal(terrariumHeight(128, 0, 128), 0.5);
});

test("fresnel radius grows with distance and shrinks with frequency", () => {
  assert.ok(fresnelRadiusM(10, 868) > fresnelRadiusM(5, 868));
  assert.ok(fresnelRadiusM(10, 2400) < fresnelRadiusM(10, 868));
  assert.equal(fresnelRadiusM(0, 868), 0);
  assert.equal(fresnelRadiusM(10, 0), 0);
});

test("destination point keeps the requested distance", () => {
  const center = { lat: 49.82, lon: 15.45 };
  const north = destinationPoint(center, 0, 10_000);
  const east = destinationPoint(center, 90, 10_000);
  assert.ok(north.lat > center.lat);
  assert.ok(Math.abs(north.lon - center.lon) < 1e-6);
  assert.ok(east.lon > center.lon);
  assert.ok(Math.abs(east.lat - center.lat) < 0.001);
  assert.ok(Math.abs(north.lat - center.lat) > 0.08);
});

test("tile range covers the center and stays inside the world", () => {
  const center = { lat: 49.82, lon: 15.45 };
  for (const [radius, zoom] of [[5, 12], [20, 11], [50, 10]]) {
    const range = terrainTileRange(center, radius, zoom);
    const tile = latLonToTileFraction(center.lat, center.lon, zoom);
    assert.ok(Math.floor(tile.x) >= range.minX && Math.floor(tile.x) <= range.maxX);
    assert.ok(Math.floor(tile.y) >= range.minY && Math.floor(tile.y) <= range.maxY);
    assert.equal(range.count, (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1));
    assert.ok(range.count > 0 && range.count < 200);
  }
});

test("zoom selection keeps tile counts bounded", () => {
  assert.equal(chooseTerrainZoom(5), 12);
  assert.equal(chooseTerrainZoom(20), 11);
  assert.equal(chooseTerrainZoom(50), 10);
});

test("flat terrain is clear in every direction", () => {
  const center = { lat: 49.82, lon: 15.45 };
  const result = computeCoverage({
    center,
    radiusKm: 10,
    antennaM: 10,
    frequencyMHz: 868,
    azimuthSteps: 72,
    samplesPerRay: 40,
    sampleHeight: () => 500,
  });
  assert.equal(result.statuses.length, 72 * 40);
  assert.ok(result.statuses.every((status) => status === CLEAR || status === PARTIAL));
  assert.ok(result.visibleAreaKm2 > 0);
  assert.ok(result.maxDistanceKm > 9.9);
});

test("a ridge blocks the ray behind it", () => {
  const center = { lat: 49.82, lon: 15.45 };
  const result = computeCoverage({
    center,
    radiusKm: 20,
    antennaM: 10,
    frequencyMHz: 868,
    azimuthSteps: 4,
    samplesPerRay: 40,
    sampleHeight: (lat, lon) => {
      const northM = (lat - center.lat) * 111320;
      const eastM = (lon - center.lon) * 111320 * Math.cos((center.lat * Math.PI) / 180);
      const distanceM = Math.hypot(northM, eastM);
      return distanceM > 9_900 && distanceM < 10_100 ? 800 : 500;
    },
  });
  const east = Array.from(result.statuses.slice(0, 40));
  const ridgeIndex = 19;
  assert.equal(east[ridgeIndex], CLEAR);
  assert.ok(east.slice(ridgeIndex + 1).every((status) => status === BLOCKED));
});

test("missing elevation samples are reported as unknown", () => {
  const result = computeCoverage({
    center: { lat: 49.82, lon: 15.45 },
    radiusKm: 5,
    antennaM: 10,
    azimuthSteps: 8,
    samplesPerRay: 10,
    sampleHeight: () => null,
  });
  assert.ok(result.statuses.every((status) => status === 3));
  assert.equal(result.maxDistanceKm, 0);
});
