import { formatNumber, formatPercent, tCount } from "./i18n.js";
import { rankNodeMetric } from "./node-model.js";

export function formatHops(count) {
  return tCount("units.hops", count);
}

export function formatObservers(count) {
  return tCount("units.observers", count);
}

export function formatScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return formatPercent(value);
}

export function usefulnessGrade(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const score = Number(value);
  if (score >= 0.65) return "A";
  if (score >= 0.45) return "B";
  if (score >= 0.3) return "C";
  if (score >= 0.15) return "D";
  return "F";
}

export function rankSuffix(nodes, node, field) {
  const result = rankNodeMetric(nodes, node, field);
  return result ? ` · ${result.rank}.` : "";
}

export function scoredWithRank(value, nodes, node, field) {
  const formatted = formatScore(value);
  if (formatted == null) return null;
  return `${formatted}${rankSuffix(nodes, node, field)}`;
}

export function countWithRank(value, nodes, node, field) {
  if (value == null || !Number.isFinite(Number(value))) return value ?? null;
  return `${formatNumber(value)}${rankSuffix(nodes, node, field)}`;
}

export function batteryTypeName(value) {
  return {
    auto: "auto",
    liion: "Li-ion",
    lifepo4: "LiFePO4",
    lto: "LTO",
    naion: "Na-ion",
    lead: "Pb",
    other: "other",
    "lto-vlastik": "LTO (vlastik)",
    "naion-vlastik": "Na-ion (vlastik)",
  }[value] || value;
}

export function voltageSourceName(value) {
  return {
    none: "—",
    adc: "ADC",
    ina: "INA",
    bms: "BMS",
  }[value] || value;
}
