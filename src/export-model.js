export function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[";\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function buildCsv(columns, rows) {
  const header = columns.map((column) => csvCell(column)).join(";");
  const lines = rows.map((row) => columns.map((column) => csvCell(row?.[column])).join(";"));
  return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
}

function roundCoordinate(value) {
  return Number(Number(value).toFixed(6));
}

export function pointFeature(lon, lat, properties = {}) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [roundCoordinate(lon), roundCoordinate(lat)],
    },
    properties,
  };
}

export function multiLineFeature(lines, properties = {}) {
  const coordinates = lines
    .filter((line) => Array.isArray(line) && line.length >= 2)
    .map((line) => line.map(([lon, lat]) => [roundCoordinate(lon), roundCoordinate(lat)]));
  if (!coordinates.length) return null;
  return {
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates },
    properties,
  };
}

export function featureCollection(features) {
  return {
    type: "FeatureCollection",
    features: features.filter(Boolean),
  };
}

export function exportFileName(prefix, extension, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  const safePrefix = String(prefix || "data").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `meshcore-${safePrefix || "data"}-${stamp}.${extension}`;
}
