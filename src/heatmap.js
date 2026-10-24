function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function buildHeatmap(routes, bounds, { size = 192, maxSamples = 300_000 } = {}) {
  const width = Math.max(1e-6, Number(bounds?.east) - Number(bounds?.west));
  const height = Math.max(1e-6, Number(bounds?.north) - Number(bounds?.south));
  const dimension = Math.max(16, Math.floor(Number(size) || 192));
  const cells = new Float32Array(dimension * dimension);
  const step = Math.max(width, height) / dimension / 2;
  let max = 0;
  let samples = 0;

  const addSample = (lat, lon) => {
    const x = Math.round(((lon - bounds.west) / width) * (dimension - 1));
    const y = Math.round(((bounds.north - lat) / height) * (dimension - 1));
    const column = Math.min(dimension - 1, Math.max(0, x));
    const row = Math.min(dimension - 1, Math.max(0, y));
    const index = row * dimension + column;
    cells[index] += 1;
    if (cells[index] > max) max = cells[index];
    samples += 1;
  };

  const walk = (from, to) => {
    const distance = Math.hypot(to.lat - from.lat, (to.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180));
    const steps = Math.min(400, Math.max(1, Math.ceil(distance / step)));
    for (let index = 1; index <= steps; index += 1) {
      const ratio = index / steps;
      addSample(
        from.lat + (to.lat - from.lat) * ratio,
        from.lon + (to.lon - from.lon) * ratio,
      );
      if (samples >= maxSamples) return false;
    }
    return true;
  };

  for (const route of routes || []) {
    const points = route?.points || [];
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (!to.breakBefore && !walk(from, to)) {
        return { cells, dimension, max, samples, bounds };
      }
    }
  }

  return { cells, dimension, max, samples, bounds };
}

export function heatmapColor(value) {
  const stops = [
    [0, 0, 0, 0, 0],
    [0.15, 45, 95, 220, 255],
    [0.4, 0, 200, 200, 255],
    [0.7, 255, 200, 55, 255],
    [1, 225, 55, 40, 255],
  ];
  const level = clamp01(Number(value) || 0);
  for (let index = 1; index < stops.length; index += 1) {
    const right = stops[index];
    if (level > right[0]) continue;
    const left = stops[index - 1];
    const ratio = (level - left[0]) / (right[0] - left[0] || 1);
    return [
      Math.round(left[1] + (right[1] - left[1]) * ratio),
      Math.round(left[2] + (right[2] - left[2]) * ratio),
      Math.round(left[3] + (right[3] - left[3]) * ratio),
      Math.round(left[4] + (right[4] - left[4]) * ratio),
    ];
  }
  return [225, 55, 40, 255];
}
