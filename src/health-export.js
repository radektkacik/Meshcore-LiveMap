export const HEALTH_EXPORT_COLUMNS = [
  "time", "battery_mv", "temp_c", "current_ma", "humidity_pct", "voltage_source",
];

const METRICS = [
  ["battery", "battery_mv"],
  ["temperature", "temp_c"],
  ["current", "current_ma"],
  ["humidity", "humidity_pct"],
];

export function healthExportRows(samples = {}) {
  const byTime = new Map();
  for (const [metric, column] of METRICS) {
    for (const sample of samples[metric] || []) {
      const time = String(sample?.at || "");
      const value = Number(sample?.value);
      if (!time || !Number.isFinite(value)) continue;
      const row = byTime.get(time) || { time };
      row[column] = value;
      if (metric === "battery" && sample.source) row.voltage_source = sample.source;
      byTime.set(time, row);
    }
  }
  return [...byTime.values()].sort((first, second) => first.time.localeCompare(second.time));
}
