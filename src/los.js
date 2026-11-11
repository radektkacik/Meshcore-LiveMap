const EARTH_RADIUS_M = 6371000;

export function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function earthBulgeM(d1Km, d2Km) {
  return (d1Km * 1000 * d2Km * 1000) / (2 * EARTH_RADIUS_M);
}

export function interpolatePath(a, b, count = 100) {
  const distanceKm = haversineKm(a, b);
  const n = Math.max(2, Math.floor(count));
  const points = [];
  for (let index = 0; index < n; index += 1) {
    const t = index / (n - 1);
    points.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      distanceKm: distanceKm * t,
      t,
    });
  }
  return { distanceKm, points };
}

export function profilePointAt(profile, fractionalIndex) {
  if (!profile || profile.length === 0) return null;
  const clamped = Math.max(0, Math.min(profile.length - 1, fractionalIndex));
  const index = Math.min(profile.length - 1, Math.floor(clamped));
  const next = Math.min(profile.length - 1, index + 1);
  const t = clamped - index;
  const a = profile[index];
  const b = profile[next];
  const lerp = (x, y) => x + (y - x) * t;
  return {
    index,
    t,
    lat: lerp(a.lat, b.lat),
    lon: lerp(a.lon, b.lon),
    distanceKm: lerp(a.distanceKm, b.distanceKm),
    terrainM: lerp(a.terrainM, b.terrainM),
    effectiveTerrainM: lerp(a.effectiveTerrainM, b.effectiveTerrainM),
    lineM: lerp(a.lineM, b.lineM),
    clearanceM: lerp(a.clearanceM, b.clearanceM),
    fresnelM: lerp(a.fresnelM, b.fresnelM),
  };
}

export function nearestOnPath(profile, lat, lon) {
  if (!profile || profile.length === 0) return null;
  const rad = Math.PI / 180;
  const metersPerLon = EARTH_RADIUS_M * Math.cos(lat * rad);
  const px = (point) => (point.lon - lon) * rad * metersPerLon;
  const py = (point) => (point.lat - lat) * rad * EARTH_RADIUS_M;
  let best = null;
  for (let index = 0; index < profile.length - 1; index += 1) {
    const ax = px(profile[index]);
    const ay = py(profile[index]);
    const bx = px(profile[index + 1]);
    const by = py(profile[index + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? -(ax * dx + ay * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const distanceSq = cx * cx + cy * cy;
    if (!best || distanceSq < best.distanceSq) best = { index, t, distanceSq };
  }
  const a = profile[best.index];
  const b = profile[best.index + 1] || a;
  const t = best.t;
  const lerp = (x, y) => x + (y - x) * t;
  return {
    index: best.index,
    t,
    lat: lerp(a.lat, b.lat),
    lon: lerp(a.lon, b.lon),
    distanceKm: lerp(a.distanceKm, b.distanceKm),
    terrainM: lerp(a.terrainM, b.terrainM),
    effectiveTerrainM: lerp(a.effectiveTerrainM, b.effectiveTerrainM),
    lineM: lerp(a.lineM, b.lineM),
    clearanceM: lerp(a.clearanceM, b.clearanceM),
    fresnelM: lerp(a.fresnelM, b.fresnelM),
  };
}

export function analyzePath(samples, {
  frequencyGhz = 0.869525,
  antennaAM = 2,
  antennaBM = 2,
  fresnelFraction = 0.6,
} = {}) {
  const total = samples.length ? samples[samples.length - 1].distanceKm : 0;
  const startHeight = samples.length ? samples[0].terrainM + antennaAM : 0;
  const endHeight = samples.length ? samples[samples.length - 1].terrainM + antennaBM : 0;

  const profile = samples.map((sample) => {
    const t = total > 0 ? sample.distanceKm / total : 0;
    const d1 = sample.distanceKm;
    const d2 = total - sample.distanceKm;
    const bulgeM = earthBulgeM(d1, d2);
    const lineM = startHeight + (endHeight - startHeight) * t;
    const fresnelM = total > 0 && d1 > 0 && d2 > 0
      ? 17.32 * Math.sqrt((d1 * d2) / (frequencyGhz * total))
      : 0;
    const effectiveTerrainM = sample.terrainM + bulgeM;
    return {
      ...sample,
      bulgeM,
      fresnelM,
      lineM,
      effectiveTerrainM,
      clearanceM: lineM - effectiveTerrainM,
    };
  });

  const interior = profile.slice(1, -1);
  const considered = interior.length ? interior : profile;
  const clearanceValues = considered.map((point) => point.clearanceM);
  const fresnelValues = considered.map((point) => point.clearanceM - fresnelFraction * point.fresnelM);
  const minClearanceM = clearanceValues.length ? Math.min(...clearanceValues) : 0;
  const minFresnelClearanceM = fresnelValues.length ? Math.min(...fresnelValues) : 0;
  const worstClearance = minClearanceM;
  const worst = considered.find((point) => point.clearanceM === worstClearance) || null;

  return {
    distanceKm: total,
    fresnelFraction,
    fresnelM: profile.length ? Math.max(...profile.map((point) => point.fresnelM)) : 0,
    fresnelClear: minFresnelClearanceM >= 0,
    minClearanceM,
    minFresnelClearanceM,
    clear: minClearanceM > 0,
    worstDistanceKm: worst ? worst.distanceKm : 0,
    profile,
  };
}
