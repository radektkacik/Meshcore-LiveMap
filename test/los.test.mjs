import assert from "node:assert/strict";
import test from "node:test";
import { analyzePath, earthBulgeM, haversineKm, interpolatePath, nearestOnPath, profilePointAt } from "../src/los.js";

const prague = { lat: 50.08, lon: 14.42 };
const brno = { lat: 49.2, lon: 16.6 };

test("LOS path interpolation keeps endpoints and distances", () => {
  const { distanceKm, points } = interpolatePath(prague, brno, 5);
  assert.ok(distanceKm > 180 && distanceKm < 220);
  assert.deepEqual(points[0], { lat: prague.lat, lon: prague.lon, distanceKm: 0, t: 0 });
  assert.equal(points.length, 5);
  assert.equal(points[4].distanceKm, distanceKm);
  assert.ok(Math.abs(haversineKm(prague, brno) - distanceKm) < 1e-6);
});

test("earth bulge grows with distance from both ends", () => {
  assert.ok(Math.abs(earthBulgeM(10, 10) - 7.846) < 0.01);
  assert.equal(earthBulgeM(0, 20), 0);
});

test("profile point lookup interpolates between samples and clamps", () => {
  const profile = [
    { lat: 50, lon: 14, distanceKm: 0, terrainM: 200, effectiveTerrainM: 200, lineM: 300, clearanceM: 100, fresnelM: 0 },
    { lat: 50.1, lon: 14, distanceKm: 10, terrainM: 300, effectiveTerrainM: 300, lineM: 300, clearanceM: 0, fresnelM: 20 },
    { lat: 50.2, lon: 14, distanceKm: 20, terrainM: 400, effectiveTerrainM: 400, lineM: 300, clearanceM: -100, fresnelM: 0 },
  ];
  const mid = profilePointAt(profile, 0.5);
  assert.ok(Math.abs(mid.terrainM - 250) < 1e-6);
  assert.ok(Math.abs(mid.lat - 50.05) < 1e-9);
  assert.equal(profilePointAt(profile, -5).terrainM, 200);
  assert.equal(profilePointAt(profile, 99).terrainM, 400);
});

test("nearest point on path interpolates position and profile values", () => {
  const total = 100;
  const profile = Array.from({ length: 11 }, (_, index) => ({
    lat: 50 + index * 0.01,
    lon: 14,
    distanceKm: (total * index) / 10,
    terrainM: 200 + index,
    effectiveTerrainM: 200 + index,
    lineM: 300,
    clearanceM: 100,
    fresnelM: 20,
  }));
  const middle = nearestOnPath(profile, 50.045, 14);
  assert.ok(middle);
  assert.ok(Math.abs(middle.distanceKm - 45) < 0.6);
  assert.ok(Math.abs(middle.terrainM - 204.5) < 0.6);
  assert.ok(Math.abs(middle.lat - 50.045) < 1e-6);

  const before = nearestOnPath(profile, 49.9, 14);
  assert.equal(before.distanceKm, 0);
  const after = nearestOnPath(profile, 50.2, 14);
  assert.equal(after.distanceKm, total);
});

test("LOS analysis reports clear and blocked paths", () => {
  const total = 20;
  const flatTerrain = Array.from({ length: 11 }, (_, index) => ({
    distanceKm: (total * index) / 10,
    terrainM: 300,
  }));
  const clear = analyzePath(flatTerrain, { antennaAM: 60, antennaBM: 60 });
  assert.equal(clear.clear, true);
  assert.equal(clear.fresnelClear, true);
  assert.ok(clear.minClearanceM > 0);
  assert.ok(clear.minFresnelClearanceM > 0);

  const blockedTerrain = flatTerrain.map((point, index) => ({
    ...point,
    terrainM: index === 0 || index === flatTerrain.length - 1 ? 300 : 500,
  }));
  const blocked = analyzePath(blockedTerrain, { antennaAM: 60, antennaBM: 60 });
  assert.equal(blocked.clear, false);
  assert.ok(blocked.minClearanceM < 0);
});

test("LOS analysis ignores the tower endpoints themselves", () => {
  const total = 10;
  const samples = Array.from({ length: 6 }, (_, index) => ({
    distanceKm: (total * index) / 5,
    terrainM: 100,
  }));
  const result = analyzePath(samples, { antennaAM: 5, antennaBM: 5 });
  assert.equal(result.clear, true);
  assert.equal(result.profile[0].clearanceM, 5);
  assert.equal(result.profile[result.profile.length - 1].clearanceM, 5);
});
