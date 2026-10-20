import L from "leaflet";
import QRCode from "qrcode";
import "leaflet/dist/leaflet.css";
import "./style.css";
import {
  archiveQuery,
  isRouteVisible,
  liveRouteCreatedAt,
  packetPathHashBytes,
  parsePath,
} from "./route-utils.js";
import { analyzePath, interpolatePath, nearestOnPath, profilePointAt } from "./los.js";
import { createElevationService, ElevationError } from "./elevation.js";
import { createPerfMonitor } from "./perf.js";
import {
  isNodeActive,
  isNodeRoleAllowed,
  nodeLastActivity,
  nodeMatchesQuery,
  nodeMetric,
  parseNodeQuery,
  rankNodeMetric,
  rankNodesByMetric,
  rankNodeTiers,
  resolveStatsField,
  validCoords,
} from "./node-model.js";
import { buildNeighborIndex, RouteStore, RouteVersionState, routeTimestamp } from "./route-model.js";
import {
  applyStaticTranslations,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatNumber,
  formatPercent,
  formatTime,
  getLocale,
  roleLabel,
  setLocale,
  t,
  tCount,
} from "./i18n.js";

applyStaticTranslations();

const MAX_FEED_ITEMS = 8;
const FEED_SOURCE_LIMIT = MAX_FEED_ITEMS * 4;
const FEED_RENDER_INTERVAL_MS = 2_000;
const FEED_AUTO_RESUME_MS = 2_500;
const FEED_SCROLL_RESUME_MS = 6_000;
const MAX_LIVE_RENDERED = 250;
const MAX_LIVE_STORED = 3000;
const MAX_ROUTE_HOP_KM = 230;
const MAX_ROUTE_PATH_LENGTH = 32;
const ROUTE_RETENTION_MS = 60_000;
const SELECTED_ROUTE_MS = 20_000;
const ROUTE_HISTORY_LIMIT = 1200;
const NODE_ACTIVE_MS = 60 * 60 * 1000;
const NODE_RANKING_ACTIVE_MS = 24 * 60 * 60 * 1000;
const BASE_DATA_REFRESH_MS = 15 * 60 * 1000;
const API_TIMEOUT_MS = 20_000;
const MAX_PENDING_PACKETS = 5_000;
const MAX_RESOLVE_BATCH = 80;
const PREFIX_CACHE_LIMIT = 5_000;
const PREFIX_NULL_TTL_MS = 120_000;
const ARCHIVE_REFRESH_MS = 60_000;
const ARCHIVE_MAX_ROUTES = 1500;
const NODE_CULL_PAD = 0.25;
const NODE_REFRESH_DEBOUNCE_MS = 300;
const SNR_GOOD_DB = 5;
const SNR_FAIR_DB = 0;
const ROUTE_COLORS = {
  2: "#246fc4",
  4: "#2bbf88",
  5: "#246fc4",
  8: "#d87412",
  9: "#d61f8c",
  default: "#9547b7",
};
const TYPE_LABELS = {
  0: "REQ",
  1: "RESPONSE",
  2: "DIRECT",
  3: "ACK",
  4: "ADVERT",
  5: "CHANNEL",
  6: "DATA",
  7: "ANON REQ",
  8: "PATH",
  9: "TRACE",
  10: "MULTIPART",
  11: "CONTROL",
};
const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IS_BETA = import.meta.env.VITE_BETA === "1";

function appPath(path) {
  return `${APP_BASE}${path}`;
}

const INITIAL_PARAMS = new URLSearchParams(location.search);
const ALL_NODE_ROLES = ["repeater", "companion", "room", "sensor", "unknown"];
const ALL_HASH_SIZES = [1, 2, 3];
const INITIAL_NODE_KEY = INITIAL_PARAMS.get("node")?.trim().toUpperCase() || null;
const INITIAL_ZOOM = Number(INITIAL_PARAMS.get("z"));

const THEME_KEY = "meshcoreTheme";
document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";

const elements = {
  activityNew: document.querySelector("#activity-new"),
  activityPanel: document.querySelector("#activity-panel"),
  activityPause: document.querySelector("#activity-pause"),
  animationToggle: document.querySelector("#animation-toggle"),
  baseLayerButtons: [...document.querySelectorAll("#base-layer-buttons button")],
  buildStamp: document.querySelector("#build-stamp"),
  betaBadge: document.querySelector("#beta-badge"),
  connectionDot: document.querySelector("#connection-dot"),
  connectionLabel: document.querySelector("#connection-label"),
  dataStale: document.querySelector("#data-stale"),
  feed: document.querySelector("#route-feed"),
  feedbackCancel: document.querySelector("#feedback-cancel"),
  feedbackCategory: document.querySelector("#feedback-category"),
  feedbackClose: document.querySelector("#feedback-close"),
  feedbackContact: document.querySelector("#feedback-contact"),
  feedbackDialog: document.querySelector("#feedback-dialog"),
  feedbackForm: document.querySelector("#feedback-form"),
  feedbackList: document.querySelector("#feedback-list"),
  feedbackMessage: document.querySelector("#feedback-message"),
  feedbackName: document.querySelector("#feedback-name"),
  feedbackPublic: document.querySelector("#feedback-public"),
  feedbackSend: document.querySelector("#feedback-send"),
  feedbackStatus: document.querySelector("#feedback-status"),
  feedbackToggle: document.querySelector("#feedback-toggle"),
  lastUpdate: document.querySelector("#last-update"),
  mapStatus: document.querySelector("#map-status"),
  losAntennaA: document.querySelector("#los-antenna-a"),
  losAntennaB: document.querySelector("#los-antenna-b"),
  losChart: document.querySelector("#los-chart"),
  losClose: document.querySelector("#los-close"),
  losDialog: document.querySelector("#los-dialog"),
  losFrequency: document.querySelector("#los-frequency"),
  losHint: document.querySelector("#los-hint"),
  losHover: document.querySelector("#los-hover"),
  losSummary: document.querySelector("#los-summary"),
  losToggle: document.querySelector("#los-toggle"),
  nodeLabelsToggle: document.querySelector("#node-labels-toggle"),
  otherTypesToggle: document.querySelector("#other-types-toggle"),
  packetRate: document.querySelector("#packet-rate"),
  qrCanvas: document.querySelector("#node-qr-canvas"),
  qrClose: document.querySelector("#node-qr-close"),
  qrDialog: document.querySelector("#node-qr-dialog"),
  qrKey: document.querySelector("#node-qr-key"),
  qrTitle: document.querySelector("#node-qr-title"),
  roleToggles: ["repeater", "companion", "room", "sensor", "unknown"]
    .map((role) => document.querySelector(`#role-toggle-${role}`)),
  routeCount: document.querySelector("#route-count"),
  sizeToggles: [1, 2, 3].map((size) => document.querySelector(`#size-toggle-${size}`)),
  statsClose: document.querySelector("#stats-close"),
  statsCounts: document.querySelector("#stats-counts"),
  statsList: document.querySelector("#stats-list"),
  statsMetric: document.querySelector("#stats-metric"),
  statsPanel: document.querySelector("#stats-panel"),
  statsToggle: document.querySelector("#stats-toggle"),
  statsVisits: document.querySelector("#stats-visits"),
  statsWindow: document.querySelector("#stats-window"),
  themeToggle: document.querySelector("#theme-toggle"),
  viewerCount: document.querySelector("#viewer-count"),
  windowButtons: [...document.querySelectorAll("#window-buttons button")],
};

elements.otherTypesToggle.checked = localStorage.getItem("meshcoreShowOtherPacketTypes") === "true";
elements.buildStamp.textContent = `build ${typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"}`;
if (IS_BETA) {
  elements.betaBadge.hidden = false;
  document.title = "MeshCore CZ · beta";
  const prodLink = document.createElement("a");
  prodLink.className = "beta-prod-link";
  prodLink.href = getLocale() === "en" ? "https://mapa.meshcore.cz/?lang=en" : "https://mapa.meshcore.cz/";
  prodLink.textContent = t("lang.production");
  prodLink.title = t("lang.productionTitle");
  elements.betaBadge.after(prodLink);
}

const nextLocale = getLocale() === "cs" ? "en" : "cs";
const langButton = document.createElement("button");
langButton.id = "lang-toggle";
langButton.className = "external-link lang-toggle";
langButton.type = "button";
langButton.textContent = nextLocale.toUpperCase();
const langLabel = t(nextLocale === "en" ? "lang.switchToEnglish" : "lang.switchToCzech");
langButton.title = langLabel;
langButton.setAttribute("aria-label", langLabel);
langButton.addEventListener("click", () => {
  const next = getLocale() === "cs" ? "en" : "cs";
  setLocale(next);
  const url = new URL(location.href);
  url.searchParams.set("lang", next);
  location.replace(url);
});
elements.themeToggle.after(langButton);
elements.animationToggle.checked = localStorage.getItem("meshcoreAnimateRoutes") !== "false";

const state = {
  activeRoutes: new Map(),
  animationEnabled: elements.animationToggle.checked,
  animationMode: new URLSearchParams(location.search).get("anim") === "svg" ? "svg" : "canvas",
  allowedHashBytes: new Set([2, 3]),
  allowedRoles: new Set(ALL_NODE_ROLES),
  archiveRendered: new Map(),
  archiveRoutes: new Map(),
  lastPacketAt: 0,
  lastRouteByNodeKey: new Map(),
  liveRouteCount: 0,
  losAbortController: null,
  losBusy: false,
  losChartScale: null,
  losComputeId: 0,
  losCursorMarker: null,
  losEndpoints: null,
  losFraction: 0.6,
  losMarkers: [],
  losMode: false,
  losPoints: [],
  losProfile: null,
  losRecomputeButton: document.querySelector("#los-recompute"),
  losSamples: null,
  neighborByNode: new Map(),
  nodeByKey: new Map(),
  nodeMarkerByKey: new Map(),
  nodeMarkers: [],
  observerByKey: new Map(),
  prefixCache: new Map(),
  prefixCacheAt: new Map(),
  prefixRequests: new Map(),
  retentionMs: ROUTE_RETENTION_MS,
  routeHistoryLoaded: false,
  routeHistoryLoading: false,
  routeWindowMs: 0,
  serverSkewMs: 0,
  selectedRouteHashBytes: 0,
  selectedRouteId: null,
  selectedRoutePacketType: null,
  selectedRouteTimeout: null,
  mqttConnected: false,
  packetSource: null,
  showNodeLabels: localStorage.getItem("meshcoreShowNodeLabels") === "true",
  showOtherPacketTypes: elements.otherTypesToggle.checked,
  statsCount: 10,
  statsMetric: "relay",
  statsWindow: "24h",
  initialNodeApplied: false,
  windowRequestId: 0,
};

function applyInitialFilters() {
  const rolesParam = INITIAL_PARAMS.get("roles");
  if (rolesParam !== null) {
    const roles = rolesParam.split(",").map((role) => role.trim()).filter((role) => ALL_NODE_ROLES.includes(role));
    if (roles.length) {
      state.allowedRoles = new Set(roles);
      for (const input of elements.roleToggles) {
        input.checked = roles.includes(input.id.replace("role-toggle-", ""));
      }
    }
  }
  const sizesParam = INITIAL_PARAMS.get("sizes");
  if (sizesParam !== null) {
    const sizes = sizesParam.split(",").map(Number).filter((size) => ALL_HASH_SIZES.includes(size));
    if (sizes.length) {
      state.allowedHashBytes = new Set(sizes);
      for (const input of elements.sizeToggles) {
        input.checked = sizes.includes(Number(input.id.replace("size-toggle-", "")));
      }
    }
  }
}

applyInitialFilters();
const routeStore = new RouteStore({
  retentionMs: ROUTE_RETENTION_MS,
  feedLimit: FEED_SOURCE_LIMIT,
  capacity: MAX_LIVE_STORED,
});
const routeVersions = new RouteVersionState();
const perf = createPerfMonitor(new URLSearchParams(location.search).has("perf"));

const map = L.map("map", {
  center: [49.82, 15.45],
  zoom: 7,
  minZoom: 6,
  maxZoom: 14,
  zoomControl: false,
  preferCanvas: true,
});

L.control.zoom({ position: "bottomleft" }).addTo(map);

const initialLatValue = INITIAL_PARAMS.get("lat");
const initialLonValue = INITIAL_PARAMS.get("lon");
const initialLat = initialLatValue == null ? NaN : Number(initialLatValue);
const initialLon = initialLonValue == null ? NaN : Number(initialLonValue);
if (Number.isFinite(initialLat) && Number.isFinite(initialLon)
  && initialLat >= -90 && initialLat <= 90 && initialLon >= -180 && initialLon <= 180) {
  const initialViewZoom = INITIAL_PARAMS.has("z") && Number.isFinite(INITIAL_ZOOM)
    ? Math.max(6, Math.min(14, INITIAL_ZOOM))
    : map.getZoom();
  map.setView([initialLat, initialLon], initialViewZoom);
}

const rasterBaseLayers = {
  osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }),
  topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    attribution: "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap (CC-BY-SA)",
    maxZoom: 17,
    subdomains: "abc",
  }),
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    className: "satellite-layer",
    maxZoom: 19,
  }),
  dark: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    className: "dark-basemap",
    maxZoom: 19,
  }),
};
const BASE_LAYER_KEY = "meshcoreBaseLayer";
const BASE_KEYS = ["osm", "topo", "sat", "dark"];
const storedBaseLayer = localStorage.getItem(BASE_LAYER_KEY);
let activeBaseLayerKey = BASE_KEYS.includes(storedBaseLayer)
  ? (storedBaseLayer === "dark" && document.documentElement.dataset.theme !== "dark" ? "osm" : storedBaseLayer)
  : (document.documentElement.dataset.theme === "dark" ? "dark" : "osm");
