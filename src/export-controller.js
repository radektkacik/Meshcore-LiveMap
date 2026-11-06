import { buildCsv, exportFileName, featureCollection, multiLineFeature, pointFeature } from "./export-model.js";
import { t, tCount } from "./i18n.js";
import { haversineKm } from "./los.js";
import { validCoords } from "./node-model.js";

export function createExportController({
  state,
  elements,
  routeStore,
  nowMs,
  observerPosition,
  observerHealth,
  shortNodePrefix,
  nodeIsActive,
  nodeActiveMs,
  loadObservers,
}) {
const EXPORT_DATASETS = ["nodes", "observers", "routes"];
const NODE_EXPORT_COLUMNS = [
  "name", "role", "public_key", "prefix", "lat", "lon", "last_seen",
  "relay_24h", "advert_count", "advert_count_24h", "usefulness_score", "coverage_score",
  "bridge_score", "redundancy_score", "traffic_share_score",
];
const OBSERVER_EXPORT_COLUMNS = [
  "name", "id", "iata", "status", "lat", "lon", "approx", "last_seen",
  "packets", "packets_per_hour", "noise_floor", "battery_mv", "uptime_secs",
  "clock_skew_seconds", "model", "firmware",
];
const ROUTE_EXPORT_COLUMNS = [
  "hash", "type", "type_code", "observer", "observed_at", "from", "to",
  "hops", "distance_km", "snr_db", "scope",
];

function exportableNodes() {
  return [...state.nodeByKey.values()].filter((node) => validCoords(node.lat, node.lon));
}

function exportableRouteList() {
  if (state.routeWindowMs !== 0) {
    return [...state.archiveRoutes.values()].sort((a, b) => b.timestamp - a.timestamp);
  }
  return routeStore.visibleLive(state, nowMs());
}

function observerExportPairs() {
  return state.observers
    .map((observer) => ({ observer, position: observerPosition(observer) }))
    .filter(({ position }) => position);
}

function routeDistanceKm(route) {
  let total = 0;
  let previous = null;
  for (const point of route.points || []) {
    if (previous && !point.breakBefore) {
      total += haversineKm(previous, point);
    }
    previous = point;
  }
  return total;
}

function routeLines(route) {
  const lines = [];
  let line = [];
  for (const point of route.points || []) {
    if (point.breakBefore && line.length) {
      lines.push(line);
      line = [];
    }
    line.push([point.lon, point.lat]);
  }
  if (line.length) lines.push(line);
  return lines;
}

function nodeExportRow(node) {
  return {
    advert_count: node.advert_count ?? "",
    advert_count_24h: node.advert_count_24h ?? "",
    bridge_score: node.bridge_score ?? "",
    coverage_score: node.coverage_score ?? "",
    last_seen: node.last_seen || "",
    lat: node.lat,
    lon: node.lon,
    name: node.name || "",
    prefix: shortNodePrefix(node),
    public_key: node.public_key || "",
    redundancy_score: node.redundancy_score ?? "",
    relay_24h: node.relay_count_24h ?? "",
    role: node.role || "unknown",
    traffic_share_score: node.traffic_share_score ?? "",
    usefulness_score: node.usefulness_score ?? "",
  };
}

function observerExportRow(observer, position) {
  return {
    approx: position ? (position.approx ? "yes" : "no") : "",
    battery_mv: observer.battery_mv ?? "",
    clock_skew_seconds: observer.clock_skew_seconds ?? "",
    firmware: observer.firmware || "",
    iata: observer.iata || "",
    id: observer.id || "",
    last_seen: observer.last_seen || "",
    lat: position?.lat ?? "",
    lon: position?.lon ?? "",
    model: observer.model || "",
    name: observer.name || "",
    noise_floor: observer.noise_floor ?? "",
    packets: observer.packet_count ?? "",
    packets_per_hour: observer.packetsLastHour ?? "",
    status: observerHealth(observer),
    uptime_secs: observer.uptime_secs ?? "",
  };
}

function routeExportRow(route) {
  return {
    distance_km: Number(routeDistanceKm(route).toFixed(1)),
    from: route.from || "",
    hash: route.packetHash || "",
    hops: route.nodeCount ?? (route.points || []).length,
    observer: route.observerName || route.observerId || "",
    observed_at: route.timestamp ? new Date(route.timestamp).toISOString() : "",
    scope: route.scope || "",
    snr_db: route.snr ?? "",
    to: route.to || "",
    type: route.typeLabel || "",
    type_code: route.packetType ?? "",
  };
}

function buildExportPayload(dataset, format) {
  if (format !== "csv") {
    let features = [];
    if (dataset === "nodes") {
      features = exportableNodes().map((node) => pointFeature(node.lon, node.lat, {
        active: nodeIsActive(node, nowMs(), nodeActiveMs),
        name: node.name || "",
        public_key: node.public_key || "",
        role: node.role || "unknown",
        usefulness_score: node.usefulness_score ?? null,
      }));
    } else if (dataset === "observers") {
      features = observerExportPairs().map(({ observer, position }) => pointFeature(position.lon, position.lat, {
        approx: Boolean(position.approx),
        id: observer.id || "",
        iata: observer.iata || "",
        name: observer.name || "",
        status: observerHealth(observer),
      }));
    } else {
      features = exportableRouteList().map((route) => multiLineFeature(routeLines(route), {
        from: route.from || "",
        hash: route.packetHash || "",
        hops: route.nodeCount ?? (route.points || []).length,
        observer: route.observerName || route.observerId || "",
        observed_at: route.timestamp ? new Date(route.timestamp).toISOString() : "",
        snr_db: route.snr ?? null,
        to: route.to || "",
        type: route.typeLabel || "",
      }));
    }
    return {
      mime: "application/geo+json",
      name: exportFileName(dataset, "geojson"),
      text: JSON.stringify(featureCollection(features), null, 2),
    };
  }

  if (dataset === "nodes") {
    return {
      mime: "text/csv;charset=utf-8",
      name: exportFileName("nodes", "csv"),
      text: buildCsv(NODE_EXPORT_COLUMNS, exportableNodes().map(nodeExportRow)),
    };
  }
  if (dataset === "observers") {
    return {
      mime: "text/csv;charset=utf-8",
      name: exportFileName("observers", "csv"),
      text: buildCsv(OBSERVER_EXPORT_COLUMNS, state.observers.map((observer) => {
        const position = observerPosition(observer);
        return observerExportRow(observer, position);
      })),
    };
  }
  return {
    mime: "text/csv;charset=utf-8",
    name: exportFileName("routes", "csv"),
    text: buildCsv(ROUTE_EXPORT_COLUMNS, exportableRouteList().map(routeExportRow)),
  };
}

function exportRecordCount(dataset, format) {
  if (dataset === "nodes") return exportableNodes().length;
  if (dataset === "observers") {
    return format === "csv" ? state.observers.length : observerExportPairs().length;
  }
  return exportableRouteList().length;
}

function updateExportSummary() {
  const dataset = elements.exportDataset.value || "nodes";
  const format = elements.exportFormat.value || "geojson";
  if (dataset === "observers" && state.observersLoading) {
    elements.exportSummary.textContent = t("export.observersLoading");
    elements.exportDownload.disabled = true;
    return;
  }
  const count = exportRecordCount(dataset, format);
  elements.exportSummary.textContent = count ? tCount("export.count", count) : t("export.empty");
  elements.exportDownload.disabled = count === 0;
}

function renderExportDialog() {
  elements.exportTitle.textContent = t("export.title");
  elements.exportNote.textContent = t("export.note");
  elements.exportClose.setAttribute("aria-label", t("export.close"));
  elements.exportDatasetLabel.textContent = t("export.dataset");
  elements.exportFormatLabel.textContent = t("export.format");
  elements.exportDownload.textContent = t("export.download");
  const selected = elements.exportDataset.value || "nodes";
  elements.exportDataset.replaceChildren(...EXPORT_DATASETS.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(`export.${value}`);
    return option;
  }));
  elements.exportDataset.value = selected;
  updateExportSummary();
}

