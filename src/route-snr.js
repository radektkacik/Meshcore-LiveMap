export function routeHopSnr(route, point, fallbackIndex) {
  const values = Array.isArray(route?.snrValues) ? route.snrValues : null;
  if (!values) return null;
  const index = Number.isInteger(point?.pathIndex) ? point.pathIndex : fallbackIndex;
  if (!Number.isInteger(index) || index < 0) return null;
  const value = Number(values[index]);
  return Number.isFinite(value) ? value : null;
}

export function routeSegmentSnr(route, point, fallbackIndex) {
  if (!point || point.breakBefore) return null;
  return routeHopSnr(route, point, fallbackIndex);
}