let currentBaseLayer = null;
let currentBaseLayerKey = null;

function showBaseLayer(key) {
  const resolvedKey = key === "osm" && document.documentElement.dataset.theme === "dark" ? "dark" : key;
  if (currentBaseLayer && currentBaseLayerKey === resolvedKey) {
    activeBaseLayerKey = key;
    return;
  }
  if (currentBaseLayer) {
    map.removeLayer(currentBaseLayer);
    currentBaseLayer = null;
  }
  currentBaseLayer = rasterBaseLayers[resolvedKey];
  currentBaseLayer.addTo(map);
  currentBaseLayerKey = resolvedKey;
  activeBaseLayerKey = key;
}

function setBaseLayer(key) {
  if (!BASE_KEYS.includes(key)) return;
  showBaseLayer(key);
  localStorage.setItem(BASE_LAYER_KEY, key);
  const buttonKey = key === "dark" ? "osm" : key;
  for (const button of elements.baseLayerButtons) {
    button.classList.toggle("active", button.dataset.layer === buttonKey);
  }
}

const nodeLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const selectedRouteLayer = L.layerGroup().addTo(map);
const losLayer = L.layerGroup().addTo(map);
const losMarkerLayer = L.layerGroup().addTo(map);
const nodeLabelLayer = L.layerGroup().addTo(map);
const routeRenderer = L.canvas({ padding: 0.3 });
const routeSvgRenderer = L.svg({ padding: 0.3 });
routeRenderer._dashOffset = 0;
routeRenderer._fillStroke = function fillStroke(ctx, layer) {
  ctx.lineDashOffset = layer.options.dashArray ? this._dashOffset : 0;
  L.Canvas.prototype._fillStroke.call(this, ctx, layer);
};

function roleColor(role) {
  if (role === "repeater") return "#3b91d9";
  if (role === "companion") return "#21aa79";
  if (role === "room") return "#718097";
  if (role === "sensor") return "#ab5cc8";
  return "#3b91d9";
}

const TOP25_COLOR = "#df5064";
const TOP100_COLOR = "#efa438";

function nodeMarkerStyle(node, tier) {
  const color = roleColor(node.role);
  const base = {
    radius: node.role === "repeater" || node.role === "companion" ? 7 : 6,
    color: "#202a33",
    fillColor: color,
    fillOpacity: 1,
    opacity: 1,
    weight: 1,
  };
  if (tier === "top25") {
    return { ...base, fillColor: TOP25_COLOR };
  }
  if (tier === "top100") {
    return { ...base, fillColor: TOP100_COLOR };
  }
  return base;
}

function formatHops(count) {
  return tCount("units.hops", count);
}

function formatObservers(count) {
  return tCount("units.observers", count);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function formatNodeDate(value) {
  if (!value) return t("common.unknown");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("common.unknown");
  const diff = nowMs() - date.getTime();
  if (diff >= 0 && diff < 60_000) return t("common.justNow");
  if (diff >= 0 && diff < 60 * 60_000) return tCount("units.minutesAgo", Math.floor(diff / 60_000));
  if (diff >= 0 && diff < 24 * 60 * 60_000) return tCount("units.hoursAgo", Math.floor(diff / (60 * 60_000)));
  if (diff >= 0 && diff < 7 * 24 * 60 * 60_000) return tCount("units.daysAgo", Math.floor(diff / (24 * 60 * 60_000)));
  const time = formatTime(date);
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return isToday ? time : `${formatDate(date)} ${time}`;
}

function formatScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return formatPercent(value);
}

function usefulnessGrade(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const score = Number(value);
  if (score >= 0.65) return "A";
  if (score >= 0.45) return "B";
  if (score >= 0.3) return "C";
  if (score >= 0.15) return "D";
  return "F";
}

function rankSuffix(nodes, node, field) {
  const result = rankNodeMetric(nodes, node, field);
  return result ? ` · ${result.rank}.` : "";
}

function scoredWithRank(value, nodes, node, field) {
  const formatted = formatScore(value);
  if (formatted == null) return null;
  return `${formatted}${rankSuffix(nodes, node, field)}`;
}

function countWithRank(value, nodes, node, field) {
  if (value == null || !Number.isFinite(Number(value))) return value ?? null;
  return `${formatNumber(value)}${rankSuffix(nodes, node, field)}`;
}

const HASH_STATUSES = new Set(["confirmed", "suspected", "unknown"]);

function formatHashStatus(node) {
  const status = HASH_STATUSES.has(node.multi_byte_status)
    ? t(`node.hashStatus.${node.multi_byte_status}`)
    : node.multi_byte_status;
  const evidence = node.multi_byte_evidence === "advert"
    ? t("node.hashEvidence.advert")
    : node.multi_byte_evidence === "path" ? t("node.hashEvidence.path") : null;
  return status ? `${status}${evidence ? ` · ${evidence}` : ""}` : null;
}

function renderNodeDetails(title, rows, help = "") {
  const details = rows
    .filter(([, value]) => value != null)
    .map(([label, value, description]) => `
      <div>
        <dt>${escapeHtml(label)}${description ? ` <span class="node-metric-info" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">i</span>` : ""}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `)
    .join("");
  return details ? `
    <section class="node-popup-details">
      <div class="node-popup-details-title"><h4>${escapeHtml(title)}</h4>${help}</div>
      <dl>${details}</dl>
    </section>
  ` : "";
}

function meshCoreContactType(role) {
  if (role === "repeater") return 2;
  if (role === "room") return 3;
  if (role === "sensor") return 4;
  return 1;
}

function meshCoreContactPayload(node) {
  const params = new URLSearchParams({
    name: String(node.name || node.public_key.slice(0, 8)).trim(),
    public_key: node.public_key.toLowerCase(),
    type: String(meshCoreContactType(node.role)),
  });
  return `meshcore://contact/add?${params}`;
}

function clearSelectedRoute() {
  selectedRouteLayer.clearLayers();
  clearTimeout(state.selectedRouteTimeout);
  state.selectedRouteHashBytes = 0;
  state.selectedRouteId = null;
  state.selectedRoutePacketType = null;
  state.selectedRouteTimeout = null;
}

function showRouteOnMap(route) {
  clearSelectedRoute();
  state.selectedRouteId = route.id;
  state.selectedRouteHashBytes = route.hashBytes;
  state.selectedRoutePacketType = route.packetType;
  const latLngs = route.points.map((point) => [point.lat, point.lon]);
  const segments = routeSegments(route.points);
  for (const segment of segments) {
    L.polyline(segment, {
      color: route.color,
      lineCap: "round",
      lineJoin: "round",
      opacity: 0.95,
      weight: 5,
    }).addTo(selectedRouteLayer);
  }

  route.points.forEach((point, index) => {
    L.marker([point.lat, point.lon], {
      icon: L.divIcon({
        className: "route-step-marker",
        html: String(index + 1),
        iconAnchor: [9, 9],
        iconSize: [18, 18],
      }),
    })
      .bindTooltip(escapeHtml(point.name), { className: "node-tooltip", direction: "top" })
      .addTo(selectedRouteLayer);
  });

  map.closePopup();
  map.fitBounds(L.latLngBounds(latLngs), { maxZoom: 11, padding: [40, 40] });
  state.selectedRouteTimeout = setTimeout(clearSelectedRoute, SELECTED_ROUTE_MS);
}

function routeDetailHtml(route) {
  const points = route.points || [];
  let totalMeters = 0;
  const rows = points.map((point, index) => {
    const previous = points[index - 1];
    let distance = "—";
    if (previous && point.breakBefore) {
      distance = t("route.unresolved");
    } else if (previous) {
      const meters = map.distance([previous.lat, previous.lon], [point.lat, point.lon]);
      totalMeters += meters;
      distance = `${formatDecimal(meters / 1000, 1)} km`;
    }
    return `<li><i>${index + 1}</i><span>${escapeHtml(point.name || t("common.unknownShort"))}</span><small>${escapeHtml(distance)}</small></li>`;
  }).join("");
  const snr = route.snrValues?.length
    ? `${t("route.snr")} ${route.snrValues.map((value) => formatDecimal(value, 1)).join(" / ")} dB`
    : null;
  const meta = [
    formatHops(Math.max(1, points.length - 1)),
    formatObservers(route.observerCount),
    `${route.hashBytes}B`,
    route.scope?.trim(),
    snr,
  ].filter(Boolean).map((value) => escapeHtml(value)).join(" · ");
  return `
    <section class="route-popup-card">
      <header>
        <div><small>${t("route.detail")}</small><h3>${escapeHtml(route.typeLabel)} · ${route.hashBytes}B</h3></div>
        <time>${escapeHtml(formatDateTime(route.timestamp))}</time>
      </header>
      <div class="route-popup-summary">
        <p><strong>${escapeHtml(route.from)}</strong> <span>→</span> <strong>${escapeHtml(route.to)}</strong></p>
        <small>${meta}</small>
        <small>${t("route.distanceTotal", { distance: formatDecimal(totalMeters / 1000, 1) })}</small>
      </div>
      <h4>${t("route.steps")}</h4>
      <ol class="route-hop-list">${rows}</ol>
      <div class="route-popup-actions">
        <button class="route-show-on-map" type="button">${t("route.showOnMap")}</button>
      </div>
    </section>
  `;
}

function openRouteDetail(route, latlng = null) {
  if (!route?.points?.length) return;
  const content = document.createElement("div");
  content.className = "route-popup-content";
  content.innerHTML = routeDetailHtml(route);
  const anchor = latlng || (route.bounds?.isValid() ? route.bounds.getCenter() : L.latLng(route.points[0].lat, route.points[0].lon));
  const popup = L.popup({
    className: "route-popup",
    maxWidth: 420,
    minWidth: 300,
    autoPan: true,
  }).setLatLng(anchor).setContent(content).openOn(map);
  L.DomEvent.disableClickPropagation(content);
  L.DomEvent.disableScrollPropagation(content);
  content.querySelector(".route-show-on-map")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setTimeout(() => {
      popup.close();
      showRouteOnMap(route);
    }, 0);
  });
}

map.on("click", clearSelectedRoute);
map.on("click", (event) => {
  if (state.losMode) void handleLosClick(event.latlng);
});
map.on("mousemove", handleLosHover);
map.on("mouseout", clearLosCursor);

function bindNodeRouteButton(button, node) {
  button?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const route = state.lastRouteByNodeKey.get(node.public_key?.toUpperCase());
    if (route) showRouteOnMap(route);
  });
}

function bindNodeNeighborButton(button) {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const entry = state.nodeMarkerByKey.get(button.dataset.neighborKey);
    if (!entry) return;
    revealNodeMarker(entry);
    map.flyTo(entry.marker.getLatLng(), 11, { duration: 0.7 });
    entry.marker.openPopup();
  });
}

function setupNodePopup(popup, node) {
  const root = popup.getElement();
  if (!root) return;
  const qrButton = root.querySelector(".node-qr-toggle");
  const routeButton = root.querySelector(".node-route-show");
  const copyButton = root.querySelector(".node-key-copy");
  const linkButton = root.querySelector(".node-link-copy");

  qrButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    elements.qrTitle.textContent = node.name || t("common.unknownNode");
    elements.qrKey.textContent = node.public_key;
    if (!elements.qrDialog.open) elements.qrDialog.showModal();
    qrButton.disabled = true;
    try {
      await QRCode.toCanvas(elements.qrCanvas, meshCoreContactPayload(node), {
        errorCorrectionLevel: "M",
        margin: 3,
        width: 300,
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch (error) {
      console.error("QR kontakt se nepodařilo vytvořit", error);
      elements.qrDialog.close();
    } finally {
      qrButton.disabled = false;
    }
  });

  bindNodeRouteButton(routeButton, node);
  root.querySelectorAll(".node-neighbor").forEach(bindNodeNeighborButton);

  copyButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyText(node.public_key);
    if (copied) {
      copyButton.textContent = t("common.copied");
      setTimeout(() => { copyButton.textContent = t("common.copy"); }, 1_500);
    } else {
      console.error("Veřejný klíč se nepodařilo zkopírovat");
      copyButton.textContent = t("common.copyFailed");
    }
  });

  linkButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyText(shareUrlForNode(node));
    if (copied) {
      linkButton.textContent = t("node.linkCopied");
      setTimeout(() => { linkButton.textContent = t("node.copyLink"); }, 1_500);
    } else {
      console.error("Odkaz se nepodařilo zkopírovat");
      linkButton.textContent = t("common.copyFailed");
    }
  });
}

function nodeLastRoute(node) {
  const route = state.lastRouteByNodeKey.get(node.public_key?.toUpperCase());
  if (!route) {
    return `<div class="node-last-route"><span>${t("node.lastRouteTitle")}</span><p>${t("node.noRoute")}</p></div>`;
  }
  const path = route.points
    .map((point, index) => `
      <li class="${index + 1 === route.position ? "current" : ""}">
        <i>${index + 1}</i><span>${escapeHtml(point.name)}</span>
      </li>
    `)
    .join("");

  return `
    <div class="node-last-route">
      <span>${t("node.lastRouteTitle")}</span>
      <div><strong>${escapeHtml(route.typeLabel)} · ${route.hashBytes}B</strong><time>${escapeHtml(formatNodeDate(route.timestamp))}</time></div>
      <ol class="node-route-path">${path}</ol>
      <button class="node-route-show" type="button">${t("node.showRoute")}</button>
    </div>
  `;
}