function downloadTextFile(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

elements.shareView.addEventListener("click", async () => {
  const copied = await copyText(buildShareUrl());
  elements.shareView.textContent = copied ? t("map.viewLinkCopied") : t("common.copyFailed");
  setTimeout(() => {
    elements.shareView.textContent = t("map.shareView");
  }, 1_800);
});

elements.exportToggle.addEventListener("click", () => {
  renderExportDialog();
  if (!state.observersLoadedAt && !state.observersLoading) {
    void loadObservers().finally(() => {
      if (elements.exportDialog.open) updateExportSummary();
    });
  }
  if (!elements.exportDialog.open) elements.exportDialog.showModal();
});

elements.exportClose.addEventListener("click", () => elements.exportDialog.close());
elements.exportDialog.addEventListener("click", (event) => {
  if (event.target === elements.exportDialog) elements.exportDialog.close();
});
elements.exportDataset.addEventListener("change", updateExportSummary);
elements.exportFormat.addEventListener("change", updateExportSummary);
elements.exportDownload.addEventListener("click", () => {
  try {
    const payload = buildExportPayload(elements.exportDataset.value, elements.exportFormat.value);
    if (!payload.text) {
      elements.exportSummary.textContent = t("export.empty");
      return;
    }
    downloadTextFile(payload.name, payload.text, payload.mime);
  } catch (error) {
    console.error("Export se nepodařilo vytvořit", error);
    elements.exportSummary.textContent = t("export.failed");
  }
});
  return { buildExportPayload, exportRecordCount, updateExportSummary, renderExportDialog, downloadTextFile };
}
