// Millivolts per cell; keep aligned with battery status in the health stores.
const batteryLimits = new Map([
  ["liion", [3600, 3400]],
  ["lifepo4", [3200, 3000]],
  ["lto", [2400, 2200]],
  ["lead", [2050, 1950]],
]);

export function healthChartReferences(metric, health) {
  if (metric === "current") return [{ kind: "zero", value: 0 }];
  if (metric !== "battery" || !health || health.voltageSource === "none") return [];
  const { batteryType, batteryCells, voltageSource } = health;
  const type = batteryType === "auto" ? "liion"
    : batteryType === "lto-vlastik" && voltageSource === "bms" ? "lto" : batteryType;
  const limits = batteryLimits.get(type);
  if (!limits || !Number.isInteger(batteryCells) || batteryCells < 1) return [];
  return [
    { kind: "warn", value: limits[0] * batteryCells },
    { kind: "critical", value: limits[1] * batteryCells },
  ];
}

export function smoothHealthDips(points, metric, gapMs) {
  if (!["battery", "current"].includes(metric)) return points.map((point) => ({ ...point }));
  const result = points.map((point) => ({ ...point }));
  for (let i = 1; i < points.length - 1; i += 1) {
    for (const length of [2, 1]) {
      const rightIndex = i + length;
      if (rightIndex >= points.length) continue;
      const left = points[i - 1], right = points[rightIndex];
      if (points.slice(i - 1, rightIndex + 1).some((point, index, all) => index && point.time - all[index - 1].time > gapMs)) continue;
      const median = (left.value + right.value) / 2;
      const threshold = metric === "battery" ? 30 : Math.max(30, 1.5 * Math.max(Math.abs(left.value), Math.abs(right.value)));
      if (points.slice(i, rightIndex).every((point) => left.value - point.value > threshold && right.value - point.value > threshold)) {
        for (let n = i; n < rightIndex; n += 1) result[n].value = median;
        i = rightIndex - 1;
        break;
      }
    }
  }
  return result;
}