function nodeNeighbors(node) {
  const key = node.public_key?.toUpperCase();
  const neighbors = key ? state.neighborByNode.get(key) : null;
  if (!neighbors || !neighbors.size) {
    return `<div class="node-neighbors"><span>${t("node.neighborsTitle")}</span><p>${t("node.noNeighbors")}</p></div>`;
  }
  const items = [...neighbors.entries()]
    .sort((a, b) => b[1].count - a[1].count || (b[1].lastAt || 0) - (a[1].lastAt || 0))
    .slice(0, 10)
    .map(([neighborKey, info]) => `
      <li>
        <button class="node-neighbor" type="button" data-neighbor-key="${escapeHtml(neighborKey)}">
          <span>${escapeHtml(info.name || neighborKey.slice(0, 8))}</span>
          <small>${info.count}×</small>
        </button>
      </li>
    `)
    .join("");
  const connections = [...neighbors.values()].reduce((sum, info) => sum + info.count, 0);
  return `
    <div class="node-neighbors">
      <span>${t("node.neighborsTitle")}</span>
      <ul class="node-neighbor-list">${items}</ul>
      <small>${t("node.neighborsTotal", {
        neighbors: tCount("units.neighbors", neighbors.size),
        connections: tCount("units.links", connections),
      })}</small>
    </div>
  `;
}

function nodePopupContent(node, active) {
  const lastActivity = nodeLastActivity(node);
  const rankNodes = [...state.nodeByKey.values()];
  const hashSize = (() => {
    const maxBytes = Number(node.multi_byte_max_hash_size) || 0;
    const baseBytes = Number(node.hash_size) || 0;
    return Math.max(maxBytes, baseBytes) || null;
  })();
  const prefix = hashSize && node.public_key
    ? node.public_key.slice(0, hashSize * 2).toUpperCase()
    : null;
  const basicDetails = renderNodeDetails(t("node.basicDetails"), [
    [t("node.role"), roleLabel(node.role)],
    [t("node.lastActivity"), formatNodeDate(lastActivity)],
    [t("node.lastAdvert"), formatNodeDate(node.last_seen || node.last_heard)],
    [t("node.lastRelay"), formatNodeDate(node.last_relayed)],
    [t("node.coordinates"), `${Number(node.lat).toFixed(6)}, ${Number(node.lon).toFixed(6)}`],
    [t("node.prefix"), prefix, t("node.prefixHelp")],
    [t("node.hashMode"), hashSize ? (hashSize >= 2 ? "2B+" : "1B") : null, t("node.hashModeHelp")],
    [t("node.hashStatus"), formatHashStatus(node), t("node.hashStatusHelp")],
    [t("node.inconsistentHash"), node.hash_size_inconsistent ? t("common.yes") : null, t("node.inconsistentHashHelp")],
  ]);
  const trafficDetails = renderNodeDetails(t("node.trafficDetails"), [
    [t("node.relayActive"), node.relay_active == null ? null : node.relay_active ? t("common.yes") : t("common.no"), t("node.relayActiveHelp")],
    [t("node.relay1h"), countWithRank(node.relay_count_1h, rankNodes, node, "relay_count_1h"), t("node.relay1hHelp")],
    [t("node.relay24h"), countWithRank(node.relay_count_24h, rankNodes, node, "relay_count_24h"), t("node.relay24hHelp")],
    [t("node.unscopedRelay24h"), countWithRank(node.unscoped_relay_count_24h, rankNodes, node, "unscoped_relay_count_24h"), t("node.unscopedRelayHelp")],
    [t("node.advertPackets"), countWithRank(node.advert_count, rankNodes, node, "advert_count"), t("node.advertHelp")],
    [t("node.battery"), node.battery_mv == null ? null : `${node.battery_mv} mV`],
    [t("node.temperature"), node.temperature_c == null ? null : `${node.temperature_c} °C`],
  ]);
  const usefulnessScore = nodeMetric(node, "usefulness_score");
  const usefulness = usefulnessScore == null
    ? null
    : `${usefulnessGrade(usefulnessScore)} · ${formatScore(usefulnessScore)}${rankSuffix(rankNodes, node, "usefulness_score")}`;
  const scoreWindow = node.long_term_sample_count
    ? t("node.scoreSamples", { count: formatNumber(node.long_term_sample_count) })
    : t("node.scoreCurrent");
  const scoreHelp = `
    <details class="node-score-help">
      <summary aria-label="${t("node.usefulnessHow")}" title="${t("node.usefulnessHow")}">i</summary>
      <div class="node-score-help-panel">
        <strong>${t("node.usefulnessHow")}</strong>
        <p>${t("node.usefulnessFormula")}</p>
        <dl>
          <div><dt>Bridge</dt><dd>${t("node.bridgeMeaning")}</dd></div>
          <div><dt>${t("node.coverage")}</dt><dd>${t("node.coverageMeaning")}</dd></div>
          <div><dt>${t("node.criticality")}</dt><dd>${t("node.criticalityMeaning")}</dd></div>
          <div><dt>${t("node.trafficShare")}</dt><dd>${t("node.trafficShareMeaning")}</dd></div>
        </dl>
        <small>${t("node.usefulnessGradeNote")}</small>
      </div>
    </details>
  `;
  const networkDetails = renderNodeDetails(t("node.networkDetails"), [
    [t("node.usefulness7d"), usefulness, t("node.usefulnessHelp", { window: scoreWindow })],
    [t("node.coverage7d"), scoredWithRank(nodeMetric(node, "coverage_score"), rankNodes, node, "coverage_score"), t("node.coverageHelp")],
    [t("node.trafficShare7d"), scoredWithRank(nodeMetric(node, "traffic_share_score"), rankNodes, node, "traffic_share_score"), t("node.trafficShareHelp")],
    [t("node.bridge7d"), scoredWithRank(nodeMetric(node, "bridge_score"), rankNodes, node, "bridge_score"), t("node.bridgeHelp")],
    [t("node.criticality7d"), scoredWithRank(nodeMetric(node, "redundancy_score"), rankNodes, node, "redundancy_score"), t("node.criticalityHelp")],
    [t("node.defaultScope"), node.default_scope, t("node.defaultScopeHelp")],
    [t("node.transportedScopes"), Array.isArray(node.transported_scopes) && node.transported_scopes.length
      ? node.transported_scopes.join(", ") : null, t("node.transportedScopesHelp")],
    [t("node.foreign"), node.foreign ? t("common.yes") : null, t("node.foreignHelp")],
  ], scoreHelp);

  return `
    <header>
      <div><small>${t("node.meshcoreNode")}</small><h3>${escapeHtml(node.name || t("common.unknownNode"))}</h3></div>
      <span class="${active ? "active" : "inactive"}">${active ? t("common.active") : t("common.inactive")}</span>
    </header>
    ${basicDetails}
    ${trafficDetails}
    ${networkDetails}
    ${nodeLastRoute(node)}
    ${nodeNeighbors(node)}
    ${node.public_key ? `<div class="node-public-key"><div><span>${t("node.publicKey")}</span><button class="node-key-copy" type="button">${t("common.copy")}</button></div><code>${escapeHtml(node.public_key)}</code></div>` : ""}
    ${node.public_key ? `
      <div class="node-popup-actions">
        <button class="node-link-copy" type="button">${t("node.copyLink")}</button>
        ${/^[0-9a-f]{64}$/i.test(node.public_key) ? `<button class="node-qr-toggle" type="button">${t("node.showQr")}</button>` : ""}
      </div>
    ` : ""}
  `;
}

function nodePopup(node, active) {
  return `<section class="node-popup-card">${nodePopupContent(node, active)}</section>`;
}

async function getJsonWithResponse(path) {
  const response = await fetch(appPath(path), {
    cache: "no-store",
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { data: await response.json(), response };
}

async function getJson(path) {
  return (await getJsonWithResponse(path)).data;
}

async function postJson(path, body) {
  const response = await fetch(appPath(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status}`);
  return data;
}

function nowMs() {
  return Date.now() + state.serverSkewMs;
}

function setConnection(connected, label) {
  elements.connectionDot.classList.toggle("online", connected);
  elements.connectionLabel.textContent = label;
  if (connected) elements.lastUpdate.textContent = formatTime(Date.now());
}

function setDataFreshness(stale) {
  elements.dataStale.hidden = !stale;
  elements.dataStale.textContent = stale ? t("data.stale") : "";
  elements.dataStale.title = stale ? t("data.staleTitle") : "";
}

function nodeTooltip(node) {
  return `<strong>${escapeHtml(node.name || t("common.unknownNode"))}</strong><br>${escapeHtml(roleLabel(node.role))}`;
}

function refreshOpenNodePopup(entry) {
  const { marker, node } = entry;
  if (!marker.isPopupOpen()) return;
  const root = marker.getPopup().getElement();
  if (!root) return;
  const status = root.querySelector(".node-popup-card header > span");
  if (status) {
    const active = isNodeActive(node, nowMs(), NODE_ACTIVE_MS);
    status.className = active ? "active" : "inactive";
    status.textContent = active ? t("common.active") : t("common.inactive");
  }
  const lastRoute = root.querySelector(".node-last-route");
  if (lastRoute) lastRoute.outerHTML = nodeLastRoute(node);
  const neighbors = root.querySelector(".node-neighbors");
  if (neighbors) neighbors.outerHTML = nodeNeighbors(node);
  bindNodeRouteButton(root.querySelector(".node-route-show"), node);
  root.querySelectorAll(".node-neighbor").forEach(bindNodeNeighborButton);
}

let popupRefreshTimer = null;

function scheduleOpenNodePopupRefresh(entry) {
  if (!entry.marker.isPopupOpen() || popupRefreshTimer != null) return;
  popupRefreshTimer = setTimeout(() => {
    popupRefreshTimer = null;
    refreshOpenNodePopup(entry);
  }, 400);
}

function refreshNodePresentation(entry) {
  const { marker, node } = entry;
  entry.active = isNodeActive(node, nowMs(), NODE_ACTIVE_MS);
  if (validCoords(node.lat, node.lon)) marker.setLatLng([node.lat, node.lon]);
  marker.setTooltipContent(nodeTooltip(node));
  applyNodeStyle(entry, entry.tier);
  const role = node.role || "unknown";
  if (entry.stackRole !== role) {
    entry.stackRole = role;
    if (nodeLayer.hasLayer(marker)) applyNodeStacking(marker, node);
  }
  scheduleOpenNodePopupRefresh(entry);
}

function applyNodeStacking(marker, node) {
  if (node.role === "repeater") marker.bringToFront();
  else marker.bringToBack();
}

const NODE_STACK_PX = 10;
const NODE_ROLE_RANK = { repeater: 0, companion: 1, room: 2, sensor: 3, unknown: 4 };

function nodeStackEntries(entry) {
  const origin = map.latLngToContainerPoint(entry.marker.getLatLng());
  return state.nodeMarkers
    .filter((candidate) => candidate.shown && nodeLayer.hasLayer(candidate.marker))
    .filter((candidate) => origin.distanceTo(map.latLngToContainerPoint(candidate.marker.getLatLng())) <= NODE_STACK_PX)
    .sort((a, b) => (NODE_ROLE_RANK[a.node.role] ?? 9) - (NODE_ROLE_RANK[b.node.role] ?? 9)
      || String(a.node.name || "").localeCompare(String(b.node.name || ""), getLocale()));
}

function openNodeStack(entries, latlng) {
  const container = document.createElement("div");
  container.className = "node-stack";
  const heading = document.createElement("div");
  heading.className = "node-stack-title";
  heading.textContent = `${t("node.stackTitle")} · ${entries.length}`;
  const list = document.createElement("div");
  list.className = "node-stack-list";
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <span>${escapeHtml(entry.node.name || t("common.unknownNode"))}</span>
      <small>${escapeHtml(roleLabel(entry.node.role))} · ${entry.active ? t("common.active") : t("common.inactive")}</small>
    `;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setTimeout(() => {
        map.closePopup();
        entry.marker.openPopup();
      }, 0);
    });
    list.appendChild(button);
  }
  container.append(heading, list);
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  L.popup({ className: "node-stack-popup", maxWidth: 320, minWidth: 240, autoPan: true })
    .setLatLng(latlng)
    .setContent(container)
    .openOn(map);
}

function addNodeMarker(node) {
  const entry = { active: isNodeActive(node, nowMs(), NODE_ACTIVE_MS), marker: null, node, shown: false, stackRole: node.role || "unknown", styleKey: null, tier: null };
  const marker = L.circleMarker([node.lat, node.lon], {
    ...nodeMarkerStyle(node),
    pane: "markerPane",
  })
    .bindTooltip(nodeTooltip(node), {
      className: "node-tooltip",
    })
    .bindPopup(() => nodePopup(entry.node, isNodeActive(entry.node, nowMs(), NODE_ACTIVE_MS)), {
      className: "node-popup",
      maxWidth: 380,
      minWidth: 300,
    })
    .on("popupopen", (event) => {
      const root = event.popup.getElement();
      if (root) {
        L.DomEvent.disableClickPropagation(root);
        L.DomEvent.disableScrollPropagation(root);
      }
      setupNodePopup(event.popup, entry.node);
    })
    .on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      if (state.losMode) {
        marker.closePopup();
        void handleLosClick(marker.getLatLng(), node);
        return;
      }
      const stack = nodeStackEntries(entry);
      if (stack.length > 1) openNodeStack(stack, marker.getLatLng());
      else marker.openPopup();
    });
  marker.off("click", marker._openPopup, marker);
  const allowed = isNodeRoleAllowed(node, state.allowedRoles);
  if (allowed) {
    marker.addTo(nodeLayer);
    applyNodeStacking(marker, node);
  }
  entry.marker = marker;
  entry.shown = allowed;
  entry.styleKey = nodeStyleKey(node, null);
  state.nodeMarkers.push(entry);
  const key = node.public_key?.toUpperCase();
  if (key) state.nodeMarkerByKey.set(key, entry);
  return entry;
}

