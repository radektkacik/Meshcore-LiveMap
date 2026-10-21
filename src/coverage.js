export const EARTH_RADIUS_M = 6371000;
export const REFRACTION_FACTOR = 4 / 3;
export const CLEAR = 2;
export const PARTIAL = 1;
export const BLOCKED = 0;
export const UNKNOWN = 3;

export function terrariumHeight(r, g, b) {
  return (r * 256 + g + b / 256) - 32768;
}

export function fresnelRadiusM(distanceKm, frequencyMHz) {
  const frequencyGHz = Number(frequencyMHz) / 1000;
  if (!(distanceKm > 0) || !(frequencyGHz > 0)) return 0;
  return 8.66 * Math.sqrt(distanceKm / frequencyGHz);
}

export function curvatureDropM(distanceM) {
  const effectiveRadius = EARTH_RADIUS_M * REFRACTION_FACTOR;
  return (distanceM * distanceM) / (2 * effectiveRadius);
}

export function destinationPoint(center, bearingDeg, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (center.lat * Math.PI) / 180;
  const lon1 = (center.lon * Math.PI) / 180;
  const sinLat2 = Math.sin(lat1) * Math.cos(angular)
    + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * sinLat2,
  );
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

export function chooseTerrainZoom(radiusKm) {
  if (radiusKm <= 10) return 12;
  if (radiusKm <= 30) return 11;
  return 10;
}

export function latLonToTileFraction(lat, lon, zoom) {
  const scale = 2 ** zoom;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

export function terrainTileRange(center, radiusKm, zoom) {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(0.05, Math.cos((center.lat * Math.PI) / 180)));
  const northWest = latLonToTileFraction(center.lat + latDelta, center.lon - lonDelta, zoom);
  const southEast = latLonToTileFraction(center.lat - latDelta, center.lon + lonDelta, zoom);
  const maxIndex = 2 ** zoom - 1;
  const minX = Math.max(0, Math.floor(Math.min(northWest.x, southEast.x)));
  const maxX = Math.min(maxIndex, Math.floor(Math.max(northWest.x, southEast.x)));
  const minY = Math.max(0, Math.floor(Math.min(northWest.y, southEast.y)));
  const maxY = Math.min(maxIndex, Math.floor(Math.max(northWest.y, southEast.y)));
  return {
    minX,
    maxX,
    minY,
    maxY,
    count: (maxX - minX + 1) * (maxY - minY + 1),
  };
}

export function computeCoverage({
  center,
  radiusKm,
  antennaM = 10,
  frequencyMHz = 868,
  azimuthSteps = 720,
  samplesPerRay = 200,
  sampleHeight,
}) {
  const rays = Math.max(1, Math.round(azimuthSteps));
  const samples = Math.max(1, Math.round(samplesPerRay));
  const stepM = (radiusKm * 1000) / samples;
  const statuses = new Uint8Array(rays * samples);
  const centerGroundM = sampleHeight(center.lat, center.lon);
  const antennaAltitude = Number.isFinite(centerGroundM) ? centerGroundM + antennaM : null;
  let visibleAreaM2 = 0;
  let maxDistanceM = 0;
  let partialAreaM2 = 0;

  if (antennaAltitude == null) {
    statuses.fill(UNKNOWN);
    return {
      rays,
      samples,
      stepM,
      statuses,
      centerGroundM,
      visibleAreaKm2: 0,
      partialAreaKm2: 0,
      maxDistanceKm: 0,
    };
  }

  for (let ray = 0; ray < rays; ray += 1) {
    const bearing = (ray * 360) / rays;
    let maxAngle = -Infinity;
    for (let sample = 1; sample <= samples; sample += 1) {
      const distanceM = sample * stepM;
      const point = destinationPoint(center, bearing, distanceM);
      const groundM = sampleHeight(point.lat, point.lon);
      const index = ray * samples + (sample - 1);
      if (!Number.isFinite(groundM)) {
        statuses[index] = UNKNOWN;
        continue;
      }
      const apparent = (groundM - antennaAltitude - curvatureDropM(distanceM)) / distanceM;
      if (apparent < maxAngle - 1e-9) {
        statuses[index] = BLOCKED;
        continue;
      }
      const clearanceM = Math.max(0, (apparent - maxAngle) * distanceM);
      const fresnelM = fresnelRadiusM(distanceM / 1000, frequencyMHz);
      const status = clearanceM > 0 && clearanceM < fresnelM * 0.6 ? PARTIAL : CLEAR;
      statuses[index] = status;
      maxAngle = apparent;
      const cellAreaM2 = stepM * distanceM * ((2 * Math.PI) / rays);
      if (status === CLEAR) visibleAreaM2 += cellAreaM2;
      else partialAreaM2 += cellAreaM2;
      if (status !== BLOCKED && distanceM > maxDistanceM) maxDistanceM = distanceM;
    }
  }

  return {
    rays,
    samples,
    stepM,
    statuses,
    centerGroundM,
    visibleAreaKm2: visibleAreaM2 / 1e6,
    partialAreaKm2: partialAreaM2 / 1e6,
    maxDistanceKm: maxDistanceM / 1000,
  };
}