function revealNodeMarker(entry) {
  if (!nodeLayer.hasLayer(entry.marker)) {
    entry.marker.addTo(nodeLayer);
    applyNodeStacking(entry.marker, entry.node);
    entry.shown = true;
  }
}

function findNodeEntry(key) {
  const query = String(key || "").toUpperCase();
  if (!query) return null;
  const exact = state.nodeMarkerByKey.get(query);
  if (exact) return exact;
  if (query.length < 6) return null;
  const matches = [...state.nodeMarkerByKey.entries()].filter(([candidate]) => candidate.startsWith(query));
  return matches.length === 1 ? matches[0][1] : null;
}

function applyInitialNode() {
  if (!INITIAL_NODE_KEY || state.initialNodeApplied) return;
  const entry = findNodeEntry(INITIAL_NODE_KEY);
  if (!entry) return;
  state.initialNodeApplied = true;
  const role = entry.node.role || "unknown";
  if (!state.allowedRoles.has(role)) {
    state.allowedRoles.add(role);
    const input = elements.roleToggles.find((candidate) => candidate.id === `role-toggle-${role}`);
    if (input) input.checked = true;
  }
  revealNodeMarker(entry);
  const zoom = INITIAL_PARAMS.has("z") && Number.isFinite(INITIAL_ZOOM)
    ? Math.max(6, Math.min(14, INITIAL_ZOOM))
    : 11;
  map.setView(entry.marker.getLatLng(), zoom);
  entry.marker.openPopup();
}

function routeWindowParam(windowMs) {
  if (windowMs === 300000) return "5m";
  if (windowMs === 3600000) return "1h";
  if (windowMs === 86400000) return "24h";
  return null;
}

function parseRouteWindowParam(value) {
  const aliases = { live: 0, "5m": 300000, "1h": 3600000, "24h": 86400000 };
  if (typeof value === "string" && Object.hasOwn(aliases, value)) return aliases[value];
  const number = Number(value);
  return [0, 300000, 3600000, 86400000].includes(number) ? number : null;
}

function shareUrlForNode(node) {
  const url = new URL(location.href);
  url.searchParams.set("node", String(node.public_key || "").toUpperCase());
  url.searchParams.set("lat", map.getCenter().lat.toFixed(5));
  url.searchParams.set("lon", map.getCenter().lng.toFixed(5));
  url.searchParams.set("z", String(map.getZoom()));
  url.searchParams.set("roles", [...state.allowedRoles].join(","));
  url.searchParams.set("sizes", [...state.allowedHashBytes].sort((a, b) => a - b).join(","));
  url.searchParams.set("lang", getLocale());
  const windowValue = routeWindowParam(state.routeWindowMs);
  if (windowValue) url.searchParams.set("window", windowValue);
  else url.searchParams.delete("window");
  return url.toString();
}

function nodeStyleKey(node, tier) {
  return `${node.role || "unknown"}:${tier || "none"}`;
}

function applyNodeStyle(entry, tier) {
  entry.tier = tier || null;
  const styleKey = nodeStyleKey(entry.node, entry.tier);
  if (entry.styleKey === styleKey) return;
  entry.styleKey = styleKey;
  entry.marker.setStyle(nodeMarkerStyle(entry.node, entry.tier));
}

function applyNodeMembership() {
  const bounds = map.getBounds().pad(NODE_CULL_PAD);
  for (const entry of state.nodeMarkers) {
    const allowed = isNodeRoleAllowed(entry.node, state.allowedRoles);
    const shouldShow = allowed
      && (entry.marker.isPopupOpen() || bounds.contains([entry.node.lat, entry.node.lon]));
    const shown = nodeLayer.hasLayer(entry.marker);
    if (shouldShow && !shown) {
      entry.marker.addTo(nodeLayer);
      applyNodeStacking(entry.marker, entry.node);
      entry.shown = true;
    } else if (!shouldShow && shown) {
      nodeLayer.removeLayer(entry.marker);
      entry.shown = false;
    }
  }
}

function applyNodeTiers() {
  const tiers = rankNodeTiers(state.nodeMarkers.map(({ node }) => node), nowMs(), NODE_RANKING_ACTIVE_MS);
  for (const entry of state.nodeMarkers) applyNodeStyle(entry, tiers.get(entry.node));
}

function refreshNodeState() {
  const now = nowMs();
  applyNodeTiers();
  applyNodeMembership();
  for (const entry of state.nodeMarkers) {
    const active = isNodeActive(entry.node, now, NODE_ACTIVE_MS);
    if (entry.active !== active) {
      entry.active = active;
      scheduleOpenNodePopupRefresh(entry);
    }
  }
  if (!elements.statsPanel.hidden) renderStats();
  scheduleNodeLabels();
}

let nodeRefreshTimer = null;

function scheduleNodeRefresh() {
  if (nodeRefreshTimer != null) return;
  nodeRefreshTimer = setTimeout(() => {
    nodeRefreshTimer = null;
    refreshNodeState();
  }, NODE_REFRESH_DEBOUNCE_MS);
}

const LABEL_MIN_ZOOM = 9;
const LABEL_MAX = 400;
let labelRebuildTimer = null;

function scheduleNodeLabels() {
  clearTimeout(labelRebuildTimer);
  labelRebuildTimer = setTimeout(rebuildNodeLabels, 120);
}

function rebuildNodeLabels() {
  nodeLabelLayer.clearLayers();
  if (!state.showNodeLabels || map.getZoom() < LABEL_MIN_ZOOM) return;
  const bounds = map.getBounds().pad(0.15);
  let count = 0;
  for (const entry of state.nodeMarkers) {
    if (count >= LABEL_MAX) break;
    const { node } = entry;
    if (!node.name) continue;
    if (!isNodeRoleAllowed(node, state.allowedRoles)) continue;
    if (!validCoords(node.lat, node.lon)) continue;
    if (!bounds.contains([node.lat, node.lon])) continue;
    L.marker([node.lat, node.lon], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: "node-label", html: escapeHtml(node.name), iconSize: null, iconAnchor: [-9, 10] }),
    }).addTo(nodeLabelLayer);
    count += 1;
  }
}

function syncNodes(nodes) {
  for (const incoming of nodes) {
    const key = incoming.public_key?.toUpperCase();
    if (!key) continue;
    let node = state.nodeByKey.get(key);
    if (node) Object.assign(node, incoming);
    else {
      node = incoming;
      state.nodeByKey.set(key, node);
    }

    const entry = state.nodeMarkerByKey.get(key);
    if (validCoords(node.lat, node.lon)) {
      if (entry) refreshNodePresentation(entry);
      else addNodeMarker(node);
    } else if (entry) {
      nodeLayer.removeLayer(entry.marker);
      state.nodeMarkerByKey.delete(key);
      state.nodeMarkers = state.nodeMarkers.filter((candidate) => candidate !== entry);
    }
  }
  scheduleNodeRefresh();
}

let nodeRefreshActive = false;
async function loadNodes() {
  if (nodeRefreshActive) return null;
  nodeRefreshActive = true;
  try {
    const { data, response } = await getJsonWithResponse("/api/nodes?limit=2000");
    setDataFreshness(response.headers.get("X-Data-Stale") === "1");
    syncNodes(data.nodes || []);
    applyInitialNode();
    if (!state.routeHistoryLoaded) void loadRouteHistory();
    return true;
  } catch (error) {
    console.error("Uzly se nepodařilo načíst", error);
    return false;
  } finally {
    nodeRefreshActive = false;
  }
}

let statsRefreshActive = false;
async function loadStats() {
  if (statsRefreshActive) return;
  statsRefreshActive = true;
  try {
    const data = await getJson("/api/stats");
    elements.packetRate.textContent = formatNumber(Number(data.packetsLastHour || 0));
  } catch (error) {
    console.error("Statistiky se nepodařilo načíst", error);
  } finally {
    statsRefreshActive = false;
  }
}

async function loadBaseData() {
  await Promise.all([loadNodes(), loadStats()]);
}

function parseDecoded(packet) {
  try {
    return JSON.parse(packet.decoded_json || "{}");
  } catch {
    return {};
  }
}

function updateAdvertNode(packet) {
  if (Number(packet.payload_type) !== 4) return;
  const decoded = parseDecoded(packet);
  if (!validCoords(decoded.lat, decoded.lon)) return;

  const key = String(decoded.pubKey || decoded.public_key || packet.origin_id || "").toUpperCase();
  if (!key) return;
  let node = state.nodeByKey.get(key);
  if (node) {
    node.lat = decoded.lat;
    node.lon = decoded.lon;
    node.last_heard = packet.latest || packet.first_seen || node.last_heard;
    node.last_seen = packet.latest || packet.first_seen || node.last_seen;
    if (decoded.name) node.name = decoded.name;
  } else {
    node = {
      lat: decoded.lat,
      lon: decoded.lon,
      name: decoded.name || t("common.unknownNode"),
      public_key: key,
      role: "unknown",
      last_heard: packet.latest || packet.first_seen,
      last_seen: packet.latest || packet.first_seen,
    };
    state.nodeByKey.set(key, node);
  }

  const entry = state.nodeMarkerByKey.get(key);
  if (entry) {
    refreshNodePresentation(entry);
    scheduleNodeRefresh();
    return;
  }
  addNodeMarker(node);
  scheduleNodeRefresh();
}

async function resolvePrefixes(prefixes) {
  const now = Date.now();
  const unique = [...new Set(prefixes)];
  const missing = unique.filter((prefix) => {
    if (state.prefixRequests.has(prefix)) return false;
    if (!state.prefixCache.has(prefix)) return true;
    const cachedAt = state.prefixCacheAt.get(prefix) || 0;
    return state.prefixCache.get(prefix) == null && now - cachedAt > PREFIX_NULL_TTL_MS;
  });
  for (let offset = 0; offset < missing.length; offset += MAX_RESOLVE_BATCH) {
    const batch = missing.slice(offset, offset + MAX_RESOLVE_BATCH);
    let request;
    request = (async () => {
      try {
        const data = await getJson(`/api/resolve-hops?hops=${encodeURIComponent(batch.join(","))}`);
        for (const prefix of batch) {
          state.prefixCache.set(prefix, data.resolved?.[prefix] || null);
          state.prefixCacheAt.set(prefix, Date.now());
          if (state.prefixCache.size > PREFIX_CACHE_LIMIT) {
            const oldest = state.prefixCache.keys().next().value;
            state.prefixCache.delete(oldest);
            state.prefixCacheAt.delete(oldest);
          }
        }
      } finally {
        for (const prefix of batch) {
          if (state.prefixRequests.get(prefix) === request) state.prefixRequests.delete(prefix);
        }
      }
    })();
    for (const prefix of batch) state.prefixRequests.set(prefix, request);
  }
  const requests = unique.map((prefix) => state.prefixRequests.get(prefix)).filter(Boolean);
  await Promise.all(new Set(requests));
}

function haversineKm(latA, lonA, latB, lonB) {
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLon = (lonB - lonA) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(latA * rad) * Math.cos(latB * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const AMBIGUOUS_MARGIN = 0.5;

function chooseCandidate(resolved, anchorLat, anchorLon) {
  const candidates = (resolved?.candidates || []).filter((candidate) => validCoords(candidate.lat, candidate.lon));
  if (!candidates.length) return null;
  if (anchorLat == null || anchorLon == null) {
    return candidates.length > 1 ? null : candidates[0];
  }
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: haversineKm(anchorLat, anchorLon, candidate.lat, candidate.lon) }))
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const second = ranked[1];
  // Nejbližší kandidát musí být výrazně blíž, jinak je prefix nejednoznačný a raději trasu přerušíme.
  if (second && best.distance > second.distance * AMBIGUOUS_MARGIN) return null;
  return best.candidate;
}

function packetPoints(packet, path) {
  const decoded = parseDecoded(packet);
  const points = [];
  let breakNext = false;
  const pushPoint = (lat, lon, name, publicKey) => {
    points.push({ lat, lon, name, publicKey, breakBefore: breakNext && points.length > 0 });
    breakNext = false;
  };

  if (packet.payload_type === 4 && validCoords(decoded.lat, decoded.lon)) {
    pushPoint(decoded.lat, decoded.lon, decoded.name || "Advert", decoded.pubKey || decoded.public_key);
  } else if (packet.origin_id) {
    const originKey = packet.origin_id.toUpperCase();
    if (originKey.length >= 4) {
      const originNode = state.nodeByKey.get(originKey);
      if (originNode && validCoords(originNode.lat, originNode.lon)) {
        pushPoint(originNode.lat, originNode.lon, originNode.name || "Origin", originNode.public_key);
      }
    }
  }

  let anchorLat = points.at(-1)?.lat ?? null;
  let anchorLon = points.at(-1)?.lon ?? null;

  for (const prefix of path) {
    const resolved = state.prefixCache.get(prefix);
    const candidate = chooseCandidate(resolved, anchorLat, anchorLon);
    if (!candidate || !validCoords(candidate.lat, candidate.lon)) {
      breakNext = true;
      continue;
    }
    if (anchorLat != null && anchorLon != null) {
      const dist = haversineKm(anchorLat, anchorLon, candidate.lat, candidate.lon);
      if (dist > MAX_ROUTE_HOP_KM) {
        breakNext = true;
        continue;
      }
    }
    const previous = points.at(-1);
    if (previous && previous.lat === candidate.lat && previous.lon === candidate.lon) continue;
    pushPoint(candidate.lat, candidate.lon, candidate.name || resolved?.name || prefix, candidate.pubkey || candidate.public_key);
    anchorLat = candidate.lat;
    anchorLon = candidate.lon;
  }

  const isDirectRoute = [2, 3].includes(Number(packet.route_type));
  const observerKey = (packet.observer_id || "").toUpperCase();
  if (!isDirectRoute && observerKey.length >= 4) {
    const observerNode = state.nodeByKey.get(observerKey);
    if (observerNode && validCoords(observerNode.lat, observerNode.lon)) {
      const last = points.at(-1);
      const plausibleDistance = !last
        || haversineKm(last.lat, last.lon, observerNode.lat, observerNode.lon) <= MAX_ROUTE_HOP_KM;
      const distinct = !last || last.lat !== observerNode.lat || last.lon !== observerNode.lon;
      if (plausibleDistance && distinct) {
        pushPoint(observerNode.lat, observerNode.lon, observerNode.name || packet.observer_name || "Observer", observerNode.public_key);
      } else if (!plausibleDistance) {
        breakNext = true;
      }
    }
  }

  return points;
}

function routeSegments(points) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (point.breakBefore && current.length) {
      segments.push(current);
      current = [];
    }
    current.push([point.lat, point.lon]);
  }
  if (current.length) segments.push(current);
  return segments.filter((segment) => segment.length >= 2);
}

function routeColor(packetType) {
  return ROUTE_COLORS[packetType] || ROUTE_COLORS.default;
}

function historyRoutePoints(packet) {
  const resolved = packet.resolved_path || packet._resolvedPath || [];
  const points = [];
  const seen = new Set();
  let breakNext = false;
  for (const hop of resolved) {
    const key = String(hop || "").toUpperCase();
    if (!key || key.length < 4) {
      breakNext = true;
      continue;
    }
    const node = state.nodeByKey.get(key);
    if (!node || !validCoords(node.lat, node.lon)) {
      breakNext = true;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({
      lat: node.lat,
      lon: node.lon,
      name: node.name || key.slice(0, 2),
      publicKey: key,
      breakBefore: breakNext && points.length > 0,
    });
    breakNext = false;
  }
  return points;
}

function packetSnrValues(packet) {
  if (Number(packet.payload_type) !== 9) return [];
  const decoded = parseDecoded(packet);
  if (!Array.isArray(decoded.snrValues)) return [];
  return decoded.snrValues.map(Number).filter(Number.isFinite);
}

function routeRecord(packet, points, hashBytes, id, versionId, createdAt, timestamp = createdAt) {
  const typeLabel = TYPE_LABELS[packet.payload_type] || `TYPE ${packet.payload_type}`;
  const color = routeColor(packet.payload_type);
  return {
    bounds: L.latLngBounds(points.map((point) => [point.lat, point.lon])),
    color,
    createdAt,
    from: points[0].name || t("common.unknownShort"),
    hashBytes,
    id,
    nodeCount: points.length,
    observerCount: Number(packet.observer_count || 1),
    packetType: packet.payload_type,
    points: points.map(({ lat, lon, name, publicKey, breakBefore }) => ({
      lat,
      lon,
      name,
      publicKey,
      breakBefore: Boolean(breakBefore),
    })),
    scope: String(packet.scope_name || "").trim() || null,
    snrValues: packetSnrValues(packet),
    timestamp,
    to: points.at(-1).name || t("common.unknownShort"),
    typeLabel,
    versionId,
  };
}

async function loadRouteHistory() {
  if (state.routeHistoryLoaded || state.routeHistoryLoading) return;
  state.routeHistoryLoading = true;
  try {
    const data = await getJson(`/api/packets?limit=${ROUTE_HISTORY_LIMIT}`);
    const packets = (data.packets || []).slice().sort((a, b) => Number(b.id) - Number(a.id));
    for (const packet of packets) {
      const path = parsePath(packet);
      const hashBytes = packetPathHashBytes(packet, path);
      if (!path.length) continue;
      const points = historyRoutePoints(packet);
      if (!routeSegments(points).length) continue;
      const id = `${packet.hash || packet.id}:${packet.observer_id || "history"}`;
      routeStore.addHistory(routeRecord(
        packet,
        points,
        hashBytes,
        id,
        `history:${packet.id || id}`,
        routeTimestamp(packet, 0),
      ));
    }
    state.routeHistoryLoaded = true;
    rebuildNeighborIndex();
    syncRoutePresentation();
  } catch (error) {
    console.error("Historie tras se nepodařilo načíst", error);
  } finally {
    state.routeHistoryLoading = false;
  }
}

function snrColor(snr) {
  if (snr >= SNR_GOOD_DB) return "#2bbf88";
  if (snr >= SNR_FAIR_DB) return "#e3911c";
  return "#d1374d";
}

function renderRoute(route, { archive = false } = {}) {
  const segments = routeSegments(route.points);
  if (!segments.length) return null;
  const group = L.layerGroup().addTo(routeLayer);
  const useSvg = state.animationMode === "svg";
  const layerRenderer = useSvg ? routeSvgRenderer : routeRenderer;
  const lineClass = useSvg && !archive ? "route-svg-path" : undefined;
  const weight = archive ? 2.5 : 4;
  const opacity = archive ? 0.42 : 1;
  const dashArray = archive ? "4 8" : "6 10";
  const snrValues = route.snrValues || [];
  const lines = [];

  if (snrValues.length >= 2 && segments.length === 1) {
    const segment = segments[0];
    for (let index = 0; index < segment.length - 1; index += 1) {
      const snr = snrValues[Math.min(index, snrValues.length - 1)];
      lines.push(L.polyline([segment[index], segment[index + 1]], {
        renderer: layerRenderer,
        color: snrColor(snr),
        className: lineClass,
        dashArray,
        lineCap: "round",
        lineJoin: "round",
        opacity,
        weight,
      }).addTo(group));
    }
  } else {
    for (const segment of segments) {
      lines.push(L.polyline(segment, {
        renderer: layerRenderer,
        color: route.color,
        className: lineClass,
        dashArray,
        lineCap: "round",
        lineJoin: "round",
        opacity,
        weight,
      }).addTo(group));
    }
  }

  if (useSvg && !archive) {
    for (const line of lines) {
      const element = typeof line.getElement === "function" ? line.getElement() : null;
      if (!element) continue;
      element.style.strokeDasharray = dashArray;
      element.style.animation = state.animationEnabled ? "route-dash 1s linear infinite" : "none";
    }
  }

  const lastPoint = route.points.at(-1);
  const endpoint = L.circleMarker([lastPoint.lat, lastPoint.lon], {
    renderer: layerRenderer,
    color: "#ffffff",
    fillColor: route.color,
    fillOpacity: 1,
    radius: archive ? 4 : 6,
    weight: 2,
  }).addTo(group);

  const snrText = snrValues.length ? ` · SNR ${snrValues.map((value) => value.toFixed(1)).join(" / ")} dB` : "";
  const scopeText = route.scope?.trim() ? ` · ${escapeHtml(route.scope.trim())}` : "";
  lines[0].bindTooltip(`${escapeHtml(route.typeLabel)} · ${formatHops(route.points.length - 1)} · ${route.hashBytes}B${scopeText}${snrText}`, {
    sticky: true,
    className: "route-tooltip",
  });

  const openDetail = (event) => {
    if (state.losMode) return;
    L.DomEvent.stopPropagation(event);
    openRouteDetail(route, event.latlng);
  };
  for (const line of lines) line.on("click", openDetail);
  endpoint.on("click", openDetail);

  return { endpoint, group, line: lines[0], lines, versionId: route.versionId };
}

const feedState = {
  autoPaused: false,
  focused: false,
  hovered: false,
  lastRenderAt: 0,
  lastRenderedVersions: new Set(),
  lastSignature: "",
  latestEmptyText: t("feed.empty"),
  latestRoutes: [],
  manualPaused: false,
  pendingVersions: new Set(),
  renderTimer: null,
  resumeTimer: null,
};

function setFeedBadge() {
  const count = feedState.pendingVersions.size;
  elements.activityNew.hidden = count === 0;
  elements.activityNew.textContent = count === 0 ? "" : (count > 99 ? "99+" : tCount("activity.newItems", count));
}

function setFeedPauseButton() {
  const paused = feedState.manualPaused;
  elements.activityPause.textContent = paused ? t("activity.resume") : t("activity.pause");
  elements.activityPause.title = paused ? t("activity.resume") : t("activity.pause");
  elements.activityPause.setAttribute("aria-pressed", String(paused));
  elements.activityPause.classList.toggle("active", paused);
}

function updateFeedPending() {
  for (const route of feedState.latestRoutes) {
    const version = route.versionId || route.id;
    if (version && !feedState.lastRenderedVersions.has(version)) feedState.pendingVersions.add(version);
  }
  setFeedBadge();
}

function groupFeedRoutes(routes) {
  const groups = new Map();
  for (const route of routes) {
    const key = `${route.typeLabel}|${route.from}|${route.to}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (route.timestamp > existing.route.timestamp) existing.route = route;
    } else {
      groups.set(key, { route, count: 1 });
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.route.timestamp - a.route.timestamp)
    .slice(0, MAX_FEED_ITEMS);
}

function renderFeedNow(groups, emptyText) {
  if (!groups.length) {
    const empty = document.createElement("li");
    empty.className = "feed-empty";
    empty.textContent = emptyText;
    elements.feed.replaceChildren(empty);
    return;
  }
  elements.feed.replaceChildren(...groups.map(({ route, count }) => {
    const item = document.createElement("li");
    item.dataset.hashBytes = String(route.hashBytes);
    item.dataset.packetType = String(route.packetType);
    item.style.setProperty("--route-color", route.color);
    item.innerHTML = `
      <div>
        <b>${escapeHtml(route.typeLabel)}</b>
        ${count > 1 ? `<span class="feed-count">×${count}</span>` : ""}
        <time>${formatTime(route.timestamp)}</time>
      </div>
      <p>${escapeHtml(route.from)} <span>→</span> ${escapeHtml(route.to)}</p>
      <small>${route.scope?.trim() ? `${escapeHtml(route.scope.trim())} · ` : ""}${formatHops(Math.max(1, route.points.length - 1))} · ${route.hashBytes}B · ${formatObservers(route.observerCount)}</small>
    `;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.title = t("route.clickHint");
    const openDetail = (event) => {
      event?.preventDefault();
      event?.stopPropagation();
      openRouteDetail(route, route.bounds?.isValid() ? route.bounds.getCenter() : null);
    };
    item.addEventListener("click", openDetail);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openDetail(event);
    });
    return item;
  }));
}

function flushFeed(force = false) {
  if (feedState.renderTimer != null) {
    clearTimeout(feedState.renderTimer);
    feedState.renderTimer = null;
  }
  if (!force && (feedState.manualPaused || feedState.autoPaused)) {
    updateFeedPending();
    return;
  }
  if (elements.activityPanel.hidden) return;
  const groups = groupFeedRoutes(feedState.latestRoutes);
  const signature = `${feedState.latestEmptyText}|${groups.map(({ route, count }) => `${route.versionId || route.id}:${count}`).join("|")}`;
  feedState.lastRenderAt = Date.now();
  feedState.lastRenderedVersions = new Set(feedState.latestRoutes.map((route) => route.versionId || route.id));
  feedState.pendingVersions.clear();
  setFeedBadge();
  if (signature === feedState.lastSignature) return;
  feedState.lastSignature = signature;
  renderFeedNow(groups, feedState.latestEmptyText);
}

function updateFeed(routes, emptyText = t("feed.empty"), { immediate = false } = {}) {
  feedState.latestRoutes = routes;
  feedState.latestEmptyText = emptyText;
  if (elements.activityPanel.hidden) return;
  if (feedState.manualPaused || feedState.autoPaused) {
    updateFeedPending();
    return;
  }
  if (immediate) {
    flushFeed(true);
    return;
  }
  const elapsed = Date.now() - feedState.lastRenderAt;
  if (elapsed >= FEED_RENDER_INTERVAL_MS) {
    flushFeed();
    return;
  }
  if (feedState.renderTimer != null) return;
  feedState.renderTimer = setTimeout(() => {
    feedState.renderTimer = null;
    flushFeed();
  }, FEED_RENDER_INTERVAL_MS - elapsed);
}

function pauseFeedForInteraction() {
  clearTimeout(feedState.resumeTimer);
  feedState.resumeTimer = null;
  feedState.autoPaused = true;
  updateFeedPending();
}

function resumeFeedAfterInteraction(delay = FEED_AUTO_RESUME_MS) {
  clearTimeout(feedState.resumeTimer);
  feedState.resumeTimer = setTimeout(() => {
    feedState.resumeTimer = null;
    if (feedState.manualPaused || feedState.hovered || feedState.focused) return;
    feedState.autoPaused = false;
    flushFeed(true);
  }, delay);
}

elements.activityPause.addEventListener("click", () => {
  feedState.manualPaused = !feedState.manualPaused;
  clearTimeout(feedState.resumeTimer);
  feedState.resumeTimer = null;
  setFeedPauseButton();
  if (feedState.manualPaused) {
    updateFeedPending();
    return;
  }
  feedState.autoPaused = false;
  flushFeed(true);
});

elements.activityNew.addEventListener("click", () => {
  feedState.autoPaused = false;
  flushFeed(true);
});

elements.activityPanel.addEventListener("pointerenter", () => {
  feedState.hovered = true;
  pauseFeedForInteraction();
});

elements.activityPanel.addEventListener("pointerleave", () => {
  feedState.hovered = false;
  resumeFeedAfterInteraction();
});

elements.activityPanel.addEventListener("focusin", () => {
  feedState.focused = true;
  pauseFeedForInteraction();
});

elements.activityPanel.addEventListener("focusout", (event) => {
  if (elements.activityPanel.contains(event.relatedTarget)) return;
  feedState.focused = false;
  resumeFeedAfterInteraction();
});

elements.feed.addEventListener("scroll", () => {
  if (feedState.manualPaused) return;
  pauseFeedForInteraction();
  resumeFeedAfterInteraction(FEED_SCROLL_RESUME_MS);
}, { passive: true });

setFeedPauseButton();

function updateMapStatus() {
  const show = state.routeWindowMs === 0 && state.liveRouteCount === 0;
  if (!show) {
    elements.mapStatus.hidden = true;
    return;
  }
  elements.mapStatus.textContent = state.mqttConnected
    ? t("map.waiting")
    : t("map.waitingMqtt");
  elements.mapStatus.hidden = false;
}

function routeVisibleIn(viewport, route) {
  return !route.bounds || !route.bounds.isValid() || route.bounds.intersects(viewport);
}

let viewportRenderTimer = null;

function scheduleViewportRender() {
  clearTimeout(viewportRenderTimer);
  viewportRenderTimer = setTimeout(() => {
    applyNodeMembership();
    if (state.routeWindowMs !== 0) renderArchiveViewport();
    else syncRoutePresentation();
    updatePerfGauges();
  }, 150);
}

function updateRouteCount() {
  const count = state.routeWindowMs !== 0 ? state.archiveRoutes.size : state.liveRouteCount;
  elements.routeCount.textContent = formatNumber(count);
  updateMapStatus();
}

function rebuildNeighborIndex() {
  perf.measure("sousedé", () => {
    state.neighborByNode = buildNeighborIndex([
      ...routeStore.history,
      ...routeStore.liveByVersion.values(),
      ...state.archiveRoutes.values(),
    ]);
  });
}

function clearLivePresentation() {
  for (const rendered of state.activeRoutes.values()) routeLayer.removeLayer(rendered.group);
  state.activeRoutes.clear();
  updateRouteAnimation();
}

function clearArchivePresentation() {
  for (const rendered of state.archiveRendered.values()) routeLayer.removeLayer(rendered.group);
  state.archiveRendered.clear();
  state.archiveRoutes.clear();
}

async function loadArchiveWindow(windowMs) {
  const requestId = ++state.windowRequestId;
  const data = await getJson(`/api/history?${archiveQuery(windowMs, nowMs())}`);
  if (requestId !== state.windowRequestId || state.routeWindowMs !== windowMs) return;
  state.archiveRoutes.clear();
  for (const parent of data.packets || []) {
    const observations = parent.observations?.length ? parent.observations : [parent];
    for (const observation of observations) {
      const packet = { ...parent, ...observation };
      const path = parsePath(packet);
      if (!path.length || path.length > MAX_ROUTE_PATH_LENGTH) continue;
      const hashBytes = packetPathHashBytes(packet, path);
      if (!isRouteVisible(Number(packet.payload_type), hashBytes, state)) continue;
      const points = historyRoutePoints(packet);
      if (!routeSegments(points).length) continue;
      const observedAt = routeTimestamp(packet, 0);
      const id = `${packet.hash || "archive"}:${packet.observer_id || "archive"}`;
      state.archiveRoutes.set(id, routeRecord(packet, points, hashBytes, id, `archive:${id}`, observedAt));
    }
  }
  renderArchive();
}

function updateArchiveLayers(routes) {
  const desired = new Map(routes.map((route) => [route.id, route]));
  for (const [id, rendered] of state.archiveRendered) {
    const route = desired.get(id);
    if (!route || route.versionId !== rendered.versionId) {
      routeLayer.removeLayer(rendered.group);
      state.archiveRendered.delete(id);
    }
  }
  for (const route of routes) {
    if (!state.archiveRendered.has(route.id)) {
      const rendered = renderRoute(route, { archive: true });
      if (rendered) state.archiveRendered.set(route.id, rendered);
    }
  }
}

function archiveRoutesSorted() {
  return [...state.archiveRoutes.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function renderArchive() {
  const routes = archiveRoutesSorted();
  const viewport = map.getBounds().pad(0.25);
  updateArchiveLayers(routes.filter((route) => routeVisibleIn(viewport, route)).slice(0, ARCHIVE_MAX_ROUTES));
  updateRouteCount();
  rebuildNeighborIndex();
  updateFeed(routes.slice(0, FEED_SOURCE_LIMIT));
  updatePerfGauges();
}

function renderArchiveViewport() {
  const viewport = map.getBounds().pad(0.25);
  const routes = archiveRoutesSorted()
    .filter((route) => routeVisibleIn(viewport, route))
    .slice(0, ARCHIVE_MAX_ROUTES);
  updateArchiveLayers(routes);
}

async function setRouteWindow(windowMs) {
  state.routeWindowMs = Number(windowMs);
  for (const button of elements.windowButtons) {
    button.classList.toggle("active", Number(button.dataset.windowMs) === state.routeWindowMs);
  }
  clearSelectedRoute();
  if (!state.routeWindowMs) {
    clearArchivePresentation();
    updateFeed([], t("feed.empty"), { immediate: true });
    syncRoutePresentation();
    return;
  }
  state.windowRequestId += 1;
  clearLivePresentation();
  clearArchivePresentation();
  updateRouteCount();
  updateFeed([], t("feed.loadingHistory"), { immediate: true });
  try {
    await loadArchiveWindow(state.routeWindowMs);
  } catch (error) {
    console.error("Historii tras se nepodařilo načíst", error);
  }
}

function updatePerfGauges() {
  if (!perf.enabled) return;
  let elements = 0;
  for (const rendered of state.activeRoutes.values()) elements += rendered.lines.length;
  let shownNodes = 0;
  for (const entry of state.nodeMarkers) if (entry.shown) shownNodes += 1;
  perf.set("trasy", state.liveRouteCount);
  perf.set("animované", state.animationEnabled ? state.activeRoutes.size : 0);
  perf.set("prvky", elements);
  perf.set("uzly", shownNodes);
  perf.set("uzlyCelkem", state.nodeMarkers.length);
  perf.set("archiv", state.archiveRendered.size);
}

function syncRoutePresentation(now = nowMs()) {
  perf.measure("syncRoute", () => syncRoutePresentationCore(now));
}

function syncRoutePresentationCore(now = nowMs()) {
  for (const versionId of routeStore.prune(now)) routeVersions.forget(versionId);
  if (state.routeWindowMs !== 0) return;
  const visibleRoutes = routeStore.visibleLive(state, now);
  state.liveRouteCount = visibleRoutes.length;
  const viewport = map.getBounds().pad(0.25);
  const renderedRoutes = visibleRoutes
    .filter((route) => routeVisibleIn(viewport, route))
    .slice(0, MAX_LIVE_RENDERED);
  const desiredById = new Map(renderedRoutes.map((route) => [route.id, route]));
  for (const [routeId, rendered] of state.activeRoutes) {
    const desired = desiredById.get(routeId);
    if (!desired || desired.versionId !== rendered.versionId) {
      routeLayer.removeLayer(rendered.group);
      state.activeRoutes.delete(routeId);
    }
  }
  for (const route of renderedRoutes) {
    if (!state.activeRoutes.has(route.id)) {
      const rendered = renderRoute(route);
      if (rendered) state.activeRoutes.set(route.id, rendered);
    }
  }
  const previousLastRoutes = state.lastRouteByNodeKey;
  state.lastRouteByNodeKey = routeStore.lastRoutesByNode(state);
  updateFeed(routeStore.visibleFeed(state, now));
  updateRouteCount();
  updateRouteAnimation();
  for (const entry of state.nodeMarkers) {
    const key = entry.node.public_key?.toUpperCase();
    const previous = key ? previousLastRoutes.get(key) : null;
    const current = key ? state.lastRouteByNodeKey.get(key) : null;
    if (entry.marker.isPopupOpen()
      && (previous?.versionId !== current?.versionId || previous?.position !== current?.position)) {
      scheduleOpenNodePopupRefresh(entry);
    }
  }
  updatePerfGauges();
}

let routeAnimationFrame = null;
let lastRouteAnimationAt = 0;
const CANVAS_ANIMATION_FPS = 10;

function routeAnimationEnabled() {
  return state.animationEnabled && state.activeRoutes.size > 0 && !document.hidden;
}

function animateRoutes(timestamp) {
  routeAnimationFrame = null;
  if (!routeAnimationEnabled()) return;
  if (timestamp - lastRouteAnimationAt >= 1000 / CANVAS_ANIMATION_FPS) {
    routeRenderer._dashOffset = -((timestamp / 75) % 16);
    perf.measure("canvas", () => routeRenderer._redraw());
    perf.hit("kresba");
    lastRouteAnimationAt = timestamp;
  }
  routeAnimationFrame = requestAnimationFrame(animateRoutes);
}

function applyLineAnimation(lines, animated) {
  for (const line of lines || []) {
    const element = typeof line.getElement === "function" ? line.getElement() : null;
    if (element) element.style.animation = animated ? "route-dash 1s linear infinite" : "none";
  }
}

function updateRouteAnimation() {
  if (state.animationMode === "svg") {
    if (routeAnimationFrame != null) cancelAnimationFrame(routeAnimationFrame);
    routeAnimationFrame = null;
    const animated = routeAnimationEnabled();
    for (const rendered of state.activeRoutes.values()) applyLineAnimation(rendered.lines, animated);
    return;
  }
  if (!routeAnimationEnabled()) {
    if (routeAnimationFrame != null) cancelAnimationFrame(routeAnimationFrame);
    routeAnimationFrame = null;
    return;
  }
  if (routeAnimationFrame == null) routeAnimationFrame = requestAnimationFrame(animateRoutes);
}

async function handlePacket(packet) {
  try {
    updateAdvertNode(packet);
    if (!packet.hash) return;
    const path = parsePath(packet);
    if (path.length > MAX_ROUTE_PATH_LENGTH) return;
    const hashBytes = packetPathHashBytes(packet, path);
    if (!path.length) return;
    const now = nowMs();
    const packetTime = routeTimestamp(packet, now);
    const createdAt = liveRouteCreatedAt(packetTime, now, state.retentionMs);
    if (createdAt == null) return;
    const observerId = packet.observer_id || "observer";
    const routeId = `${packet.hash}:${observerId}`;
    const versionId = `${routeId}:${JSON.stringify(path)}`;
    await routeVersions.run(versionId, async () => {
      await resolvePrefixes(path);
      const points = packetPoints(packet, path);
      if (!routeSegments(points).length) return false;
      routeStore.addLive(routeRecord(packet, points, hashBytes, routeId, versionId, createdAt));
      syncRoutePresentation();
      return true;
    });
  } catch (error) {
    console.error(error);
  }
}

function connectPacketStream() {
  if (state.packetSource) {
    state.packetSource.close();
    state.packetSource = null;
  }
  const source = new EventSource(appPath("/events/packets"));
  state.packetSource = source;
  source.addEventListener("status", (event) => {
    const status = JSON.parse(event.data);
    state.mqttConnected = Boolean(status.connected);
    setConnection(status.connected, status.connected ? t("connection.mqttOnline") : t("connection.mqttOffline"));
    updateMapStatus();
    if (Number.isFinite(Number(status.time))) state.serverSkewMs = Number(status.time) - Date.now();
    if (Number.isFinite(Number(status.viewers))) {
      elements.viewerCount.textContent = formatNumber(Number(status.viewers));
    }
  });
  source.addEventListener("packet", (event) => {
    state.lastPacketAt = Date.now();
    dispatchPacket(JSON.parse(event.data));
  });
  source.onerror = () => setConnection(false, "MQTT stream odpojen");
}

const STREAM_STALL_MS = 300_000;
function watchPacketStream() {
  if (!state.mqttConnected) return;
  if (state.lastPacketAt && Date.now() - state.lastPacketAt < STREAM_STALL_MS) return;
  console.warn("SSE stream se zasekl, obnovuji připojení");
  state.lastPacketAt = Date.now();
  connectPacketStream();
}

let packetHandlingReady = false;
const pendingPackets = [];

function dispatchPacket(packet) {
  if (packetHandlingReady) {
    void handlePacket(packet);
    return;
  }
  if (pendingPackets.length >= MAX_PENDING_PACKETS) pendingPackets.shift();
  pendingPackets.push(packet);
}

async function releasePendingPackets() {
  const replay = pendingPackets.splice(0);
  try {
    await resolvePrefixes(replay.flatMap((packet) => parsePath(packet)));
  } catch (error) {
    console.error("Cache tras se nepodařilo připravit", error);
  }
  for (const packet of replay) await handlePacket(packet);
  packetHandlingReady = true;
  for (const packet of pendingPackets.splice(0)) void handlePacket(packet);
}

function refreshAfterFilterChange() {
  if (state.selectedRouteId
    && !isRouteVisible(state.selectedRoutePacketType, state.selectedRouteHashBytes, state)) clearSelectedRoute();
  if (state.routeWindowMs !== 0) void setRouteWindow(state.routeWindowMs);
  else syncRoutePresentation();
}

for (const toggle of elements.sizeToggles) {
  toggle.addEventListener("change", () => {
    state.allowedHashBytes = new Set(elements.sizeToggles
      .filter((input) => input.checked)
      .map((input) => Number(input.id.replace("size-toggle-", ""))));
    refreshAfterFilterChange();
  });
}

for (const toggle of elements.roleToggles) {
  toggle.addEventListener("change", () => {
    state.allowedRoles = new Set(elements.roleToggles
      .filter((input) => input.checked)
      .map((input) => input.id.replace("role-toggle-", "")));
    refreshNodeState();
  });
}

for (const button of elements.windowButtons) {
  button.addEventListener("click", () => void setRouteWindow(Number(button.dataset.windowMs)));
}

for (const button of elements.baseLayerButtons) {
  button.classList.toggle("active", button.dataset.layer === activeBaseLayerKey);
  button.addEventListener("click", () => {
    try {
      setBaseLayer(button.dataset.layer);
    } catch (error) {
      console.error("Podklad mapy se nepodařilo přepnout", error);
    }
  });
}
setBaseLayer(activeBaseLayerKey);

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  if (activeBaseLayerKey === "osm") setBaseLayer("osm");
  else if (next === "light" && activeBaseLayerKey === "dark") setBaseLayer("osm");
}

elements.themeToggle.addEventListener("click", () => {
  try {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  } catch (error) {
    console.error("Přepnutí tématu selhalo", error);
  }
});

const LOS_SAMPLE_COUNT = 100;

function losOptions() {
  const frequencyMhz = Number(elements.losFrequency.value) || 869.525;
  return {
    antennaAM: Math.max(1, Number(elements.losAntennaA.value) || 10),
    antennaBM: Math.max(1, Number(elements.losAntennaB.value) || 10),
    frequencyGhz: Math.max(0.1, frequencyMhz / 1000),
  };
}

function recomputeLos() {
  if (!state.losSamples || !state.losEndpoints || !elements.losDialog.open) return;
  const [a, b] = state.losEndpoints;
  renderLosResult(a, b, analyzePath(state.losSamples, losOptions()));
}

function setLosStatus(text) {
  elements.losHint.textContent = text || "";
}

function clearLosDrawing() {
  losLayer.clearLayers();
  state.losCursorMarker = null;
}

function clearLosMarkers() {
  losMarkerLayer.clearLayers();
  state.losMarkers = [];
}

function createLosMarker(latlng, label, index, node = null) {
  const marker = L.marker(latlng, {
    draggable: true,
    keyboard: false,
    bubblingMouseEvents: false,
    icon: L.divIcon({ className: "los-point", html: label, iconSize: [22, 22], iconAnchor: [11, 11] }),
  });
  if (node) {
    marker.bindTooltip(t("los.pointTooltip", {
      label,
      name: escapeHtml(node.name || t("common.unknownNode")),
      role: escapeHtml(roleLabel(node.role)),
    }), {
      className: "node-tooltip",
    });
  }
  const container = map.getContainer();
  marker.on("dragstart", () => {
    container.classList.add("los-dragging");
    marker.unbindTooltip();
  });
  marker.on("dragend", () => {
    void computeLos();
    // Až po kliknutí (mouseup) zase povolíme vrstvy, aby uzel pod kurzorem nechytil klik.
    setTimeout(() => container.classList.remove("los-dragging"), 0);
  });
  marker.addTo(losMarkerLayer);
  state.losMarkers[index] = marker;
}

const elevationService = createElevationService({ endpoint: appPath("/api/elevation") });

function losSegmentColor(point, fraction) {
  if (point.clearanceM < 0) return "#d1374d";
  if (point.clearanceM < fraction * point.fresnelM) return "#e3911c";
  return "#2bbf88";
}

function renderLosChart(result) {
  const width = 600;
  const height = 170;
  const pad = 10;
  const fraction = result.fresnelFraction || 0.6;
  const values = result.profile.flatMap((point) => [
    point.effectiveTerrainM,
    point.lineM + point.fresnelM,
    point.lineM - point.fresnelM,
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (index) => pad + (width - 2 * pad) * (index / Math.max(1, result.profile.length - 1));
  const y = (value) => height - pad - (height - 2 * pad) * ((value - min) / span);
  const terrain = result.profile.map((point, index) => `${x(index).toFixed(1)},${y(point.effectiveTerrainM).toFixed(1)}`).join(" ");
  const line = result.profile.map((point, index) => `${x(index).toFixed(1)},${y(point.lineM).toFixed(1)}`).join(" ");
  const bandUpper = result.profile.map((point, index) => `${x(index).toFixed(1)},${y(point.lineM + fraction * point.fresnelM).toFixed(1)}`).join(" ");
  const bandLower = result.profile
    .map((point, index) => ({ point, index }))
    .reverse()
    .map(({ point, index }) => `${x(index).toFixed(1)},${y(point.lineM - fraction * point.fresnelM).toFixed(1)}`)
    .join(" ");
  const fullUpper = result.profile.map((point, index) => `${x(index).toFixed(1)},${y(point.lineM + point.fresnelM).toFixed(1)}`).join(" ");
  const fullLower = result.profile
    .map((point, index) => ({ point, index }))
    .reverse()
    .map(({ point, index }) => `${x(index).toFixed(1)},${y(point.lineM - point.fresnelM).toFixed(1)}`)
    .join(" ");
  const area = `${pad},${height - pad} ${terrain} ${width - pad},${height - pad}`;
  const blockers = result.profile.slice(1, -1).map((point, offset) => {
    const index = offset + 1;
    if (point.clearanceM >= fraction * point.fresnelM) return "";
    const color = point.clearanceM < 0 ? "#d1374d" : "#e3911c";
    return `<circle cx="${x(index).toFixed(1)}" cy="${y(point.effectiveTerrainM).toFixed(1)}" r="3" fill="${color}" />`;
  }).join("");
  state.losChartScale = { count: result.profile.length, height, pad, width, x, y };
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${t("los.chartLabel")}">
    <polygon points="${fullUpper} ${fullLower}" fill="rgba(40,127,201,0.07)" />
    <polygon points="${bandUpper} ${bandLower}" fill="rgba(40,127,201,0.16)" />
    <polygon points="${area}" fill="rgba(7,142,98,0.16)" />
    <polyline points="${terrain}" fill="none" stroke="#5b6b73" stroke-width="1.5" />
    <polyline points="${line}" fill="none" stroke="#246fc4" stroke-width="2" stroke-dasharray="5 5" />
    ${blockers}
    <g class="los-cursor" style="display:none">
      <line class="los-cursor-bar" x1="0" y1="0" x2="0" y2="0" stroke="#17271f" stroke-width="1" stroke-dasharray="3 3" />
      <circle class="los-cursor-line-dot" cx="0" cy="0" r="3.2" fill="#246fc4" stroke="#fff" stroke-width="1.5" />
      <circle class="los-cursor-ground-dot" cx="0" cy="0" r="3.2" fill="#5b6b73" stroke="#fff" stroke-width="1.5" />
    </g>
  </svg>`;
}

function clearLosCursor() {
  if (state.losCursorMarker) {
    losLayer.removeLayer(state.losCursorMarker);
    state.losCursorMarker = null;
  }
  const group = elements.losChart.querySelector(".los-cursor");
  if (group) group.style.display = "none";
  elements.losHover.textContent = "";
}

function showLosCursor(point) {
  if (!state.losCursorMarker) {
    state.losCursorMarker = L.circleMarker([point.lat, point.lon], {
      renderer: routeSvgRenderer,
      radius: 6,
      color: "#ffffff",
      weight: 2,
      fillColor: "#17271f",
      fillOpacity: 1,
      interactive: false,
    }).addTo(losLayer);
  } else {
    state.losCursorMarker.setLatLng([point.lat, point.lon]);
  }
  const scale = state.losChartScale;
  const group = elements.losChart.querySelector(".los-cursor");
  if (scale && group) {
    const index = Math.max(0, Math.min(scale.count - 1, point.index + point.t));
    const cursorX = scale.x(index);
    const groundY = scale.y(point.effectiveTerrainM);
    const lineY = scale.y(point.lineM);
    group.style.display = "";
    const bar = group.querySelector(".los-cursor-bar");
    bar.setAttribute("x1", cursorX.toFixed(1));
    bar.setAttribute("x2", cursorX.toFixed(1));
    bar.setAttribute("y1", Math.min(groundY, lineY).toFixed(1));
    bar.setAttribute("y2", Math.max(groundY, lineY).toFixed(1));
    const lineDot = group.querySelector(".los-cursor-line-dot");
    lineDot.setAttribute("cx", cursorX.toFixed(1));
    lineDot.setAttribute("cy", lineY.toFixed(1));
    const groundDot = group.querySelector(".los-cursor-ground-dot");
    groundDot.setAttribute("cx", cursorX.toFixed(1));
    groundDot.setAttribute("cy", groundY.toFixed(1));
  }
  const status = point.clearanceM < 0
    ? t("los.status.terrain")
    : (point.clearanceM < (state.losFraction || 0.6) * point.fresnelM ? t("los.status.fresnel") : t("los.status.clear"));
  elements.losHover.textContent = t("los.hover", {
    distance: point.distanceKm.toFixed(1),
    terrain: point.terrainM.toFixed(0),
    line: point.lineM.toFixed(0),
    clearance: point.clearanceM.toFixed(1),
    status,
  });
}

function handleLosHover(event) {
  if (!state.losProfile || !elements.losDialog.open) return;
  const point = nearestOnPath(state.losProfile, event.latlng.lat, event.latlng.lng);
  if (point) showLosCursor(point);
}

function handleLosChartHover(event) {
  if (!state.losProfile || !elements.losDialog.open || !state.losChartScale) return;
  const svg = elements.losChart.querySelector("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width) return;
  const scale = state.losChartScale;
  const svgX = ((event.clientX - rect.left) / rect.width) * scale.width;
  const fraction = (svgX - scale.pad) / Math.max(1, scale.width - 2 * scale.pad);
  const index = fraction * (scale.count - 1);
  const point = profilePointAt(state.losProfile, index);
  if (point) showLosCursor(point);
}

function renderLosResult(a, b, result) {
  clearLosDrawing();
  state.losCursorMarker = null;
  state.losProfile = result.profile;
  state.losFraction = result.fresnelFraction || 0.6;
  const fraction = state.losFraction;
  for (let index = 0; index < result.profile.length - 1; index += 1) {
    const from = result.profile[index];
    const to = result.profile[index + 1];
    L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
      renderer: routeSvgRenderer,
      color: losSegmentColor(from, fraction),
      weight: 4,
      opacity: 0.95,
    }).addTo(losLayer);
  }
  const status = !result.clear
    ? t("los.result.blocked")
    : (result.fresnelClear ? t("los.result.clear") : t("los.result.fresnel"));
  elements.losSummary.textContent = t("los.summary", {
    distance: result.distanceKm.toFixed(1),
    fresnel: result.fresnelM.toFixed(0),
    clearance: result.minClearanceM.toFixed(1),
    fresnelClearance: result.minFresnelClearanceM.toFixed(1),
    status,
  });
  elements.losChart.innerHTML = renderLosChart(result);
  if (!elements.losDialog.open) elements.losDialog.show();
}

async function computeLos() {
  if (!state.losMarkers[0] || !state.losMarkers[1]) return;
  const computeId = (state.losComputeId += 1);
  if (state.losAbortController) state.losAbortController.abort();
  state.losAbortController = new AbortController();
  const a = state.losMarkers[0].getLatLng();
  const b = state.losMarkers[1].getLatLng();
  state.losEndpoints = [{ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }];
  setLosStatus(t("los.calculating"));
  try {
    const { points } = interpolatePath(state.losEndpoints[0], state.losEndpoints[1], LOS_SAMPLE_COUNT);
    const elevations = await elevationService.fetchElevations(points, state.losAbortController.signal);
    if (computeId !== state.losComputeId) return;
    if (elevations.some((value) => value == null || !Number.isFinite(Number(value)))) {
      setLosStatus(t("los.someMissing"));
      return;
    }
    const samples = points.map((point, index) => ({
      distanceKm: point.distanceKm,
      lat: point.lat,
      lon: point.lon,
      terrainM: Number(elevations[index]),
    }));
    state.losSamples = samples;
    renderLosResult(state.losEndpoints[0], state.losEndpoints[1], analyzePath(samples, losOptions()));
    setLosStatus(t("los.dragHint"));
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error("LOS se nepodařilo spočítat", error);
    if (error instanceof ElevationError && error.retryAfterMs > 0) {
      const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
      setLosStatus(t("los.rateLimited", { seconds }));
    } else {
      setLosStatus(t("los.loadFailed"));
    }
  }
}

async function handleLosClick(latlng, node = null) {
  if (state.losMarkers[0] && state.losMarkers[1]) {
    state.losProfile = null;
    state.losSamples = null;
    state.losEndpoints = null;
    state.losPoints = [];
    if (state.losAbortController) state.losAbortController.abort();
    clearLosCursor();
    clearLosDrawing();
    clearLosMarkers();
    if (elements.losDialog.open) elements.losDialog.close();
  }
  if (!state.losMarkers[0]) {
    clearLosDrawing();
    createLosMarker(latlng, "A", 0, node);
    setLosStatus(node
      ? t("los.pointA", {
        name: node.name || t("common.unknownNode"),
        role: roleLabel(node.role),
      })
      : t("los.pointBHint"));
    return;
  }
  createLosMarker(latlng, "B", 1, node);
  await computeLos();
}

function setLosMode(on) {
  state.losMode = Boolean(on);
  elements.losToggle.classList.toggle("active", state.losMode);
  elements.losToggle.setAttribute("aria-pressed", String(state.losMode));
  elements.losHint.hidden = !state.losMode;
  map.getContainer().style.cursor = state.losMode ? "crosshair" : "";
  state.losPoints = [];
  state.losProfile = null;
  state.losSamples = null;
  state.losEndpoints = null;
  if (state.losAbortController) state.losAbortController.abort();
  clearLosDrawing();
  clearLosMarkers();
  if (elements.losDialog.open) elements.losDialog.close();
  if (state.losMode) setLosStatus(t("los.firstHint"));
}

elements.losToggle.addEventListener("click", () => setLosMode(!state.losMode));
state.losRecomputeButton.addEventListener("click", () => void computeLos());
elements.losClose.addEventListener("click", () => elements.losDialog.close());
elements.losDialog.addEventListener("close", clearLosCursor);
elements.losChart.addEventListener("mousemove", handleLosChartHover);
elements.losChart.addEventListener("mouseleave", clearLosCursor);
for (const input of [elements.losFrequency, elements.losAntennaA, elements.losAntennaB]) {
  input.addEventListener("input", recomputeLos);
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (elements.losDialog.open) elements.losDialog.close();
  else if (state.losMode) setLosMode(false);
});

elements.otherTypesToggle.addEventListener("change", () => {
  state.showOtherPacketTypes = elements.otherTypesToggle.checked;
  localStorage.setItem("meshcoreShowOtherPacketTypes", String(state.showOtherPacketTypes));
  refreshAfterFilterChange();
});

elements.animationToggle.addEventListener("change", () => {
  state.animationEnabled = elements.animationToggle.checked;
  localStorage.setItem("meshcoreAnimateRoutes", String(state.animationEnabled));
  updateRouteAnimation();
});

elements.nodeLabelsToggle.checked = state.showNodeLabels;
elements.nodeLabelsToggle.addEventListener("change", () => {
  state.showNodeLabels = elements.nodeLabelsToggle.checked;
  localStorage.setItem("meshcoreShowNodeLabels", String(state.showNodeLabels));
  rebuildNodeLabels();
});
map.on("moveend zoomend", scheduleNodeLabels);
map.on("moveend zoomend resize", scheduleViewportRender);

const hud = document.querySelector("#hud");
const hudToggle = document.querySelector("#hud-toggle");
const activityToggle = document.querySelector("#activity-toggle");
const activityPanel = document.querySelector(".activity-panel");
const nodeSearch = document.querySelector("#node-search");
const searchResults = document.querySelector("#search-results");

L.DomEvent.disableClickPropagation(hud);
L.DomEvent.disableScrollPropagation(hud);

const HUD_COLLAPSED_KEY = "meshcoreHudCollapsed";
const storedHudCollapsed = localStorage.getItem(HUD_COLLAPSED_KEY);
const initialHudCollapsed = storedHudCollapsed == null
  ? window.matchMedia("(max-width: 700px)").matches
  : storedHudCollapsed === "true";
hud.classList.toggle("collapsed", initialHudCollapsed);
hudToggle.setAttribute("aria-expanded", String(!initialHudCollapsed));

hudToggle.addEventListener("click", () => {
  const collapsed = hud.classList.toggle("collapsed");
  hudToggle.setAttribute("aria-expanded", String(!collapsed));
  localStorage.setItem(HUD_COLLAPSED_KEY, String(collapsed));
});

activityToggle.addEventListener("click", () => {
  const show = activityPanel.hidden;
  activityPanel.hidden = !show;
  activityToggle.textContent = show ? t("activity.hide") : t("activity.show");
  activityToggle.setAttribute("aria-pressed", String(show));
  if (show) {
    feedState.autoPaused = false;
    flushFeed(true);
  }
});

const STATS_ROLES = new Set(["repeater", "room", "sensor"]);

function formatStatsValue(field, value) {
  return field.endsWith("_score")
    ? formatPercent(value)
    : formatNumber(value);
}

function renderStats() {
  if (elements.statsPanel.hidden) return;
  const field = resolveStatsField(state.statsMetric, state.statsWindow);
  if (!field) {
    const empty = document.createElement("li");
    empty.className = "stats-empty";
    empty.textContent = t("stats.emptyCombination");
    elements.statsList.replaceChildren(empty);
    return;
  }
  const ranked = rankNodesByMetric(
    [...state.nodeByKey.values()],
    field,
    state.statsCount,
    STATS_ROLES,
  );
  if (!ranked.length) {
    const empty = document.createElement("li");
    empty.className = "stats-empty";
    empty.textContent = t("stats.emptyMetric");
    elements.statsList.replaceChildren(empty);
    return;
  }
  elements.statsList.replaceChildren(...ranked.map(({ node, value }, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stats-row";
    const hashSize = Math.max(Number(node.multi_byte_max_hash_size) || 0, Number(node.hash_size) || 0);
    const prefix = node.public_key && hashSize ? node.public_key.slice(0, hashSize * 2).toUpperCase() : "";
    const meta = [roleLabel(node.role), prefix].filter(Boolean).join(" · ");
    button.innerHTML = `
      <span class="stats-rank">${index + 1}</span>
      <span class="stats-name">${escapeHtml(node.name || t("common.unknownNode"))}</span>
      <span class="stats-meta">${escapeHtml(meta)}</span>
      <span class="stats-value">${escapeHtml(formatStatsValue(field, value))}</span>
    `;
    button.addEventListener("click", () => {
      const entry = state.nodeMarkerByKey.get(node.public_key?.toUpperCase());
      if (!entry) return;
      revealNodeMarker(entry);
      map.flyTo(entry.marker.getLatLng(), 11, { duration: 0.7 });
      entry.marker.openPopup();
    });
    item.appendChild(button);
    return item;
  }));
}

async function loadVisitStats() {
  try {
    const data = await getJson("/api/visit-stats?days=7");
    const rows = [
      [t("stats.today"), t("stats.visitsToday", {
        visits: formatNumber(Number(data.today.visits)),
        unique: formatNumber(Number(data.today.uniqueVisitors)),
        peak: formatNumber(Number(data.today.peakViewers)),
      })],
      [t("stats.total"), t("stats.visitsTotal", {
        visits: formatNumber(Number(data.totals.visits)),
        peak: formatNumber(Number(data.totals.peakViewers)),
      })],
    ];
    elements.statsVisits.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "stats-visits-row";
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("b");
      val.textContent = value;
      row.append(key, val);
      return row;
    }));
    elements.statsVisits.hidden = false;
  } catch (error) {
    console.error("Statistiky návštěv se nepodařilo načíst", error);
    elements.statsVisits.hidden = true;
  }
}

elements.statsToggle.addEventListener("click", () => {
  const show = elements.statsPanel.hidden;
  elements.statsPanel.hidden = !show;
  elements.statsToggle.textContent = show ? t("stats.hide") : t("stats.show");
  elements.statsToggle.setAttribute("aria-pressed", String(show));
  if (show) {
    renderStats();
    void loadVisitStats();
  }
});

elements.statsClose.addEventListener("click", () => {
  elements.statsPanel.hidden = true;
  elements.statsToggle.textContent = t("stats.show");
  elements.statsToggle.setAttribute("aria-pressed", "false");
});

elements.statsMetric.addEventListener("change", () => {
  state.statsMetric = elements.statsMetric.value;
  renderStats();
});

elements.statsWindow.addEventListener("change", () => {
  state.statsWindow = elements.statsWindow.value;
  renderStats();
});

for (const button of elements.statsCounts.querySelectorAll("button")) {
  button.addEventListener("click", () => {
    state.statsCount = Number(button.dataset.count);
    for (const other of elements.statsCounts.querySelectorAll("button")) {
      other.classList.toggle("active", other === button);
    }
    renderStats();
  });
}

nodeSearch.addEventListener("input", () => {
  const { query, hexQuery } = parseNodeQuery(nodeSearch.value);
  searchResults.replaceChildren();
  if (query.length < 2) {
    searchResults.hidden = true;
    return;
  }

  const matches = state.nodeMarkers
    .filter(({ node }) => nodeMatchesQuery(node, query, hexQuery))
    .slice(0, 6);
  for (const { marker, node } of matches) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const hashSize = Math.max(Number(node.multi_byte_max_hash_size) || 0, Number(node.hash_size) || 0) || 2;
    const prefix = node.public_key ? node.public_key.slice(0, hashSize * 2).toUpperCase() : "";
    const meta = [roleLabel(node.role), prefix].filter(Boolean).join(" · ");
    button.innerHTML = `<strong>${escapeHtml(node.name || t("common.unknownNode"))}</strong><small>${escapeHtml(meta)}</small>`;
    button.addEventListener("click", () => {
      const entry = state.nodeMarkerByKey.get(node.public_key?.toUpperCase());
      if (entry) revealNodeMarker(entry);
      map.flyTo(marker.getLatLng(), 11, { duration: 0.7 });
      marker.openPopup();
      nodeSearch.value = node.name || "";
      searchResults.hidden = true;
    });
    item.appendChild(button);
    searchResults.appendChild(item);
  }
  searchResults.hidden = matches.length === 0;
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".node-search")) searchResults.hidden = true;
});

elements.qrClose.addEventListener("click", () => elements.qrDialog.close());
elements.qrDialog.addEventListener("click", (event) => {
  if (event.target === elements.qrDialog) elements.qrDialog.close();
});

function setFeedbackStatus(text, isError) {
  elements.feedbackStatus.textContent = text;
  elements.feedbackStatus.classList.toggle("error", Boolean(isError));
}

function renderFeedbackPublic(entries) {
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "fb-empty";
    empty.textContent = t("feedback.emptyPublic");
    elements.feedbackList.replaceChildren(empty);
    return;
  }
  elements.feedbackList.replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    const head = document.createElement("div");
    head.className = "fb-head";
    const name = document.createElement("span");
    name.className = "fb-name";
    name.textContent = entry.name || t("feedback.visitor");
    const time = document.createElement("time");
    time.textContent = formatNodeDate(entry.created_at);
    head.append(name, time);
    const body = document.createElement("p");
    body.textContent = entry.message;
    item.append(head, body);
    return item;
  }));
}

async function loadFeedbackPublic() {
  try {
    const data = await getJson("/api/feedback/public");
    renderFeedbackPublic(data.entries || []);
  } catch (error) {
    console.error("Veřejné vzkazy se nepodařilo načíst", error);
  }
}

elements.feedbackToggle.addEventListener("click", () => {
  setFeedbackStatus("", false);
  if (!elements.feedbackDialog.open) elements.feedbackDialog.showModal();
  void loadFeedbackPublic();
});

elements.feedbackClose.addEventListener("click", () => elements.feedbackDialog.close());
elements.feedbackCancel.addEventListener("click", () => elements.feedbackDialog.close());
elements.feedbackDialog.addEventListener("click", (event) => {
  if (event.target === elements.feedbackDialog) elements.feedbackDialog.close();
});

elements.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = elements.feedbackMessage.value.trim();
  if (message.length < 5) {
    setFeedbackStatus(t("feedback.tooShort"), true);
    return;
  }
  elements.feedbackSend.disabled = true;
  setFeedbackStatus(t("feedback.sending"), false);
  try {
    await postJson("/api/feedback", {
      category: elements.feedbackCategory.value,
      contact: elements.feedbackContact.value.trim(),
      isPublic: elements.feedbackPublic.checked,
      message,
      name: elements.feedbackName.value.trim(),
    });
    elements.feedbackForm.reset();
    setFeedbackStatus(t("feedback.sent"), false);
    void loadFeedbackPublic();
    setTimeout(() => {
      if (elements.feedbackDialog.open) elements.feedbackDialog.close();
    }, 1_500);
  } catch (error) {
    setFeedbackStatus(
      getLocale() === "en" ? t("feedback.failed") : t("feedback.failedWith", { message: error.message }),
      true,
    );
  } finally {
    elements.feedbackSend.disabled = false;
  }
});
document.addEventListener("visibilitychange", updateRouteAnimation);

const initialWindow = parseRouteWindowParam(INITIAL_PARAMS.get("window"));
if (initialWindow != null && initialWindow !== 0) void setRouteWindow(initialWindow);

async function start() {
  console.info(`Route animation mode: ${state.animationMode}`);
  connectPacketStream();
  const nodesPromise = loadNodes();
  void loadStats();
  setInterval(() => loadBaseData().catch((error) => console.error("Obnova dat selhala", error)), BASE_DATA_REFRESH_MS);
  setInterval(refreshNodeState, 60_000);
  setInterval(syncRoutePresentation, 1_000);
  setInterval(watchPacketStream, 30_000);
  setInterval(rebuildNeighborIndex, 5_000);
  setInterval(() => {
    if (state.routeWindowMs !== 0) {
      void loadArchiveWindow(state.routeWindowMs)
        .catch((error) => console.error("Obnova historie selhala", error));
    }
  }, ARCHIVE_REFRESH_MS);
  updateRouteAnimation();
  const nodesLoaded = await nodesPromise;
  await releasePendingPackets();
  if (!nodesLoaded) setConnection(false, t("connection.nodesFailed"));
}

start();

if (perf.enabled) {
  window.__perf = perf;
  const perfLoop = (timestamp) => {
    perf.frame(timestamp);
    requestAnimationFrame(perfLoop);
  };
  requestAnimationFrame(perfLoop);
}
