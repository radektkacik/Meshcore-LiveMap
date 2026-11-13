import L from "leaflet";
import QRCode from "qrcode";
import { createState } from "./app-state.js";
import { elements } from "./elements.js";
import { createExportController } from "./export-controller.js";
import { createFeedbackController } from "./feedback-controller.js";
import { escapeHtml } from "../html.mjs";
import "leaflet/dist/leaflet.css";
import "./style.css";
import {
  archiveQuery,
  isRouteVisible,
  liveRouteCreatedAt,
  maxRouteHopKm,
  packetPathHashBytes,
  parsePath,
  resolveCandidateChain,
} from "./route-utils.js";
import { analyzePath, interpolatePath, nearestOnPath, profilePointAt, haversineKm } from "./los.js";
import { clampActivitySize } from "./activity-size.js";
import { CLEAR, PARTIAL } from "./coverage.js";
import { createElevationService, ElevationError } from "./elevation.js";
import {
  buildCsv,
  exportFileName,
  featureCollection,
  multiLineFeature,
  pointFeature,
} from "./export-model.js";
import { createPerfMonitor } from "./perf.js";
import { observerAnchor } from "./observer-locations.js";
import { createPhotoGalleryController } from "./photo-gallery-controller.js";
import { createPhotoLightboxController } from "./photo-lightbox-controller.js";
import { createPhotoManageController } from "./photo-manage-controller.js";
import { createPhotoTokenStore } from "./photo-token-store.js";
import { createNodeInfoTokenStore } from "./node-info-token-store.js";
import { createPhotoUploadController } from "./photo-upload-controller.js";
import { getPhotoJson, voteForPhoto } from "./photo-vote-client.js";
import { createSearchController } from "./search-controller.js";
import { createStatsController } from "./stats-controller.js";
import {
  isNewNode,
  isNodeRoleAllowed,
  nodeLastActivity,
  nodeMatchesQuery,
  nodeMetric,
  parseNodeQuery,
  rankNodesByMetric,
  rankNodeTiers,
  resolveStatsField,
  validCoords,
} from "./node-model.js";
import { buildNeighborIndex, groupTraceObservations, RouteStore, RouteVersionState, routeTimestamp } from "./route-model.js";
import { searchEntities } from "./search-model.js";
import {
  applyStaticTranslations,
  formatDate,
  formatDateTime,
  formatDateTimeShort,
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
import {
  batteryTypeName,
  countWithRank,
  formatHops,
  formatObservers,
  formatScore,
  rankSuffix,
  scoredWithRank,
  usefulnessGrade,
  voltageSourceName,
} from "./format-utils.js";

applyStaticTranslations();

const MAX_FEED_ITEMS = 8;
const FEED_SOURCE_LIMIT = MAX_FEED_ITEMS * 4;
const HISTORY_FEED_ITEMS = 300;
const HISTORY_SOURCE_LIMIT = 2000;
const FEED_RENDER_INTERVAL_MS = 2_000;
const FEED_AUTO_RESUME_MS = 2_500;
const FEED_SCROLL_RESUME_MS = 6_000;
const NODE_HISTORY_TTL_MS = 5 * 60 * 1000;
const NODE_ANALYTICS_TTL_MS = 5 * 60 * 1000;
const MAX_MAP_ZOOM = 19;
const MAX_LIVE_RENDERED = 350;
const MAX_LIVE_STORED = 3000;
const MAX_ROUTE_PATH_LENGTH = 32;
const DEFAULT_ROUTE_RETENTION_MS = 30_000;
const ROUTE_RETENTION_OPTIONS = [15_000, 30_000, 60_000, 120_000];
const ROUTE_HISTORY_LIMIT = 1200;
const NODE_ACTIVE_MS = 12 * 60 * 60 * 1000;
const NODE_RANKING_ACTIVE_MS = 24 * 60 * 60 * 1000;
const BASE_DATA_REFRESH_MS = 15 * 60 * 1000;
const OBSERVER_REFRESH_MS = 5 * 60 * 1000;
const BUILD_CHECK_MS = 60_000;
const BUILD_RELOAD_KEY = "meshcoreAutoReloadBuild";
const API_TIMEOUT_MS = 20_000;
const MAX_PENDING_PACKETS = 5_000;
const MAX_RESOLVE_BATCH = 80;
const PREFIX_CACHE_LIMIT = 5_000;
const PREFIX_NULL_TTL_MS = 120_000;
const ARCHIVE_REFRESH_MS = 60_000;
const ARCHIVE_MAX_ROUTES = 6000;
const ROUTE_CACHE_KEY = "meshcoreLiveRouteCache";
const ROUTE_CACHE_VERSION = 1;
const ROUTE_CACHE_MAX = 200;
const ROUTE_CACHE_TTL_MS = 15 * 60 * 1000;
const ROUTE_CACHE_SAVE_MS = 5_000;
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
if (IS_BETA) document.querySelector("#beta-footer-link")?.remove();
const MAP_PATH = APP_BASE ? `${APP_BASE}/` : "/";

function nodeDetailPathKey(pathname = location.pathname) {
  const rest = APP_BASE && pathname.startsWith(APP_BASE)
    ? pathname.slice(APP_BASE.length)
    : pathname;
  const match = rest.match(/^\/nod\/([0-9a-f]{64})\/?$/i);
  return match ? match[1].toLowerCase() : null;
}

const INITIAL_DETAIL_KEY = nodeDetailPathKey();
function nodeDetailPath(key) {
  return `${APP_BASE}/nod/${String(key || "").toLowerCase()}`;
}

function appPath(path) {
  return `${APP_BASE}${path}`;
}

const INITIAL_PARAMS = new URLSearchParams(location.search);
const ALL_NODE_ROLES = ["repeater", "companion", "room", "sensor", "unknown"];
const ALL_HASH_SIZES = [1, 2, 3];
const ALL_HEALTH_STATUSES = ["full", "ok", "warn", "critical", "stale"];
const HEALTH_STATUS_FILTERS = [...ALL_HEALTH_STATUSES, "below-ok", "problem"];
const REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const mobileSheetQuery = window.matchMedia("(max-width: 700px)");
const FORCE_MOBILE_SHEET = INITIAL_PARAMS.get("sheet") === "1";
const INITIAL_NODE_KEY = INITIAL_PARAMS.get("node")?.trim().toUpperCase() || null;
const INITIAL_PACKET_HASH = /^[0-9a-f]{4,64}$/i.test(INITIAL_PARAMS.get("packet") || "")
  ? INITIAL_PARAMS.get("packet").toLowerCase()
  : null;
const INITIAL_ZOOM = Number(INITIAL_PARAMS.get("z"));

const THEME_KEY = "meshcoreTheme";
const FONT_SIZE_KEY = "meshcoreFontSize";
const FONT_SIZE_VALUES = ["xsmall", "small", "normal", "large", "xlarge"];
const storedFontSize = localStorage.getItem(FONT_SIZE_KEY);
const initialFontSize = FONT_SIZE_VALUES.includes(storedFontSize) ? storedFontSize : "small";
document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
document.documentElement.dataset.fontSize = initialFontSize;

// Pinch over UI must not zoom the whole page; the map and photo lightbox handle their own gestures.
const pinchOwnedSelector = "#map, .photo-lightbox-stage";
function isPinchOwnedTarget(target) {
  return target instanceof Element && Boolean(target.closest(pinchOwnedSelector));
}
function preventPagePinch(event) {
  // The map handles its own pinch; the photo lightbox has a custom two-finger zoom.
  if (!(event.target instanceof Element && event.target.closest("#map"))) event.preventDefault();
}
document.addEventListener("gesturestart", preventPagePinch, { passive: false });
document.addEventListener("gesturechange", preventPagePinch, { passive: false });
document.addEventListener("touchmove", (event) => {
  if (event.touches.length > 1 && !isPinchOwnedTarget(event.target)) event.preventDefault();
}, { passive: false });


elements.otherTypesToggle.checked = localStorage.getItem("meshcoreShowOtherPacketTypes") === "true";
elements.buildStamp.textContent = `build ${typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"}`;
if (IS_BETA) {
  elements.betaBadge.hidden = false;
  document.title = "MeshCore CZ · beta";
  elements.betaNotice.hidden = false;
  elements.betaNoticeTitle.textContent = t("lang.betaTitle");
  elements.betaNoticeText.textContent = t("lang.betaNotice");
  elements.betaNoticeLink.textContent = t("lang.betaCta");
  elements.betaNoticeLink.href = getLocale() === "en"
    ? "https://mapa.meshcore.cz/?lang=en"
    : "https://mapa.meshcore.cz/";
}
elements.exportToggle.hidden = true;

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
if (elements.fontSizeLabel) elements.fontSizeLabel.textContent = t("fontSize.label");
if (elements.fontSizeSelect) {
  elements.fontSizeSelect.value = initialFontSize;
  for (const option of elements.fontSizeSelect.options) {
    option.textContent = t(`fontSize.${option.value}`);
  }
  elements.fontSizeSelect.addEventListener("change", () => {
    const next = FONT_SIZE_VALUES.includes(elements.fontSizeSelect.value)
      ? elements.fontSizeSelect.value
      : "small";
    document.documentElement.dataset.fontSize = next;
    localStorage.setItem(FONT_SIZE_KEY, next);
    scheduleNodeLabels();
  });
}
elements.animationToggle.checked = localStorage.getItem("meshcoreAnimateRoutes") !== "false";

function initialRouteRetentionMs() {
  const fromUrl = Number(INITIAL_PARAMS.get("retention")) * 1000;
  if (ROUTE_RETENTION_OPTIONS.includes(fromUrl)) return fromUrl;
  const stored = Number(localStorage.getItem("meshcoreRouteRetentionMs"));
  return ROUTE_RETENTION_OPTIONS.includes(stored) ? stored : DEFAULT_ROUTE_RETENTION_MS;
}

const initialRetentionMs = initialRouteRetentionMs();
elements.routeRetention.value = String(initialRetentionMs);

const state = createState({
  elements,
  initialRetentionMs,
  allowedRoles: ALL_NODE_ROLES,
});

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
  const readFlag = (name) => {
    const value = INITIAL_PARAMS.get(name);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  };
  const otherTypes = readFlag("other");
  if (otherTypes !== null) {
    state.showOtherPacketTypes = otherTypes;
    elements.otherTypesToggle.checked = otherTypes;
  }
  const labels = readFlag("labels");
  if (labels !== null) {
    state.showNodeLabels = labels;
    elements.nodeLabelsToggle.checked = labels;
  }
  const hidden = readFlag("hide");
  if (hidden !== null) {
    state.hideRoutes = hidden;
    elements.hideRoutesToggle.checked = hidden;
  }
  const animate = readFlag("animate");
  if (animate !== null) {
    state.animationEnabled = animate;
    elements.animationToggle.checked = animate;
  }
  const photos = readFlag("photos");
  if (photos !== null) {
    state.photosOnly = photos;
    elements.photosOnlyToggle.checked = photos;
  }
  const health = readFlag("health");
  if (health !== null) {
    state.healthOnly = health;
    elements.healthOnlyToggle.checked = health;
  }
  const healthStatus = INITIAL_PARAMS.get("healthStatus");
  if (HEALTH_STATUS_FILTERS.includes(healthStatus)) {
    state.healthStatus = healthStatus;
    elements.healthStatusSelect.value = healthStatus;
  }
  const healthValues = readFlag("healthValues");
  if (healthValues !== null) state.showHealthValues = healthValues;
  const healthValueMode = INITIAL_PARAMS.get("healthValue");
  if (healthValueMode === "temperature" || healthValueMode === "voltage") state.healthValueMode = healthValueMode;
  elements.healthValuesToggle.checked = state.showHealthValues;
  elements.healthValueMode.value = state.healthValueMode;
  elements.healthValueModeWrap.hidden = !state.showHealthValues;
  elements.healthStatusBlock.hidden = !state.healthOnly;
  updateHealthLegend();
  const inactive = readFlag("inactive");
  if (inactive !== null) {
    state.inactiveOnly = inactive;
    elements.inactiveOnlyToggle.checked = inactive;
  }
  const observers = readFlag("observers");
  if (observers !== null) state.showObservers = observers;
}

applyInitialFilters();
const routeStore = new RouteStore({
  retentionMs: initialRetentionMs,
  feedLimit: FEED_SOURCE_LIMIT,
  capacity: MAX_LIVE_STORED,
});
const routeVersions = new RouteVersionState();
const perf = createPerfMonitor(new URLSearchParams(location.search).has("perf"));

const map = L.map("map", {
  center: [49.82, 15.45],
  zoom: 7,
  minZoom: 6,
  maxZoom: MAX_MAP_ZOOM,
  zoomControl: false,
  preferCanvas: true,
  zoomAnimation: !REDUCED_MOTION,
  fadeAnimation: !REDUCED_MOTION,
  markerZoomAnimation: !REDUCED_MOTION,
});

L.control.zoom({ position: "bottomleft" }).addTo(map);

const initialLatValue = INITIAL_PARAMS.get("lat");
const initialLonValue = INITIAL_PARAMS.get("lon");
const initialLat = initialLatValue == null ? NaN : Number(initialLatValue);
const initialLon = initialLonValue == null ? NaN : Number(initialLonValue);
if (Number.isFinite(initialLat) && Number.isFinite(initialLon)
  && initialLat >= -90 && initialLat <= 90 && initialLon >= -180 && initialLon <= 180) {
  const initialViewZoom = INITIAL_PARAMS.has("z") && Number.isFinite(INITIAL_ZOOM)
    ? Math.max(6, Math.min(MAX_MAP_ZOOM, INITIAL_ZOOM))
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
    maxZoom: MAX_MAP_ZOOM,
    maxNativeZoom: 17,
    subdomains: "abc",
  }),
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    className: "satellite-layer",
    maxZoom: 19,
    maxNativeZoom: 18,
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
const requestedBaseLayer = INITIAL_PARAMS.get("base");
const initialBaseLayer = BASE_KEYS.includes(requestedBaseLayer) ? requestedBaseLayer : storedBaseLayer;
let activeBaseLayerKey = BASE_KEYS.includes(initialBaseLayer)
  ? (initialBaseLayer === "dark" && document.documentElement.dataset.theme !== "dark" ? "osm" : initialBaseLayer)
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
const observerLayer = L.layerGroup();
const selectedRouteLayer = L.layerGroup().addTo(map);
const neighborLayer = L.layerGroup();
map.createPane("snrLabelPane");
map.getPane("snrLabelPane").style.zIndex = "450";
map.getPane("snrLabelPane").style.pointerEvents = "none";
const snrLabelLayer = L.layerGroup().addTo(map);
let snrLabelTimer = null;
let snrLabelSignature = "";
if (routesSuppressed()) {
  map.removeLayer(routeLayer);
  map.removeLayer(selectedRouteLayer);
}
elements.hideRoutesToggle.checked = state.hideRoutes;
const losLayer = L.layerGroup().addTo(map);
const losMarkerLayer = L.layerGroup().addTo(map);
const nodeLabelLayer = L.layerGroup().addTo(map);
const healthLayer = L.layerGroup().addTo(map);
const routeRenderer = L.canvas({ padding: 0.3, tolerance: 8 });
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

const TOP_TIER_COLOR = "#df5064";
const SECOND_TIER_COLOR = "#efa438";

function nodeHealthStatusCode(node) {
  const status = String(node?.health?.batteryStatus || "").toLowerCase();
  return ALL_HEALTH_STATUSES.includes(status) ? status : (node?.health ? "unknown" : "none");
}

function nodeHealthStatusText(node) {
  const status = nodeHealthStatusCode(node);
  return status === "unknown" || status === "none" ? null : t(`node.healthBattery.${status}`);
}

function nodeHealthSnapshot(node) {
  const health = node?.health && typeof node.health === "object" ? node.health : null;
  const battery = health?.batteryMv != null && Number.isFinite(Number(health.batteryMv))
    ? Number(health.batteryMv)
    : null;
  const temperature = health?.temperatureC != null && Number.isFinite(Number(health.temperatureC))
    ? Number(health.temperatureC)
    : null;
  const humidity = health?.humidityPct != null && Number.isFinite(Number(health.humidityPct))
    ? Number(health.humidityPct)
    : null;
  const current = health?.currentMa != null && Number.isFinite(Number(health.currentMa))
    ? Number(health.currentMa)
    : null;
  return { battery, current, health, humidity, temperature };
}

function nodeHealthSampleText(node) {
  const observedAt = node?.health?.observedAt;
  return observedAt ? t("node.healthSampleTime", { time: formatDateTimeShort(observedAt) }) : "";
}

function nodeHealthMatchesFilter(node, filter) {
  if (filter === "all") return true;
  const status = nodeHealthStatusCode(node);
  if (filter === "below-ok") return status === "warn" || status === "critical";
  if (filter === "problem") return status === "warn" || status === "critical" || status === "stale";
  return status === filter;
}

function nodeHealthMapTitle(node) {
  const { health, battery, temperature } = nodeHealthSnapshot(node);
  if (!health) return "";
  const status = nodeHealthStatusCode(node);
  return [
    battery == null ? null : `${t("node.battery")}: ${formatDecimal(battery / 1000, 2)} V`,
    status === "unknown" ? t("common.unknown") : t(`node.healthBattery.${status}`),
    temperature == null ? null : `${t("node.temperature")}: ${formatDecimal(temperature, 1)} °C`,
    nodeHealthSampleText(node),
  ].filter(Boolean).join(" · ");
}

function nodeMarkerStyle(node, tier) {
  const color = roleColor(node.role);
  const isNew = isNewNode(node, nowMs());
  const base = {
    radius: node.role === "repeater" || node.role === "companion" ? 7 : 6,
    color: isNew ? "#f59e0b" : "#202a33",
    fillColor: color,
    fillOpacity: 1,
    opacity: 1,
    weight: isNew ? 3 : 1,
  };
  if (tier === "top") {
    return { ...base, fillColor: TOP_TIER_COLOR };
  }
  if (tier === "second") {
    return { ...base, fillColor: SECOND_TIER_COLOR };
  }
  return base;
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

function renderNodeDetails(title, rows, help = "", className = "") {
  const details = rows
    .filter(([, value]) => value != null)
    .map(([label, value, description, rowClass, extraHtml]) => `
      <div${rowClass ? ` class="${escapeHtml(rowClass)}"` : ""}>
        <dt>${escapeHtml(label)}${description ? ` <span class="node-metric-info" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">i</span>` : ""}${extraHtml || ""}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `)
    .join("");
  return details ? `
    <section class="node-popup-details${className ? ` ${className}` : ""}">
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

function clearSelectedLayers() {
  selectedRouteLayer.clearLayers();
  clearTimeout(state.selectedRouteTimeout);
  state.selectedRouteHashBytes = 0;
  state.selectedRouteId = null;
  state.selectedRoutePacketType = null;
  state.selectedRouteTimeout = null;
}

function exitPacketFocus() {
  if (!state.packetFocus) return;
  state.packetFocus = null;
  clearSelectedLayers();
  applyRouteVisibility();
  elements.packetFocusBar.hidden = true;
  syncRoutePresentation();
}

function clearSelectedRoute() {
  if (state.packetFocus) {
    exitPacketFocus();
    return;
  }
  clearSelectedLayers();
}

function showRouteOnMap(route) {
  if (state.packetFocus) exitPacketFocus();
  else clearSelectedLayers();
  state.selectedRouteId = route.id;
  state.selectedRouteHashBytes = route.hashBytes;
  state.selectedRoutePacketType = route.packetType;
  const latLngs = route.points.map((point) => [point.lat, point.lon]);
  const segments = routeSegments(route.points);
  for (const segment of segments) {
    const line = L.polyline(segment, {
      renderer: routeRenderer,
      color: route.color,
      interactive: true,
      lineCap: "round",
      lineJoin: "round",
      opacity: 0.95,
      weight: 5,
    }).addTo(selectedRouteLayer);
    line.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      openRouteDetail(route, event.latlng);
    });
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
  state.selectedRouteTimeout = setTimeout(clearSelectedRoute, state.retentionMs);
}

function routeDetailHtml(route) {
  const points = route.points || [];
  const analyzerUrl = analyzerPacketUrl(route.packetHash);
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
    const hopSnr = index > 0 ? route.snrValues?.[index - 1] : null;
    const detail = [distance, Number.isFinite(hopSnr) ? `SNR ${formatDecimal(hopSnr, 1)} dB` : null]
      .filter(Boolean).map((value) => escapeHtml(value)).join(" · ");
    return `<li><i>${index + 1}</i><span>${escapeHtml(point.name || t("common.unknownShort"))}</span><small>${detail}</small></li>`;
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
  const anomalies = routeAnomalies(route);
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
        ${anomalies.length ? `<small class="route-anomaly-line">⚠ ${anomalies.map((value) => escapeHtml(value)).join(" · ")}</small>` : ""}
      </div>
      <h4>${t("route.steps")}</h4>
      <ol class="route-hop-list">${rows}</ol>
      <div class="route-popup-actions">
        <button class="route-show-on-map" type="button">${t("route.showOnMap")}</button>
        ${analyzerUrl ? `<a class="packet-analyzer-link" href="${analyzerUrl}" target="_blank" rel="noreferrer">${t("packet.openAnalyzer")}</a>` : ""}
        <button class="route-popup-close popup-close-button" type="button">${t("common.close")}</button>
      </div>
    </section>
  `;
}

function packetObserverLabel(route) {
  if (route.observerName) return route.observerName;
  if (route.observerId) return route.observerId.slice(0, 8);
  return t("packet.unknownObserver");
}

function analyzerPacketUrl(hash) {
  const value = String(hash || "").trim().toLowerCase();
  return /^[0-9a-f]{8,64}$/.test(value) ? `https://analyzer.meshcore.cz/#/packets/${value}` : null;
}

function packetDetailHtml(occurrences) {
  const first = occurrences[0];
  const hash = first.packetHash || String(first.id).split(":")[0];
  const analyzerUrl = analyzerPacketUrl(hash);
  const observers = new Set(occurrences.map((route) => route.observerId || route.id));
  const rows = occurrences.map((route, index) => {
    const snr = Number.isFinite(route.snr) ? `SNR ${formatDecimal(route.snr, 1)} dB` : null;
    const hopSnr = Number(route.packetType) === 9
      ? t(route.snrValues?.length ? "packet.hopSnr" : "packet.hopSnrEmpty", {
        values: route.snrValues?.map((value) => formatDecimal(value, 1)).join(" / "),
      })
      : null;
    const anomalies = routeAnomalies(route);
    const anomalyBadge = anomalies.length
      ? `<span class="packet-anomaly" title="${escapeHtml(anomalies.join(" · "))}">⚠ ${anomalies.length}</span>`
      : "";
    const meta = [
      formatTime(route.timestamp),
      formatHops(Math.max(1, route.points.length - 1)),
      snr,
    ].filter(Boolean).map((value) => escapeHtml(value)).join(" · ");
    return `
      <li>
        <button class="packet-occurrence" data-index="${index}" type="button">
          <span class="packet-observer">${escapeHtml(packetObserverLabel(route))}${anomalyBadge}</span>
          <small>${meta}</small>
          ${hopSnr ? `<small class="packet-hop-snr">${escapeHtml(hopSnr)}</small>` : ""}
          <small class="packet-path">${escapeHtml(route.from)} → ${escapeHtml(route.to)}</small>
        </button>
        <button class="packet-occurrence-detail" data-index="${index}" type="button" title="${escapeHtml(t("packet.showRoute"))}" aria-label="${escapeHtml(t("packet.showRoute"))}">↗</button>
      </li>
    `;
  }).join("");
  return `
    <section class="route-popup-card packet-popup-card">
      <header>
        <div><small>${t("packet.title")}</small><h3>${escapeHtml(first.typeLabel)} · ${first.hashBytes}B</h3></div>
        <time>${escapeHtml(formatDateTime(first.timestamp))}</time>
      </header>
      <div class="route-popup-summary">
        <code class="packet-hash" title="${escapeHtml(hash)}">${escapeHtml(hash.slice(0, 20))}${hash.length > 20 ? "…" : ""}</code>
        <small>${tCount("packet.occurrences", occurrences.length)} · ${tCount("units.observers", observers.size)}</small>
      </div>
      <div class="route-popup-actions packet-actions-top">
        <button class="route-show-on-map packet-show-all" type="button">${t("packet.showAll")}</button>
        ${analyzerUrl ? `<a class="packet-analyzer-link" href="${analyzerUrl}" target="_blank" rel="noreferrer">${t("packet.openAnalyzer")}</a>` : ""}
        <button class="packet-popup-close popup-close-button" type="button">${t("common.close")}</button>
      </div>
      <h4>${t("packet.observations")}</h4>
      <ol class="packet-occurrence-list">${rows}</ol>
    </section>
  `;
}

function bindPacketActions(root, occurrences, close) {
  for (const button of root.querySelectorAll(".packet-occurrence")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const route = occurrences[Number(button.dataset.index)];
      if (!route) return;
      close();
      setTimeout(() => openRouteDetail(route, route.bounds?.isValid() ? route.bounds.getCenter() : null), 0);
    });
  }
  for (const button of root.querySelectorAll(".packet-occurrence-detail")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const route = occurrences[Number(button.dataset.index)];
      if (!route) return;
      close();
      showPacketOnMap([route]);
    });
  }
  root.querySelector(".packet-show-all")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
    showPacketOnMap(occurrences);
  });
  root.querySelector(".packet-popup-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });
}

function observerPosition(observer) {
  const node = state.nodeByKey.get(String(observer.id || "").toUpperCase());
  if (node && validCoords(node.lat, node.lon)) {
    return { lat: node.lat, lon: node.lon, approx: false };
  }
  const anchor = observerAnchor(observer.iata);
  return anchor ? { ...anchor, approx: true } : null;
}

function observerHealth(observer) {
  const last = Date.parse(observer.last_seen || "");
  if (!Number.isFinite(last)) return "offline";
  const age = Date.now() - last;
  if (age <= 15 * 60 * 1000) return "online";
  if (age <= 24 * 60 * 60 * 1000) return "stale";
  return "offline";
}

function observerHealthColor(health) {
  if (health === "online") return "#2e9b63";
  if (health === "stale") return "#d18a1f";
  return "#8a8f8c";
}

function observerDetailRows(observer) {
  const uptime = Number(observer.uptime_secs);
  const uptimeText = Number.isFinite(uptime)
    ? `${Math.floor(uptime / 86400)} d ${Math.floor((uptime % 86400) / 3600)} h`
    : "—";
  return [
    [t("observers.lastSeen"), observer.last_seen ? formatDateTime(observer.last_seen) : "—"],
    [t("observers.packets"), Number.isFinite(Number(observer.packet_count)) ? formatNumber(Number(observer.packet_count)) : "—"],
    [t("observers.packetsHour"), Number.isFinite(Number(observer.packetsLastHour)) ? formatNumber(Number(observer.packetsLastHour)) : "—"],
    [t("observers.noise"), Number.isFinite(Number(observer.noise_floor)) ? `${formatDecimal(Number(observer.noise_floor), 0)} dBm` : "—"],
    [t("observers.battery"), Number.isFinite(Number(observer.battery_mv)) ? `${formatNumber(Number(observer.battery_mv))} mV` : "—"],
    [t("observers.uptime"), uptimeText],
    [t("observers.clock"), Number.isFinite(Number(observer.clock_skew_seconds)) ? `${formatDecimal(Number(observer.clock_skew_seconds), 0)} s` : "—"],
    [t("observers.model"), observer.model || "—"],
    [t("observers.firmware"), observer.firmware || "—"],
  ];
}

function observerPopupHtml(observer, position) {
  const rows = observerDetailRows(observer);
  return `
    <section class="observer-popup-card">
      <header>
        <h3>${escapeHtml(observer.name || t("packet.unknownObserver"))}</h3>
        <small>${escapeHtml(observer.iata || "")} · ${t(position.approx ? "observers.approx" : "observers.exact")}</small>
      </header>
      <dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd>`).join("")}</dl>
    </section>
  `;
}

function observerClusterPopupHtml(observers, position) {
  const rows = observers.map((observer) => {
    const health = observerHealth(observer);
    const packets = Number.isFinite(Number(observer.packetsLastHour)) ? formatNumber(Number(observer.packetsLastHour)) : "—";
    const detail = observerDetailRows(observer)
      .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd>`)
      .join("");
    return `
      <li>
        <details>
          <summary>
            <b><i class="observer-dot ${health}"></i>${escapeHtml(observer.name || t("packet.unknownObserver"))}</b>
            <small>${escapeHtml(t(`network.${health}`))} · ${packets} pkt/h</small>
          </summary>
          <dl class="observer-detail-dl">${detail}</dl>
        </details>
      </li>
    `;
  }).join("");
  const title = position.approx
    ? `≈ ${escapeHtml(observers[0].iata || "")} · ${tCount("units.observers", observers.length)}`
    : tCount("units.observers", observers.length);
  return `
    <section class="observer-popup-card observer-cluster-card">
      <header>
        <h3>${title}</h3>
        <small>${t(position.approx ? "observers.approx" : "observers.exact")}</small>
      </header>
      <ul class="observer-cluster-list">${rows}</ul>
    </section>
  `;
}

function renderObservers() {
  observerLayer.clearLayers();
  const groups = new Map();
  for (const observer of state.observers) {
    const position = observerPosition(observer);
    if (!position) continue;
    const key = `${position.lat.toFixed(5)},${position.lon.toFixed(5)}`;
    const group = groups.get(key);
    if (group) {
      group.observers.push(observer);
      group.position = { ...group.position, approx: group.position.approx && position.approx };
    } else {
      groups.set(key, { observers: [observer], position });
    }
  }
  for (const { observers, position } of groups.values()) {
    if (position.approx) {
      L.circle([position.lat, position.lon], {
        radius: 25000,
        color: "#b07a2a",
        weight: 1,
        opacity: 0.5,
        dashArray: "4 7",
        fillColor: "#d18a1f",
        fillOpacity: 0.07,
        interactive: false,
      }).addTo(observerLayer);
    }
    if (observers.length > 1) {
      const clusterMarker = L.marker([position.lat, position.lon], {
        icon: L.divIcon({
          className: `observer-cluster-icon${position.approx ? "" : " exact"}`,
          html: `<span>${observers.length}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        interactive: true,
        keyboard: true,
        pane: "markerPane",
      })
        .bindTooltip(`${position.approx ? `≈ ${observers[0].iata} · ` : ""}${tCount("units.observers", observers.length)}`, {
          className: "node-tooltip",
          direction: "top",
        })
        .bindPopup(observerClusterPopupHtml(observers, position), {
          className: "observer-popup",
          maxWidth: 330,
          minWidth: 260,
          autoPan: true,
        })
        .on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          clusterMarker.openPopup();
        })
        .on("popupopen", (event) => {
          const root = event.popup.getElement();
          if (root) {
            L.DomEvent.disableClickPropagation(root);
            L.DomEvent.disableScrollPropagation(root);
          }
        })
        .addTo(observerLayer);
      continue;
    }
    const observer = observers[0];
    const health = observerHealth(observer);
    L.circleMarker([position.lat, position.lon], {
      radius: 5,
      color: observerHealthColor(health),
      weight: 2,
      dashArray: position.approx ? "3 3" : null,
      fillColor: position.approx ? "#fff1d9" : "#ffffff",
      fillOpacity: 0.95,
      pane: "markerPane",
    })
      .bindTooltip(`${position.approx ? "≈ " : ""}${observer.name || t("packet.unknownObserver")}`, {
        className: "node-tooltip",
        direction: "top",
      })
      .bindPopup(observerPopupHtml(observer, position), {
        className: "observer-popup",
        maxWidth: 300,
        minWidth: 220,
        autoPan: true,
      })
      .addTo(observerLayer);
  }
}

async function loadObservers(force = false) {
  if (state.observersLoading) return;
  if (!force && state.observersLoadedAt && Date.now() - state.observersLoadedAt < OBSERVER_REFRESH_MS) return;
  state.observersLoading = true;
  try {
    const data = await getJson("/api/observers");
    state.observers = Array.isArray(data.observers) ? data.observers : [];
    state.observerByKey = new Map();
    for (const observer of state.observers) {
      const key = String(observer.id || "").toUpperCase();
      if (key) state.observerByKey.set(key, observer);
    }
    state.observersLoadedAt = Date.now();
    if (state.showObservers) renderObservers();
    statsPanel.renderNetworkSummary();
    if (state.nodeMarkers.length) refreshNodeState();
  } catch (error) {
    console.error("Observery se nepodařilo načíst", error);
  } finally {
    state.observersLoading = false;
  }
}

async function setObserversVisible(on) {
  state.showObservers = Boolean(on);
  elements.observersToggle.checked = state.showObservers;
  if (!state.showObservers) {
    map.removeLayer(observerLayer);
    return;
  }
  observerLayer.addTo(map);
  await loadObservers();
  renderObservers();
}

function showPacketFocusBar(hash, count) {
  if (state.neighborFocusKey) clearNeighborFocus();
  elements.packetFocusHash.textContent = `${hash.slice(0, 12)}${hash.length > 12 ? "…" : ""}`;
  elements.packetFocusHash.title = hash;
  elements.packetFocusCount.textContent = `${tCount("packet.focusRoutes", count)} · ${t("packet.focusLiveHidden")}`;
  const analyzerUrl = analyzerPacketUrl(hash);
  elements.packetFocusAnalyzer.hidden = !analyzerUrl;
  if (analyzerUrl) elements.packetFocusAnalyzer.href = analyzerUrl;
  elements.packetFocusBar.hidden = false;
}

function showPacketOnMap(occurrences) {
  const newest = occurrences[0];
  const hash = newest?.packetHash || String(newest?.id || "").split(":")[0];
  clearSelectedLayers();
  if (map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
  state.packetFocus = { hash, count: occurrences.length };
  state.selectedRouteId = newest?.id || null;
  state.selectedRouteHashBytes = newest?.hashBytes || 0;
  state.selectedRoutePacketType = newest?.packetType ?? null;
  const bounds = L.latLngBounds([]);
  for (const route of [...occurrences].reverse()) {
    const highlighted = route === newest;
    const openPacket = (event) => {
      L.DomEvent.stopPropagation(event);
      openPacketDetail(route, event.latlng);
    };
    for (const segment of routeSegments(route.points)) {
      const line = L.polyline(segment, {
        renderer: routeRenderer,
        color: route.color,
        interactive: true,
        lineCap: "round",
        lineJoin: "round",
        opacity: highlighted ? 0.9 : 0.45,
        weight: highlighted ? 5 : 3,
      }).addTo(selectedRouteLayer);
      line.on("click", openPacket);
    }
    const endpoint = route.points.at(-1);
    if (endpoint) {
      const marker = L.circleMarker([endpoint.lat, endpoint.lon], {
        radius: highlighted ? 5 : 4,
        color: route.color,
        weight: 2,
        fillColor: "#ffffff",
        fillOpacity: 0.95,
      })
        .bindTooltip(`${escapeHtml(packetObserverLabel(route))} · ${escapeHtml(formatTime(route.timestamp))}`, {
          className: "node-tooltip",
          direction: "top",
        })
        .addTo(selectedRouteLayer);
      marker.on("click", openPacket);
    }
    for (const point of route.points) bounds.extend([point.lat, point.lon]);
  }
  if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 11, padding: [40, 40] });
  map.closePopup();
  showPacketFocusBar(hash, occurrences.length);
}

function mergePacketOccurrences(primary, extra) {
  const byRouteId = new Map();
  for (const route of [...primary, ...extra]) {
    if (!route || !isRouteVisible(route.packetType, route.hashBytes, state)) continue;
    const previous = byRouteId.get(route.id);
    if (!previous || route.timestamp > previous.timestamp) byRouteId.set(route.id, route);
  }
  return [...byRouteId.values()].sort((a, b) => b.timestamp - a.timestamp);
}

async function openPacketByHash(hash, { showOnMap = false } = {}) {
  try {
    const data = await getJson(`/api/packet-routes?hash=${encodeURIComponent(hash)}`);
    const routes = await historyRoutesFromPackets(data.packets || []);
    if (routes.length) {
      if (showOnMap) showPacketOnMap(routes);
      await openPacketDetail(routes[0]);
    }
  } catch (error) {
    console.error("Paket se nepodařilo otevřít", error);
  }
}

async function openPacketDetail(route, latlng = null) {
  if (!route) return;
  const hash = route.packetHash || String(route.id || "").split(":")[0];
  let occurrences = Array.isArray(route.traceRoutes) && route.traceRoutes.length
    ? [...route.traceRoutes]
    : routeStore.packetOccurrences(hash, state, nowMs());
  if (!occurrences.length) occurrences = [route];
  try {
    const data = await getJson(`/api/packet-routes?hash=${encodeURIComponent(hash)}`);
    occurrences = mergePacketOccurrences(occurrences, await historyRoutesFromPackets(data.packets || []));
  } catch (error) {
    console.error("Výskyty paketu se nepodařilo načíst", error);
  }
  if (!occurrences.length) occurrences = [route];
  if (isMobileSheet()) {
    showMobileSheet(packetDetailHtml(occurrences));
    bindPacketActions(elements.mobileSheetContent, occurrences, closeMobileSheet);
    return;
  }
  const content = document.createElement("div");
  content.className = "packet-popup-content";
  content.innerHTML = packetDetailHtml(occurrences);
  const popup = L.popup({
    className: "route-popup packet-popup",
    maxWidth: 460,
    minWidth: 320,
    autoPan: false,
  }).setLatLng(detailPopupAnchor()).setContent(content).openOn(map);
  L.DomEvent.disableClickPropagation(content);
  L.DomEvent.disableScrollPropagation(content);
  bindPacketActions(content, occurrences, () => popup.close());
}

function closeMobileSheet() {
  if (elements.mobileSheet.open) elements.mobileSheet.close();
  elements.mobileSheetContent.replaceChildren();
}

function showMobileSheet(html) {
  map.closePopup();
  elements.mobileSheetContent.innerHTML = html;
  if (!elements.mobileSheet.open) elements.mobileSheet.showModal();
}

function openNodeEntry(entry) {
  if (!isMobileSheet()) {
    entry.marker.openPopup();
    return;
  }
  showMobileSheet(nodePopup(entry.node, nodeIsActive(entry.node, nowMs(), NODE_ACTIVE_MS)));
  setupNodePopup({ getElement: () => elements.mobileSheetContent }, entry.node);
}

function openRouteSheet(route) {
  showMobileSheet(routeDetailHtml(route));
  elements.mobileSheetContent.querySelector(".route-popup-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMobileSheet();
  });
  elements.mobileSheetContent.querySelector(".route-show-on-map")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMobileSheet();
    showRouteOnMap(route);
  });
}

function isMobileSheet() {
  return FORCE_MOBILE_SHEET || mobileSheetQuery.matches;
}

function popupPanPadding() {
  const hud = document.querySelector("#hud");
  const rect = hud?.getBoundingClientRect();
  const collapsed = hud?.classList.contains("collapsed");
  const left = rect && rect.width > 0 && !collapsed
    ? Math.min(window.innerWidth * 0.42, rect.right + 16)
    : 24;
  return {
    topLeft: L.point(left, 24),
    bottomRight: L.point(24, 24),
  };
}

function detailPopupAnchor() {
  const size = map.getSize();
  const hud = document.querySelector("#hud");
  const rect = hud?.getBoundingClientRect();
  const collapsed = hud?.classList.contains("collapsed");
  const left = rect && rect.width > 0 && !collapsed
    ? Math.min(rect.right + 12, size.x * 0.5)
    : 12;
  return map.containerPointToLatLng(L.point(left + (size.x - left) / 2, size.y - 24));
}

function openRouteDetail(route, latlng = null) {
  if (!route?.points?.length) return;
  if (isMobileSheet()) {
    openRouteSheet(route);
    return;
  }
  const content = document.createElement("div");
  content.className = "route-popup-content";
  content.innerHTML = routeDetailHtml(route);
  const anchor = latlng || (route.bounds?.isValid() ? route.bounds.getCenter() : L.latLng(route.points[0].lat, route.points[0].lon));
  const padding = popupPanPadding();
  const popup = L.popup({
    className: "route-popup",
    maxWidth: 420,
    minWidth: 300,
    autoPan: true,
    autoPanPaddingTopLeft: padding.topLeft,
    autoPanPaddingBottomRight: padding.bottomRight,
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
  content.querySelector(".route-popup-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    popup.close();
  });
}

map.on("click", () => {
  if (!state.packetFocus) clearSelectedRoute();
  if (state.neighborFocusKey) clearNeighborFocus();
  if (state.archiveNodeFilterKey) clearArchiveNodeFilter();
});
map.on("click", (event) => {
  if (state.coverageMode) void handleCoverageClick(event.latlng);
  else if (state.losMode) void handleLosClick(event.latlng);
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
    openNodeEntry(entry);
  });
}

function setupNodePopup(popup, node) {
  const root = popup.getElement();
  if (!root) return;
  const qrButton = root.querySelector(".node-qr-toggle");
  const routeButton = root.querySelector(".node-route-show");
  const copyButton = root.querySelector(".node-key-copy");
  const linkButton = root.querySelector(".node-link-copy");

  void loadNodeInfo(root, node);
  void loadCommentCount(root, node);
  root.querySelector(".node-user-info-edit")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openNodeInfoDialog(node);
  });
  root.querySelector(".node-comments-open")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openCommentsDialog(node);
  });
  root.querySelector(".node-detail-open")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openNodeDetail(node);
  });
  bindArchiveFilterButton(root.querySelector(".node-archive-filter"), node);
  for (const button of root.querySelectorAll(".node-detail-tab-button")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openNodeDetail(node, button.dataset.nodeDetailTab || "overview");
    });
  }

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
  root.querySelector(".node-photo-add")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    photoUpload.open(node);
  });
  root.querySelector(".node-popup-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isMobileSheet()) closeMobileSheet();
    else popup.close();
  });

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

  for (const button of root.querySelectorAll(".node-health-windows button")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void loadNodeHealthHistory(root, node, Number(button.dataset.healthDays) || 1);
    });
  }
  void loadNodeHistory(root, node);
  void loadNodeHealthHistory(root, node);
  void loadNodePhotos(root, node);
  void loadNodeAnalytics(root, node);
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
    .map(([neighborKey, info]) => {
      const neighborNode = state.nodeByKey.get(neighborKey);
      const role = neighborNode?.role || null;
      const distanceKm = neighborNode
        && validCoords(node.lat, node.lon)
        && validCoords(neighborNode.lat, neighborNode.lon)
        ? haversineKm(node, neighborNode)
        : null;
      const meta = [
        role ? roleLabel(role) : "",
        distanceKm == null ? "" : `${formatDecimal(distanceKm, 1)} km`,
        info.lastAt ? t("node.neighborLastSeen", { time: formatNodeDate(info.lastAt) }) : "",
      ].filter(Boolean).join(" · ");
      return `
        <li>
          <button class="node-neighbor" type="button" data-neighbor-key="${escapeHtml(neighborKey)}">
            <span class="node-neighbor-main">
              <b>${escapeHtml(info.name || neighborKey.slice(0, 8))}</b>
              ${meta ? `<em>${escapeHtml(meta)}</em>` : ""}
            </span>
            <small>${info.count}×</small>
          </button>
        </li>
      `;
    })
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
      <button class="node-neighbors-map" type="button" data-node-key="${escapeHtml(key)}">${t("node.showNeighborsMap")}</button>
    </div>
  `;
}

function nodePhotos(node) {
  if (!/^[0-9a-f]{64}$/i.test(node.public_key || "")) return "";
  return `
    <div class="node-photos" data-node-key="${escapeHtml(node.public_key.toLowerCase())}">
      <div class="node-photos-head">
        <span>${t("photos.title")} <b class="node-photos-count">…</b></span>
        <button class="node-photo-add" type="button">${t("photos.add")}</button>
      </div>
      <div class="node-photos-list"><p class="node-photos-empty">${t("photos.loading")}</p></div>
    </div>
  `;
}

function nodeBasicDetails(node) {
  const lastActivity = nodeActivityAt(node);
  const hashSize = (() => {
    const maxBytes = Number(node.multi_byte_max_hash_size) || 0;
    const baseBytes = Number(node.hash_size) || 0;
    return Math.max(maxBytes, baseBytes) || null;
  })();
  const prefix = hashSize && node.public_key
    ? node.public_key.slice(0, hashSize * 2).toUpperCase()
    : null;
  const region = node.region_placement || {};
  const regionNames = Array.isArray(region.regions) ? region.regions.join(", ") : "";
  const regionBasis = region.basis ? t(`node.regionBasis.${region.basis}`) : "";
  const regionText = [regionNames, regionBasis].filter(Boolean).join(" · ") || null;
  return renderNodeDetails(t("node.basicDetails"), [
    [t("node.lastActivity"), formatNodeDate(lastActivity), t("node.lastActivityHelp")],
    [t("node.lastAdvert"), formatNodeDate(node.last_seen || node.last_heard)],
    [t("node.firstSeen"), node.first_seen ? formatNodeDate(node.first_seen) : null, t("node.firstSeenHelp")],
    [t("node.coordinates"), validCoords(node.lat, node.lon) ? `${Number(node.lat).toFixed(6)}, ${Number(node.lon).toFixed(6)}` : t("node.noLocation")],
    [t("node.region"), regionText, t("node.regionHelp")],
    [t("node.prefix"), prefix, t("node.prefixHelp")],
    [t("node.hashMode"), hashSize ? (hashSize >= 2 ? "2B+" : "1B") : null, t("node.hashModeHelp")],
    [t("node.inconsistentHash"), node.hash_size_inconsistent ? t("common.yes") : null, t("node.inconsistentHashHelp")],
  ]);
}

function nodeUserInfo(node) {
  if (!/^[0-9a-f]{64}$/i.test(node.public_key || "")) return "";
  return `
    <section class="node-user-info" data-node-key="${escapeHtml(node.public_key.toLowerCase())}">
      <div class="node-user-info-head">
        <span>${t("nodeInfo.title")}</span>
        <button class="node-user-info-edit" type="button">${t("nodeInfo.edit")}</button>
      </div>
      <div class="node-user-info-body"><p class="node-user-info-empty">${t("nodeInfo.loading")}</p></div>
    </section>
  `;
}

function nodeComments(node, withList = false) {
  if (!/^[0-9a-f]{64}$/i.test(node.public_key || "")) return "";
  return `
    <section class="node-comments" data-node-key="${escapeHtml(node.public_key.toLowerCase())}">
      <div class="node-comments-head">
        <span>${t("comments.titleShort")} <b class="node-comments-count" title="">…</b></span>
        <button class="node-comments-open" type="button">${t("comments.open")}</button>
      </div>
      ${withList ? '<ol class="comments-list node-detail-comments-list" data-detail-comments></ol>' : ""}
    </section>
  `;
}

function renderNodeInfoPreview(root, info) {
  const preview = root.querySelector(".node-compact-info-text");
  if (!preview) return;
  const text = String(info?.text || "").replace(/\s+/g, " ").trim();
  preview.textContent = text
    ? (text.length > 190 ? `${text.slice(0, 190).replace(/\s+\S*$/, "")}…` : text)
    : t("nodeInfo.compactEmpty");
}

function renderNodeInfoSection(root, info) {
  const body = root.querySelector(".node-user-info-body");
  if (!body) return;
  body.replaceChildren();
  if (!info?.text) {
    const empty = document.createElement("p");
    empty.className = "node-user-info-empty";
    empty.textContent = t("nodeInfo.empty");
    body.appendChild(empty);
    return;
  }
  const fullText = String(info.text);
  const lines = fullText.split("\n");
  const hasMore = lines.length > 5;
  const collapseTo = () => `${lines.slice(0, 5).join("\n")}\n…`;
  const text = document.createElement("p");
  text.className = "node-user-info-text";
  text.textContent = hasMore ? collapseTo() : fullText;
  body.appendChild(text);
  let expanded = false;
  const toggleButton = hasMore ? document.createElement("button") : null;
  if (toggleButton) {
    toggleButton.type = "button";
    toggleButton.className = "node-user-info-toggle";
    toggleButton.textContent = t("nodeInfo.showAll");
    toggleButton.addEventListener("click", () => {
      expanded = !expanded;
      text.textContent = expanded ? fullText : collapseTo();
      toggleButton.textContent = expanded ? t("nodeInfo.showLess") : t("nodeInfo.showAll");
    });
    body.appendChild(toggleButton);
  }
  const meta = document.createElement("small");
  meta.className = "node-user-info-meta";
  meta.textContent = [info.author, info.updatedAt ? formatNodeDate(info.updatedAt) : null]
    .filter(Boolean)
    .join(" · ");
  body.appendChild(meta);
  if (info.sourceUrl) {
    const source = document.createElement("a");
    source.className = "node-user-info-source";
    source.href = info.sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = `${t("nodeInfo.source")}: ${info.sourceTitle || "meshcore.cz"}`;
    body.appendChild(source);
  }
}

async function loadNodeInfo(root, node) {
  const key = String(node.public_key || "").toLowerCase();
  const body = root.querySelector(".node-user-info-body");
  const preview = root.querySelector(".node-compact-info-text");
  if (!/^[0-9a-f]{64}$/.test(key) || (!body && !preview)) return;
  const render = (info) => {
    if (body) renderNodeInfoSection(root, info);
    renderNodeInfoPreview(root, info);
  };
  const cached = state.nodeInfoCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) {
    render(cached.info);
    return;
  }
  try {
    const data = await getJson(`/api/node-info?key=${encodeURIComponent(key)}`);
    const info = data.info || null;
    state.nodeInfoCache.set(key, { at: Date.now(), info });
    if (!root.isConnected) return;
    render(info);
  } catch (error) {
    console.error("Uživatelské info nodu se nepodařilo načíst", error);
    if (!root.isConnected) return;
    if (body) body.textContent = t("nodeInfo.failed");
    if (preview) preview.textContent = t("nodeInfo.failed");
  }
}

function setNodeInfoStatus(text, isError = false) {
  elements.nodeInfoStatus.textContent = text;
  elements.nodeInfoStatus.classList.toggle("error", Boolean(isError));
}

function renderNodeInfoDialog() {
  elements.nodeInfoTitle.textContent = t("nodeInfo.dialogTitle");
  elements.nodeInfoClose.setAttribute("aria-label", t("nodeInfo.cancel"));
  elements.nodeInfoTextLabel.textContent = t("nodeInfo.textLabel");
  elements.nodeInfoText.placeholder = t("nodeInfo.textPlaceholder");
  const currentInfo = state.nodeInfoTarget ? state.nodeInfoCache.get(state.nodeInfoTarget.key)?.info : null;
  const hasCurrent = Boolean(currentInfo?.text);
  const protectedInfo = Boolean(currentInfo?.protected);
  elements.nodeInfoPassword.required = false;
  elements.nodeInfoPasswordLabel.textContent = protectedInfo
    ? t("nodeInfo.passwordLabelEdit")
    : t("nodeInfo.passwordLabelOptional");
  elements.nodeInfoPassword.placeholder = protectedInfo
    ? t("nodeInfo.passwordPlaceholderEdit")
    : t("nodeInfo.passwordPlaceholderOptional");
  elements.nodeInfoPassword.autocomplete = protectedInfo ? "current-password" : "new-password";
  elements.nodeInfoAuthorLabel.textContent = t("nodeInfo.authorLabel");
  elements.nodeInfoAuthor.placeholder = t("nodeInfo.authorPlaceholder");
  elements.nodeInfoNote.textContent = protectedInfo
    ? t("nodeInfo.noteEdit")
    : (hasCurrent ? t("nodeInfo.noteUnprotected") : t("nodeInfo.noteNew"));
  elements.nodeInfoSubmit.textContent = t("nodeInfo.submit");
  elements.nodeInfoCancel.textContent = t("nodeInfo.cancel");
  const target = state.nodeInfoTarget;
  elements.nodeInfoNode.textContent = target
    ? `${target.name || t("common.unknownNode")} · ${target.key.slice(0, 8).toUpperCase()}`
    : "";
}

async function openNodeInfoDialog(node) {
  const key = String(node.public_key || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return;
  state.nodeInfoTarget = { key, name: node.name || t("common.unknownNode") };
  const cached = state.nodeInfoCache.get(key);
  elements.nodeInfoForm.reset();
  setNodeInfoStatus("");
  elements.nodeInfoText.value = cached?.info?.text || "";
  elements.nodeInfoAuthor.value = cached?.info?.author || "";
  elements.nodeInfoPassword.value = "";
  renderNodeInfoDialog();
  if (!elements.nodeInfoDialog.open) elements.nodeInfoDialog.showModal();
  void loadNodeInfoConfig().then(() => {
    if (state.nodeInfoTarget?.key === key && elements.nodeInfoDialog.open) renderNodeInfoDialog();
  });
  if (!cached) {
    try {
      const data = await getJson(`/api/node-info?key=${encodeURIComponent(key)}`);
      if (state.nodeInfoTarget?.key !== key) return;
      state.nodeInfoCache.set(key, { at: Date.now(), info: data.info || null });
      elements.nodeInfoText.value = data.info?.text || "";
      elements.nodeInfoAuthor.value = data.info?.author || "";
      renderNodeInfoDialog();
    } catch (error) {
      console.error("Uživatelské info nodu se nepodařilo načíst", error);
    }
  }
}

function clearNeighborFocus() {
  neighborLayer.clearLayers();
  if (map.hasLayer(neighborLayer)) map.removeLayer(neighborLayer);
  state.neighborFocusKey = null;
  elements.neighborFocusBar.hidden = true;
}

function showNodeNeighborsOnMap(node) {
  const key = String(node.public_key || "").toUpperCase();
  if (!key || !validCoords(node.lat, node.lon)) return;
  const neighbors = state.neighborByNode.get(key);
  if (!neighbors?.size) return;
  const entries = [];
  for (const [neighborKey, info] of neighbors) {
    const neighbor = state.nodeByKey.get(neighborKey);
    if (!neighbor || !validCoords(neighbor.lat, neighbor.lon)) continue;
    entries.push({ info, key: neighborKey, neighbor });
  }
  if (!entries.length) return;
  clearNeighborFocus();
  if (state.packetFocus) exitPacketFocus();
  const maxCount = Math.max(1, ...entries.map(({ info }) => Number(info.count) || 1));
  const bounds = L.latLngBounds(L.latLng(node.lat, node.lon));
  let connections = 0;
  for (const { info, key: neighborKey, neighbor } of entries) {
    const count = Number(info.count) || 0;
    connections += count;
    const line = L.polyline([[node.lat, node.lon], [neighbor.lat, neighbor.lon]], {
      className: "neighbor-link",
      color: "#078e62",
      opacity: 0.6,
      weight: 1.5 + 4 * Math.sqrt(count / maxCount),
    }).addTo(neighborLayer);
    line.bindTooltip(`${escapeHtml(neighbor.name || t("common.unknownShort"))} · ${count}×`, {
      className: "node-tooltip",
      sticky: true,
    });
    line.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      const entry = state.nodeMarkerByKey.get(neighborKey);
      if (entry) {
        revealNodeMarker(entry);
        openNodeEntry(entry);
      }
    });
    L.marker(
      [node.lat + (neighbor.lat - node.lat) * 0.55, node.lon + (neighbor.lon - node.lon) * 0.55],
      {
        icon: L.divIcon({ className: "neighbor-count", html: `${count}×`, iconSize: [34, 18], iconAnchor: [17, 9] }),
        interactive: false,
        keyboard: false,
      },
    ).addTo(neighborLayer);
    bounds.extend([neighbor.lat, neighbor.lon]);
  }
  neighborLayer.addTo(map);
  map.fitBounds(bounds, { maxZoom: 11, padding: [40, 40] });
  state.neighborFocusKey = key;
  elements.neighborFocusTitle.textContent = t("node.neighborsTitle");
  elements.neighborFocusName.textContent = node.name || t("common.unknownNode");
  elements.neighborFocusCount.textContent = `${tCount("units.neighbors", entries.length)} · ${tCount("units.links", connections)}`;
  elements.neighborFocusClose.textContent = t("node.hideNeighbors");
  elements.neighborFocusBar.hidden = false;
}

function nodeAnalytics(node) {
  if (!/^[0-9a-f]{64}$/i.test(node.public_key || "")) return "";
  return `
    <section class="node-analytics" data-node-key="${escapeHtml(node.public_key.toLowerCase())}">
      <div class="node-analytics-head">
        <h4>${t("analytics.title")}</h4>
        <small>${t("analytics.loading")}</small>
      </div>
      <div class="node-analytics-body"></div>
    </section>
  `;
}

function archiveFilterButtonHtml(node) {
  const key = String(node.public_key || "").toUpperCase();
  if (!state.routeWindowMs || !key) return "";
  const count = archiveRouteCountForNode(key);
  const active = state.archiveNodeFilterKey === key;
  if (!count && !active && state.archiveRoutes.size) return "";
  return `<button class="node-archive-filter${active ? " active" : ""}" type="button">${active ? t("archive.clearFilter") : t("archive.showNodeRoutes")}</button>`;
}

function nodeActionButtons(node, { close = false } = {}) {
  if (!node.public_key) return "";
  return `
    <div class="node-popup-actions">
      <button class="node-link-copy" type="button">${t("node.copyLink")}</button>
      ${archiveFilterButtonHtml(node)}
      ${/^[0-9a-f]{64}$/i.test(node.public_key) ? `<button class="node-qr-toggle" type="button">${t("node.showQr")}</button>` : ""}
      ${/^[0-9a-f]{64}$/i.test(node.public_key) ? `<a class="node-analyzer-link" href="https://analyzer.meshcore.cz/#/nodes/${encodeURIComponent(node.public_key.toLowerCase())}" target="_blank" rel="noreferrer">${t("node.openAnalyzer")}</a>` : ""}
      ${close ? `<button class="node-popup-close popup-close-button" type="button">${t("common.close")}</button>` : ""}
    </div>
  `;
}

function bindArchiveFilterButton(button, node) {
  button?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleArchiveNodeFilter(node);
  });
}

function refreshOpenNodePopupActions() {
  for (const entry of state.nodeMarkers) {
    if (!entry.marker.isPopupOpen()) continue;
    const root = entry.marker.getPopup().getElement();
    const actions = root?.querySelector(".node-popup-actions");
    if (!actions) continue;
    const current = actions.querySelector(".node-archive-filter");
    const html = archiveFilterButtonHtml(entry.node);
    if (!html) {
      current?.remove();
      continue;
    }
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const next = holder.firstElementChild;
    if (current) current.replaceWith(next);
    else actions.insertBefore(next, actions.children[1] || null);
    bindArchiveFilterButton(next, entry.node);
  }
}

function nodePopupContent(node, active) {
  const lastActivity = nodeActivityAt(node);
  const rankNodes = [...state.nodeByKey.values()];
  const hashSize = (() => {
    const maxBytes = Number(node.multi_byte_max_hash_size) || 0;
    const baseBytes = Number(node.hash_size) || 0;
    return Math.max(maxBytes, baseBytes) || null;
  })();
  const prefix = hashSize && node.public_key
    ? node.public_key.slice(0, hashSize * 2).toUpperCase()
    : null;
  const region = node.region_placement || {};
  const regionNames = Array.isArray(region.regions) ? region.regions.join(", ") : "";
  const regionBasis = region.basis ? t(`node.regionBasis.${region.basis}`) : "";
  const regionText = [regionNames, regionBasis].filter(Boolean).join(" · ") || null;
  const basicDetails = renderNodeDetails(t("node.basicDetails"), [
    [t("node.lastActivity"), formatNodeDate(lastActivity), t("node.lastActivityHelp")],
    [t("node.lastAdvert"), formatNodeDate(node.last_seen || node.last_heard)],
    [t("node.lastRelay"), formatNodeDate(node.last_relayed)],
    [t("node.firstSeen"), node.first_seen ? formatNodeDate(node.first_seen) : null, t("node.firstSeenHelp")],
    [t("node.coordinates"), validCoords(node.lat, node.lon) ? `${Number(node.lat).toFixed(6)}, ${Number(node.lon).toFixed(6)}` : t("node.noLocation")],
    [t("node.region"), regionText, t("node.regionHelp")],
    [t("node.prefix"), prefix, t("node.prefixHelp")],
    [t("node.hashMode"), hashSize ? (hashSize >= 2 ? "2B+" : "1B") : null, t("node.hashModeHelp")],
    [t("node.inconsistentHash"), node.hash_size_inconsistent ? t("common.yes") : null, t("node.inconsistentHashHelp")],
  ], "", "node-basic-details");
  return `
    <header>
      <div><small>${escapeHtml(roleLabel(node.role))}</small>${nodeNewBadge(node)}<h3>${escapeHtml(node.name || t("common.unknownNode"))}</h3></div>
      <span class="${active ? "active" : "inactive"}">${active ? t("common.active") : t("common.inactive")}</span>
    </header>
    ${nodePhotos(node)}
    ${nodeUserInfo(node)}
    ${nodeComments(node, true)}
    ${basicDetails}
    ${nodeTrafficDetails(node)}
    ${nodeHealthSummary(node)}
    ${nodeHealthConfig(node)}
    ${nodeHealthHistory(node)}
    ${nodeNetworkDetails(node)}
    ${nodeAnalytics(node)}
    ${nodeLastRoute(node)}
    ${nodeNeighbors(node)}
    ${nodeHistory(node)}
    ${node.public_key ? `<div class="node-public-key"><div><span>${t("node.publicKey")}</span><button class="node-key-copy" type="button">${t("common.copy")}</button></div><code>${escapeHtml(node.public_key)}</code></div>` : ""}
    ${nodeActionButtons(node, { close: true })}
  `;
}

function nodeTrendButton(node) {
  if (!node.health) return "";
  const key = String(node.public_key || "").toUpperCase();
  if (!/^[0-9a-f]{64}$/i.test(key)) return "";
  return `<button type="button" class="node-trend-button" data-health-node-key="${escapeHtml(key)}" title="${t("node.showTrend")}" aria-label="${t("node.showTrend")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg></button>`;
}

function nodeTrafficDetails(node, { compact = false } = {}) {
  const rankNodes = [...state.nodeByKey.values()];
  const health = node.health && typeof node.health === "object" ? node.health : null;
  const battery = health?.batteryMv ?? node.battery_mv;
  const temperature = health?.temperatureC ?? node.temperature_c;
  const batteryStatus = nodeHealthStatusText(node);
  const trend = nodeTrendButton(node);
  const advert24h = node.advert_count_24h;
  const advert24hText = advert24h == null
    ? null
    : (Number(advert24h) > 0
      ? countWithRank(advert24h, rankNodes, node, "advert_count_24h")
      : formatNumber(Number(advert24h) || 0));
  const batterySpec = compact ? null : ([
    health?.batteryType ? batteryTypeName(health.batteryType) : null,
    health?.batteryCells ? `${health.batteryCells}S` : null,
    health?.voltageSource ? voltageSourceName(health.voltageSource) : null,
  ].filter(Boolean).join(" · ") || null);
  return renderNodeDetails(t("node.trafficDetails"), [
    [t("node.advertPackets24h"), advert24hText, t("node.advertHelp")],
    [t("node.battery"), battery == null ? null : `${formatDecimal(battery / 1000, 2)} V${batteryStatus ? ` · ${batteryStatus}` : ""}`, t("node.batteryHelp"), "", trend],
    [t("node.batterySpec"), batterySpec, t("node.batterySpecHelp")],
    [t("node.temperature"), temperature == null ? null : `${formatDecimal(temperature, 1)} °C`, null, "", trend],
    [t("node.current"), health?.currentMa != null && Number.isFinite(Number(health.currentMa)) ? `${formatNumber(health.currentMa)} mA` : null],
    [t("node.humidity"), !compact && health?.humidityPct != null && Number.isFinite(Number(health.humidityPct)) ? `${formatNumber(health.humidityPct)} %` : null],
    [t("node.charging"), health ? (health.charging ? t("common.yes") : t("common.no")) : null],
    [t("node.externalPower"), health ? (health.externalPower ? t("common.yes") : t("common.no")) : null],
    [t("node.healthObserved"), health?.observedAt ? formatNodeDate(health.observedAt) : null],
    [t("node.healthSample"), health?.observedAt ? formatDateTimeShort(health.observedAt) : null],
  ], "", "node-traffic-details");
}

// Icons: Tabler Icons (MIT), battery-vertical-1/2/4/off + temperature.
const BATTERY_VERTICAL_BODY = "M7 18v-11a2 2 0 0 1 2 -2h.5a.5 .5 0 0 0 .5 -.5a.5 .5 0 0 1 .5 -.5h3a.5 .5 0 0 1 .5 .5a.5 .5 0 0 0 .5 .5h.5a2 2 0 0 1 2 2v11a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2";
const BATTERY_VERTICAL_BARS = ["M10 17h4", "M10 14h4", "M10 11h4", "M10 8h4"];
const BATTERY_VERTICAL_OFF = '<path d="M3 3l18 18" /><path d="M17 13v-6a2 2 0 0 0 -2 -2h-.5a.5 .5 0 0 1 -.5 -.5a.5 .5 0 0 0 -.5 -.5h-3a.5 .5 0 0 0 -.5 .5a.5 .5 0 0 1 -.5 .5h-.5m-2 2v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-1" />';
const THERMOMETER_ICON = '<svg class="node-health-thermometer" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13.5a4 4 0 1 0 4 0v-8.5a2 2 0 0 0 -4 0v8.5" /><path d="M10 9l4 0" /></svg>';
const HUMIDITY_ICON = '<svg class="node-health-humidity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.7c3.2 4.1 6 7.6 6 11.1a6 6 0 0 1 -12 0c0 -3.5 2.8 -7 6 -11.1z" /></svg>';

function batteryStatusIcon(status) {
  const paths = status === "stale"
    ? BATTERY_VERTICAL_OFF
    : status === "unknown"
      ? `<path d="${BATTERY_VERTICAL_BODY}" />`
      : `<path d="${BATTERY_VERTICAL_BODY}" />${BATTERY_VERTICAL_BARS
        .slice(0, status === "full" || status === "ok" ? 4 : status === "warn" ? 2 : 1)
        .map((path) => `<path d="${path}" />`)
        .join("")}`;
  return `<svg class="node-health-battery" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function nodeCompactPublicKey(node) {
  if (!/^[0-9a-f]{64}$/i.test(node.public_key || "")) return "";
  return `
    <div class="node-compact-key">
      <span>${t("node.publicKey")}</span>
      <code title="${escapeHtml(node.public_key)}">${escapeHtml(node.public_key.slice(0, 10))}…${escapeHtml(node.public_key.slice(-6))}</code>
      <button class="node-key-copy" type="button">${t("common.copy")}</button>
    </div>
  `;
}

function nodeNewBadge(node) {
  return isNewNode(node, nowMs()) ? `<span class="node-new-badge">${t("node.newBadge")}</span>` : "";
}

function nodeHealthBadge(node) {
  const { battery, temperature, humidity } = nodeHealthSnapshot(node);
  if (battery == null && temperature == null && humidity == null) return "";
  const status = nodeHealthStatusCode(node);
  const statusText = nodeHealthStatusText(node);
  const voltageText = battery == null ? null : `${formatDecimal(battery / 1000, 2)} V`;
  const temperatureText = temperature == null ? null : `${formatDecimal(temperature, 1)} °C`;
  const humidityText = humidity == null ? null : `${formatNumber(humidity)} %`;
  const title = [
    voltageText ? `${t("node.battery")}: ${voltageText}` : null,
    statusText,
    temperatureText ? `${t("node.temperature")}: ${temperatureText}` : null,
    humidityText ? `${t("node.humidity")}: ${humidityText}` : null,
    nodeHealthSampleText(node),
  ].filter(Boolean).join(" · ");
  return `<button type="button" class="node-health-badge ${status}" data-health-node-key="${escapeHtml(node.public_key.toUpperCase())}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
    ${battery == null ? "" : batteryStatusIcon(status)}
    ${voltageText ? `<span class="node-health-voltage">${escapeHtml(voltageText)}</span>` : ""}
    ${temperatureText ? `${THERMOMETER_ICON}<span class="node-health-temperature">${escapeHtml(temperatureText)}</span>` : ""}
    ${humidityText ? `${HUMIDITY_ICON}<span class="node-health-humidity">${escapeHtml(humidityText)}</span>` : ""}
  </button>`;
}

function nodeNetworkDetails(node) {
  const rankNodes = [...state.nodeByKey.values()];
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
  return renderNodeDetails(t("node.networkDetails"), [
    [t("node.usefulness7d"), usefulness, t("node.usefulnessHelp", { window: scoreWindow })],
    [t("node.coverage7d"), scoredWithRank(nodeMetric(node, "coverage_score"), rankNodes, node, "coverage_score"), t("node.coverageHelp")],
    [t("node.trafficShare7d"), scoredWithRank(nodeMetric(node, "traffic_share_score"), rankNodes, node, "traffic_share_score"), t("node.trafficShareHelp")],
    [t("node.bridge7d"), scoredWithRank(nodeMetric(node, "bridge_score"), rankNodes, node, "bridge_score"), t("node.bridgeHelp")],
    [t("node.criticality7d"), scoredWithRank(nodeMetric(node, "redundancy_score"), rankNodes, node, "redundancy_score"), t("node.criticalityHelp")],
    [t("node.defaultScope"), node.default_scope, t("node.defaultScopeHelp")],
    [t("node.configuredScope"), node.configured_scope, t("node.configuredScopeHelp")],
    [t("node.transportedScopes"), Array.isArray(node.transported_scopes) && node.transported_scopes.length
      ? node.transported_scopes.join(", ") : null, t("node.transportedScopesHelp")],
    [t("node.foreign"), node.foreign ? t("common.yes") : null, t("node.foreignHelp")],
  ], scoreHelp, "node-network-details");
}

function nodeHistory(node) {
  if (!/^[0-9a-f]{64}$/i.test(node.public_key || "")) return "";
  return `
    <div class="node-history" data-node-key="${escapeHtml(node.public_key.toUpperCase())}">
      <div class="node-history-head"><span>${t("node.historyTitle")}</span><small>${t("node.historyLoading")}</small></div>
      <div class="node-history-chart"></div>
    </div>
  `;
}

function scrollNodeHealthHistory(root) {
  const section = root?.querySelector(".node-health-history");
  if (!section) return false;
  const shell = section.closest(".node-detail-shell");
  const overviewTab = shell?.querySelector('[data-node-detail-tab="overview"]');
  if (overviewTab && !overviewTab.classList.contains("active")) overviewTab.click();
  section.scrollIntoView({ behavior: "smooth", block: "center" });
  section.classList.add("node-health-history-highlight");
  setTimeout(() => section.classList.remove("node-health-history-highlight"), 1_200);
  return true;
}

function revealNodeHealthTrend(root, keyValue) {
  const detailPage = root?.closest?.(".node-detail-page");
  if (detailPage?.open && scrollNodeHealthHistory(detailPage)) return true;
  const key = String(keyValue || "").toUpperCase();
  const node = key ? state.nodeByKey.get(key) : null;
  if (!node) return false;
  openNodeDetail(node);
  setTimeout(() => scrollNodeHealthHistory(elements.nodeDetailPage), 80);
  return true;
}

function nodeHealthConfig(node) {
  const config = node.healthConfig;
  if (!config?.regions) return "";
  const regions = config.regions;
  const received = config.observedAt
    ? `<small>${t("node.configReceived", { time: formatNodeDate(config.observedAt) })}</small>`
    : "";
  return `
    <section class="node-health-config" data-node-key="${escapeHtml(String(node.public_key || "").toUpperCase())}">
      <div class="node-health-config-head">
        <h4>${t("node.healthConfigTitle")}</h4>
        ${received}
      </div>
      <dl>
        <div><dt>${t("node.homeRegion")}</dt><dd>${escapeHtml(regions.home || "—")}</dd></div>
        <div><dt>${t("node.defaultRegion")}</dt><dd>${escapeHtml(regions.default || "—")}</dd></div>
        <div><dt>${t("node.floodRegions")}</dt><dd>${escapeHtml(regions.flood.length ? regions.flood.join(", ") : "—")}</dd></div>
      </dl>
      ${regions.incomplete ? `<p class="node-health-config-warning">${t("node.regionsIncomplete")}</p>` : ""}
    </section>
  `;
}

function nodeHealthHistory(node) {
  if (!node.health || !/^[0-9a-f]{64}$/i.test(node.public_key || "")) return "";
  return `
    <section class="node-health-history" data-node-key="${escapeHtml(node.public_key.toUpperCase())}">
      <div class="node-health-history-head">
        <h4>${t("node.healthHistoryTitle")}</h4>
        <div class="node-health-windows" role="group" aria-label="${t("node.healthHistoryTitle")}">
          <button type="button" data-health-days="1" class="active">${t("node.healthHistory24h")}</button>
          <button type="button" data-health-days="7">${t("node.healthHistory7d")}</button>
          <button type="button" data-health-days="30">${t("node.healthHistory30d")}</button>
        </div>
      </div>
      <div class="node-health-series node-health-series-battery" data-health-metric="battery">
        <div class="node-health-series-head"><span>${t("node.battery")}</span><small>${t("node.healthHistoryLoading")}</small></div>
        <div class="node-health-chart node-health-chart-battery"></div>
      </div>
      <div class="node-health-series node-health-series-temperature" data-health-metric="temperature">
        <div class="node-health-series-head"><span>${t("node.temperature")}</span><small>${t("node.healthHistoryLoading")}</small></div>
        <div class="node-health-chart node-health-chart-temperature"></div>
      </div>
      <p class="node-health-history-empty" hidden></p>
    </section>
  `;
}

function compactNodePopupContent(node, active) {
  return `
    <header>
      <div class="node-header-main">
        <small>${escapeHtml(roleLabel(node.role))}</small>${nodeNewBadge(node)}<h3>${escapeHtml(node.name || t("common.unknownNode"))}</h3>
        ${nodeHealthBadge(node)}
      </div>
      <span class="${active ? "active" : "inactive"}">${active ? t("common.active") : t("common.inactive")}</span>
    </header>
    ${nodePhotos(node)}
    ${nodeBasicDetails(node)}
    ${nodeTrafficDetails(node, { compact: true })}
    ${nodeNetworkDetails(node)}
    ${nodeUserInfo(node)}
    ${nodeComments(node)}
    ${nodeLastRoute(node)}
    ${nodeNeighbors(node)}
    ${nodeHistory(node)}
    ${nodeCompactPublicKey(node)}
    ${nodeActionButtons(node)}
    <div class="node-compact-actions">
      <button class="node-detail-open" type="button">${t("nodeDetail.open")}</button>
    </div>
  `;
}

function nodePopup(node, active) {
  return `<section class="node-popup-card compact">${compactNodePopupContent(node, active)}</section>`;
}

function nodeDetailShell(node, active) {
  const tabs = [
    ["overview", t("nodeDetail.overview")],
    ["photos", t("nodeDetail.photos")],
    ["comments", t("nodeDetail.comments")],
    ["network", t("nodeDetail.network")],
  ];
  return `
    <header class="node-detail-header">
      <div>
        <small>${escapeHtml(roleLabel(node.role))}</small>${nodeNewBadge(node)}
        <h2 id="node-detail-title">${escapeHtml(node.name || t("common.unknownNode"))}</h2>
        <span class="${active ? "active" : "inactive"}">${active ? t("common.active") : t("common.inactive")}</span>
        ${nodeHealthBadge(node)}
      </div>
      <button class="node-detail-close" type="button" aria-label="${t("nodeDetail.close")}">×</button>
    </header>
    <nav class="node-detail-tabs" aria-label="${t("nodeDetail.tabs")}">
      ${tabs.map(([key, label], index) => `<button type="button" data-node-detail-tab="${key}" class="${index === 0 ? "active" : ""}">${label}</button>`).join("")}
    </nav>
    <div class="node-detail-panels">
      ${tabs.map(([key]) => `<section class="node-detail-panel" data-node-detail-panel="${key}"${key === "overview" ? "" : " hidden"}></section>`).join("")}
    </div>
  `;
}

function renderNodeDetail(node, active, initialTab = "overview") {
  const temp = document.createElement("div");
  temp.innerHTML = nodePopupContent(node, active);
  temp.querySelector("header")?.remove();
  elements.nodeDetailPage.replaceChildren();
  const shell = document.createElement("section");
  shell.className = "node-detail-shell";
  shell.innerHTML = nodeDetailShell(node, active);
  elements.nodeDetailPage.appendChild(shell);
  const panels = new Map([...shell.querySelectorAll("[data-node-detail-panel]")]
    .map((panel) => [panel.dataset.nodeDetailPanel, panel]));
  const move = (selector, panelName, all = false) => {
    const source = all ? temp.querySelectorAll(selector) : [temp.querySelector(selector)].filter(Boolean);
    for (const element of source) panels.get(panelName)?.appendChild(element);
  };
  move(".node-user-info", "overview");
  move(".node-photos", "photos");
  move(".node-comments", "comments");
  move(".node-basic-details", "overview");
  move(".node-traffic-details", "overview", true);
  move(".node-health-summary", "overview", true);
  move(".node-health-config", "overview", true);
  move(".node-health-history", "overview", true);
  move(".node-network-details", "overview", true);
  move(".node-analytics", "network", true);
  move(".node-last-route", "overview", true);
  move(".node-neighbors", "overview", true);
  move(".node-history", "overview", true);
  move(".node-public-key", "overview", true);
  move(".node-popup-actions", "overview", true);
  shell.querySelector(".node-popup-close")?.remove();
  const selectTab = (tab) => {
    const next = panels.has(tab) ? tab : "overview";
    for (const button of shell.querySelectorAll("[data-node-detail-tab]")) {
      button.classList.toggle("active", button.dataset.nodeDetailTab === next);
    }
    for (const [key, panel] of panels) panel.hidden = key !== next;
  };
  for (const button of shell.querySelectorAll("[data-node-detail-tab]")) {
    button.addEventListener("click", () => selectTab(button.dataset.nodeDetailTab));
  }
  selectTab(initialTab);
  const detailTabs = [...shell.querySelectorAll("[data-node-detail-tab]")].map((button) => button.dataset.nodeDetailTab);
  let tabSwipeStart = null;
  shell.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, button, a, img, .node-photos, .node-health-history, .node-history")) {
      tabSwipeStart = null;
      return;
    }
    const touch = event.touches[0];
    tabSwipeStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  shell.addEventListener("touchend", (event) => {
    if (!tabSwipeStart || !event.changedTouches.length) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - tabSwipeStart.x;
    const dy = touch.clientY - tabSwipeStart.y;
    tabSwipeStart = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    const active = detailTabs.findIndex((tab) => shell.querySelector(`[data-node-detail-tab="${tab}"]`)?.classList.contains("active"));
    const next = detailTabs[Math.max(0, Math.min(detailTabs.length - 1, active + (dx < 0 ? 1 : -1)))];
    if (next) selectTab(next);
  }, { passive: true });
  shell.querySelector(".node-detail-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    closeNodeDetail();
  });
  setupNodePopup({ getElement: () => shell, close: closeNodeDetail }, node);
  void loadDetailComments(shell, node);
  if (!elements.nodeDetailPage.open) elements.nodeDetailPage.showModal();
}

function closeNodeDetail({ fromHistory = false } = {}) {
  if (elements.nodeDetailPage.open) elements.nodeDetailPage.close();
  state.nodeDetailKey = null;
  if (fromHistory || !state.nodeDetailPushed) {
    if (!fromHistory && nodeDetailPathKey()) history.replaceState({}, "", MAP_PATH);
    state.nodeDetailPushed = false;
    return;
  }
  state.nodeDetailPushed = false;
  history.back();
}

function openNodeDetail(node, tab = "overview") {
  const key = String(node.public_key || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return;
  const onDetailPath = Boolean(nodeDetailPathKey());
  map.closePopup();
  state.nodeDetailKey = key;
  if (!onDetailPath) {
    history.pushState({ nodeDetail: key }, "", nodeDetailPath(key));
    state.nodeDetailPushed = true;
  } else {
    state.nodeDetailPushed = false;
  }
  renderNodeDetail(node, nodeIsActive(node, nowMs(), NODE_ACTIVE_MS), tab);
}

function applyInitialDetail() {
  if (!INITIAL_DETAIL_KEY || state.initialDetailApplied) return;
  const node = state.nodeByKey.get(INITIAL_DETAIL_KEY.toUpperCase());
  if (!node) return;
  state.initialDetailApplied = true;
  openNodeDetail(node);
}

function renderNodeHistory(root, samples) {
  const chart = root.querySelector(".node-history-chart");
  const summary = root.querySelector(".node-history-head small");
  if (!chart) return;
  const points = samples.map((sample) => ({
    time: Date.parse(sample.sampledAt),
    value: Number(sample.usefulness),
  })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
  if (points.length < 2) {
    chart.textContent = t("node.historyEmpty");
    if (summary) summary.textContent = "";
    return;
  }
  const width = 300;
  const height = 64;
  const pad = 5;
  const firstTime = points[0].time;
  const timeSpan = Math.max(1, points.at(-1).time - firstTime);
  const x = (time) => pad + (width - 2 * pad) * ((time - firstTime) / timeSpan);
  const y = (value) => height - pad - (height - 2 * pad) * Math.min(1, Math.max(0, value));
  const line = points.map((point) => `${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;
  const last = points.at(-1);
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t("node.historyTitle"))}">
    <polygon points="${area}" class="node-history-area"></polygon>
    <polyline points="${line}" class="node-history-line"></polyline>
    <circle cx="${x(last.time).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="3" class="node-history-dot"></circle>
  </svg>`;
  const cursor = document.createElement("div");
  cursor.className = "node-history-cursor";
  cursor.hidden = true;
  const tip = document.createElement("div");
  tip.className = "node-history-tip";
  tip.hidden = true;
  chart.append(cursor, tip);
  const showPoint = (clientX) => {
    const rect = chart.getBoundingClientRect();
    if (!rect.width) return;
    const chartX = Math.max(pad, Math.min(width - pad, ((clientX - rect.left) / rect.width) * width));
    let nearest = points[0];
    let best = Infinity;
    for (const point of points) {
      const distance = Math.abs(x(point.time) - chartX);
      if (distance < best) {
        best = distance;
        nearest = point;
      }
    }
    const left = (x(nearest.time) / width) * rect.width;
    cursor.style.left = `${(x(nearest.time) / width) * 100}%`;
    cursor.hidden = false;
    tip.textContent = `${formatDateTimeShort(nearest.time)} · ${formatPercent(nearest.value)}`;
    tip.style.left = `${Math.max(42, Math.min(rect.width - 42, left))}px`;
    tip.hidden = false;
  };
  chart.onpointermove = (event) => showPoint(event.clientX);
  chart.onpointerdown = (event) => showPoint(event.clientX);
  chart.onpointerleave = () => {
    cursor.hidden = true;
    tip.hidden = true;
  };
  if (summary) {
    summary.textContent = t("node.historyRange", {
      min: formatPercent(min),
      max: formatPercent(max),
      count: points.length,
    });
  }
}

async function loadNodeHistory(root, node) {
  const key = String(node.public_key || "").toUpperCase();
  if (!key || !root.querySelector(".node-history")) return;
  const cached = state.nodeHistoryCache.get(key);
  if (cached && Date.now() - cached.at < NODE_HISTORY_TTL_MS) {
    renderNodeHistory(root, cached.samples);
    return;
  }
  try {
    const data = await getJson(`/api/node-history?key=${encodeURIComponent(key)}&days=7`);
    state.nodeHistoryCache.set(key, { at: Date.now(), samples: data.samples || [] });
    if (root.isConnected) renderNodeHistory(root, data.samples || []);
  } catch (error) {
    console.error("Historii nodu se nepodařilo načíst", error);
    if (!root.isConnected) return;
    const chart = root.querySelector(".node-history-chart");
    if (chart) chart.textContent = t("node.historyUnavailable");
    const summary = root.querySelector(".node-history-head small");
    if (summary) summary.textContent = "";
  }
}

function splitHealthSegments(points, gapMs) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (current.length && point.time - current.at(-1).time > gapMs) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

function healthValueText(metric, value) {
  if (metric === "battery") return `${formatDecimal(value / 1000, 2)} V`;
  if (metric === "humidity") return `${formatNumber(value)} %`;
  if (metric === "current") return `${formatNumber(value)} mA`;
  return `${formatDecimal(value, 1)} °C`;
}

function healthSummaryRange(range, metric) {
  if (!range) return null;
  const min = range.min == null ? null : healthValueText(metric, range.min);
  const max = range.max == null ? null : healthValueText(metric, range.max);
  const avg = range.avg == null ? null : healthValueText(metric, range.avg);
  const last = range.last == null ? null : healthValueText(metric, range.last);
  const span = min && max ? `${min} – ${max}` : (last || min || max);
  return [
    span,
    avg ? t("node.healthSummaryAvg", { value: avg }) : null,
    last ? t("node.healthSummaryLast", { value: last }) : null,
  ].filter(Boolean).join(" · ") || null;
}

function nodeHealthSummary(node) {
  const summary = node.health?.summary;
  if (!summary) return "";
  const rows = [
    [t("node.battery"), healthSummaryRange(summary.battery, "battery")],
    [t("node.temperature"), healthSummaryRange(summary.temperature, "temperature")],
    [t("node.humidity"), healthSummaryRange(summary.humidity, "humidity")],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  const meta = [
    summary.batteryType ? batteryTypeName(summary.batteryType) : null,
    summary.batteryCells ? `${summary.batteryCells}S` : null,
    summary.voltageSource ? voltageSourceName(summary.voltageSource) : null,
  ].filter(Boolean).join(" · ");
  return `
    <section class="node-health-summary" data-node-key="${escapeHtml(String(node.public_key || "").toUpperCase())}">
      <div class="node-health-summary-head">
        <h4>${t("node.healthSummaryTitle")}</h4>
        <small>${t("node.healthSummarySamples", { count: formatNumber(summary.samples) })}</small>
      </div>
      <dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      ${meta ? `<small class="node-health-summary-meta">${escapeHtml(meta)}</small>` : ""}
    </section>
  `;
}

function healthAxisTime(value, spanMs) {
  const date = new Date(value);
  if (spanMs <= 36 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(getLocale(), { day: "2-digit", month: "2-digit" }).format(date);
}

function renderNodeHealthSeries(container, rawPoints, metric) {
  if (!container) return;
  const chart = container.querySelector(".node-health-chart");
  const summary = container.querySelector(".node-health-series-head small");
  if (!chart) return;
  const points = (rawPoints || [])
    .map((sample) => ({ time: Date.parse(sample.at), value: Number(sample.value) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .sort((a, b) => a.time - b.time);
  if (points.length < 2) {
    chart.classList.add("empty");
    chart.textContent = t("node.healthHistoryEmpty");
    if (summary) summary.textContent = "";
    return;
  }
  chart.classList.remove("empty");
  const width = 300;
  const height = 58;
  const pad = 5;
  const firstTime = points[0].time;
  const lastTime = points.at(-1).time;
  const timeSpan = Math.max(1, lastTime - firstTime);
  const values = points.map((point) => point.value);
  const valueMin = Math.min(...values);
  const valueMax = Math.max(...values);
  const valuePadding = metric === "battery" ? 100 : 1;
  const yMin = valueMin - valuePadding;
  const yMax = valueMax + valuePadding;
  const valueSpan = Math.max(1, yMax - yMin);
  const x = (time) => pad + (width - 2 * pad) * ((time - firstTime) / timeSpan);
  const y = (value) => height - pad - (height - 2 * pad) * ((value - yMin) / valueSpan);
  const segments = splitHealthSegments(points, metric === "battery" ? 2 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000);
  const shapes = segments.map((segment) => {
    if (segment.length === 1) {
      return `<circle cx="${x(segment[0].time).toFixed(1)}" cy="${y(segment[0].value).toFixed(1)}" r="2.5" class="node-health-dot"></circle>`;
    }
    const line = segment.map((point) => `${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
    const first = segment[0];
    const last = segment.at(-1);
    return `<polygon points="${x(first.time).toFixed(1)},${height - pad} ${line} ${x(last.time).toFixed(1)},${height - pad}" class="node-health-area"></polygon><polyline points="${line}" class="node-health-line"></polyline>`;
  }).join("");
  const yTicks = [yMax, (yMax + yMin) / 2, yMin];
  const yAxis = `<div class="node-health-yaxis" aria-hidden="true">${yTicks
    .map((value) => `<span style="top:${y(value).toFixed(1)}px">${escapeHtml(healthValueText(metric, value))}</span>`)
    .join("")}</div>`;
  const xTicks = [firstTime, firstTime + timeSpan / 2, lastTime];
  const xAxis = `<div class="node-health-xaxis" aria-hidden="true">${xTicks
    .map((time) => `<span>${escapeHtml(healthAxisTime(time, timeSpan))}</span>`)
    .join("")}</div>`;
  chart.innerHTML = `${yAxis}<div class="node-health-chart-plot"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t("node.healthHistoryTitle"))}">
    ${shapes}
    <circle cx="${x(lastTime).toFixed(1)}" cy="${y(points.at(-1).value).toFixed(1)}" r="3" class="node-health-dot"></circle>
  </svg></div>${xAxis}`;
  const plot = chart.querySelector(".node-health-chart-plot");
  const cursor = document.createElement("div");
  cursor.className = "node-health-cursor";
  cursor.hidden = true;
  const tip = document.createElement("div");
  tip.className = "node-health-tip";
  tip.hidden = true;
  plot.append(cursor, tip);
  const showPoint = (clientX) => {
    const rect = plot.getBoundingClientRect();
    if (!rect.width) return;
    const chartX = Math.max(pad, Math.min(width - pad, ((clientX - rect.left) / rect.width) * width));
    let nearest = points[0];
    let best = Infinity;
    for (const point of points) {
      const distance = Math.abs(x(point.time) - chartX);
      if (distance < best) {
        best = distance;
        nearest = point;
      }
    }
    const left = (x(nearest.time) / width) * rect.width;
    cursor.style.left = `${(x(nearest.time) / width) * 100}%`;
    cursor.hidden = false;
    tip.textContent = `${formatDateTimeShort(nearest.time)} · ${healthValueText(metric, nearest.value)}`;
    tip.style.left = `${Math.max(58, Math.min(rect.width - 58, left))}px`;
    tip.hidden = false;
  };
  chart.onpointermove = (event) => showPoint(event.clientX);
  chart.onpointerdown = (event) => showPoint(event.clientX);
  chart.onpointerleave = () => {
    cursor.hidden = true;
    tip.hidden = true;
  };
  if (summary) {
    summary.textContent = t("node.healthHistoryRange", {
      min: healthValueText(metric, valueMin),
      max: healthValueText(metric, valueMax),
      count: points.length,
    });
  }
}

function renderNodeHealthHistory(section, data) {
  if (!section) return;
  const samples = data?.samples || {};
  const hasSamples = (samples.battery || []).length || (samples.temperature || []).length;
  if (!hasSamples && data?.latest?.summary) {
    for (const metric of ["battery", "temperature"]) {
      const series = section.querySelector(`[data-health-metric="${metric}"]`);
      const chart = series?.querySelector(".node-health-chart");
      const summary = series?.querySelector(".node-health-series-head small");
      if (!chart) continue;
      chart.classList.add("empty");
      chart.textContent = t("node.healthSummaryOnly");
      if (summary) summary.textContent = "";
    }
    return;
  }
  renderNodeHealthSeries(
    section.querySelector('[data-health-metric="battery"]'),
    samples.battery || [],
    "battery",
  );
  renderNodeHealthSeries(
    section.querySelector('[data-health-metric="temperature"]'),
    samples.temperature || [],
    "temperature",
  );
}

async function loadNodeHealthHistory(root, node, days = 1) {
  const section = root.querySelector(".node-health-history");
  if (!section) return;
  const key = String(node.public_key || "").toUpperCase();
  if (!key) return;
  for (const button of section.querySelectorAll("[data-health-days]")) {
    button.classList.toggle("active", Number(button.dataset.healthDays) === days);
  }
  try {
    const data = await getJson(`/api/node-health?key=${encodeURIComponent(key)}&days=${days}`);
    if (!root.isConnected) return;
    const empty = section.querySelector(".node-health-history-empty");
    if (empty) empty.hidden = true;
    renderNodeHealthHistory(section, data);
  } catch (error) {
    console.error("Historii zdraví nodu se nepodařilo načíst", error);
    if (!root.isConnected) return;
    const empty = section.querySelector(".node-health-history-empty");
    if (empty) {
      empty.hidden = false;
      empty.textContent = t("node.healthHistoryUnavailable");
    }
  }
}

async function loadPhotoNodes(force = false) {
  if (!force && state.photoNodesLoadedAt && Date.now() - state.photoNodesLoadedAt < 60_000) return;
  if (state.photoNodesLoading) return;
  state.photoNodesLoading = true;
  try {
    const data = await getJson("/api/photos/nodes");
    state.photoNodeKeys = new Set();
    state.photoCoverCache = new Map();
    state.photoCountCache = new Map();
    for (const item of data.nodes || []) {
      const key = String(item.nodeKey || "").toUpperCase();
      if (!key) continue;
      state.photoNodeKeys.add(key);
      state.photoCountCache.set(key.toLowerCase(), Math.max(0, Number(item.count) || 0));
      if (item.coverId) state.photoCoverCache.set(key, String(item.coverId));
    }
    state.photoNodesLoadedAt = Date.now();
  } catch (error) {
    console.error("Nody s fotkami se nepodařilo načíst", error);
    state.photosOnly = false;
    elements.photosOnlyToggle.checked = false;
  } finally {
    state.photoNodesLoading = false;
  }
}

function routesSuppressed() {
  return state.hideRoutes || state.photosOnly || state.healthOnly;
}

function applyRouteVisibility() {
  const hidden = routesSuppressed();
  if (hidden) {
    if (map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
    if (map.hasLayer(selectedRouteLayer)) map.removeLayer(selectedRouteLayer);
    snrLabelLayer.clearLayers();
    snrLabelSignature = "";
  } else {
    if (!state.packetFocus && !map.hasLayer(routeLayer)) routeLayer.addTo(map);
    if (!map.hasLayer(selectedRouteLayer)) selectedRouteLayer.addTo(map);
    scheduleSnrLabels(150);
  }
  updateRouteAnimation();
}

function applyNodeFilterRouteVisibility() {
  if (routesSuppressed() && state.packetFocus) exitPacketFocus();
  else applyRouteVisibility();
}

async function setPhotosOnly(on) {
  state.photosOnly = Boolean(on);
  if (state.photosOnly) await loadPhotoNodes();
  applyNodeFilterRouteVisibility();
  refreshNodeState();
}

function setRoutesHidden(hidden) {
  state.hideRoutes = Boolean(hidden);
  elements.hideRoutesToggle.checked = state.hideRoutes;
  localStorage.setItem("meshcoreHideRoutes", String(state.hideRoutes));
  if (state.hideRoutes && state.packetFocus) exitPacketFocus();
  else applyRouteVisibility();
}

async function loadNodePhotos(root, node) {
  const list = root.querySelector(".node-photos-list");
  if (!list) return;
  const key = String(node.public_key || "").toLowerCase();
  const cached = state.photoCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) {
    renderNodePhotos(list, cached.photos, node);
    return;
  }
  try {
    const data = await getPhotoJson(appPath, `/api/photos?key=${encodeURIComponent(key)}`);
    const photos = (Array.isArray(data.photos) ? data.photos : []).map((photo) => ({
      ...photo,
      nodeKey: key,
      nodeName: node.name || t("common.unknownNode"),
    }));
    state.photoCache.set(key, { at: Date.now(), photos });
    if (list.isConnected) renderNodePhotos(list, photos, node);
  } catch (error) {
    console.error("Fotky nodu se nepodařilo načíst", error);
    if (list.isConnected) list.textContent = t("photos.loadFailed");
  }
}

function renderNodePhotos(list, photos, node) {
  const section = list.closest(".node-photos");
  const count = section?.querySelector(".node-photos-count");
  if (count) count.textContent = String(photos.length);
  list.replaceChildren();
  if (!photos.length) {
    const empty = document.createElement("p");
    empty.className = "node-photos-empty";
    empty.textContent = t("photos.empty");
    list.appendChild(empty);
    return;
  }
  photos.forEach((photo, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "node-photo";
    button.dataset.photoId = photo.id;
    button.title = photo.caption || t("photos.openAria");
    button.setAttribute("aria-label", t("photos.openAria"));
    const image = document.createElement("img");
    image.src = appPath(`/api/photos/${encodeURIComponent(photo.id)}`);
    image.alt = t("photos.alt", { name: node.name || t("common.unknownNode") });
    button.appendChild(image);
    const likes = Number(photo.likes) || 0;
    if (likes > 0) {
      const like = document.createElement("span");
      like.className = "node-photo-like";
      like.title = t("photos.like");
      like.textContent = `👍 ${likes}`;
      button.appendChild(like);
    }
    if (photo.caption) {
      const caption = document.createElement("small");
      caption.textContent = photo.caption;
      button.appendChild(caption);
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      photoLightbox.open(photo, node, photos, index);
    });
    list.appendChild(button);
  });
}

const photoGallery = createPhotoGalleryController({
  appPath,
  elements,
  formatDateTimeShort,
  getJson: (path) => getPhotoJson(appPath, path),
  getLocale,
  nowMs,
  nodeLinksEnabled: true,
  onOpenNode: (photo) => revealPhotoNode(photo, null),
  onOpenPhoto: (photo, photos, index) => photoLightbox.open(photo, null, photos, index),
  onShareNode: shareNodeGallery,
  state,
  t,
  tCount,
  votingEnabled: true,
});
photoGallery.bind();

const photoLightbox = createPhotoLightboxController({
  appPath,
  elements,
  onManage: (photo, node) => photoManage.open(photo, node),
  onOpenNode: (photo, node) => revealPhotoNode(photo, node),
  onVote: votePhoto,
  postJson,
  resolveNode: (key) => state.nodeByKey.get(key.toUpperCase()) || null,
  t,
  votingEnabled: true,
});
photoLightbox.bind();

const photoTokenStore = createPhotoTokenStore();
const nodeInfoTokens = createNodeInfoTokenStore();
const photoManage = createPhotoManageController({
  appPath,
  elements,
  getCurrentPhoto: () => photoLightbox.current(),
  onPhotoDeleted: (photo) => {
    photoGallery.removePhoto(photo.id);
    photoLightbox.removePhoto(photo.id);
  },
  onPhotoUpdated: (photo) => {
    photoGallery.updatePhoto(photo);
    photoLightbox.updatePhoto(photo.id, photo);
  },
  refreshNodePhotoList,
  t,
  tokenStore: photoTokenStore,
});
photoManage.bind();
photoManage.renderUploads();

const photoUpload = createPhotoUploadController({
  appPath,
  elements,
  manage: photoManage,
  onPublished: (target) => {
    state.photoCache.delete(target.key);
    const section = document.querySelector(`.node-photos[data-node-key="${target.key}"]`);
    if (section) {
      void loadNodePhotos(section, { name: target.name, public_key: target.key });
    }
    void loadPhotoNodes(true).then(() => {
      if (state.photosOnly) refreshNodeState();
    }).catch(() => {});
  },
  onUploaded: () => photoGallery.refresh(),
  t,
  tCount,
});
photoUpload.bind();

async function votePhoto(photo, value) {
  if (!photo?.id || ![0, 1, -1].includes(Number(value))) return null;
  try {
    const summary = await voteForPhoto(appPath, photo.id, Number(value));
    photoGallery.updatePhoto({ id: photo.id, ...summary });
    const cached = state.photoCache.get(String(photo.nodeKey || "").toLowerCase());
    const cachedPhoto = cached?.photos?.find((entry) => entry.id === photo.id);
    if (cachedPhoto) Object.assign(cachedPhoto, summary);
    refreshNodePhotoList(photo.nodeKey);
    return summary;
  } catch (error) {
    console.error(t("photos.voteFailed"), error);
    return null;
  }
}

function galleryShareUrl(nodeKey = "") {
  const url = new URL(location.href);
  url.pathname = MAP_PATH;
  url.search = "";
  url.searchParams.set("gallery", "1");
  if (nodeKey) url.searchParams.set("galleryNode", nodeKey);
  return url.toString();
}

async function shareNodeGallery(photo) {
  const key = String(photo?.nodeKey || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return;
  const ok = await copyText(galleryShareUrl(key));
  const message = t(ok ? "photos.galleryNodeLinkCopied" : "common.copyFailed");
  elements.photoGalleryStatus.hidden = false;
  elements.photoGalleryStatus.classList.toggle("error", !ok);
  elements.photoGalleryStatus.textContent = message;
  setTimeout(() => {
    if (elements.photoGalleryStatus.textContent !== message) return;
    elements.photoGalleryStatus.hidden = true;
    elements.photoGalleryStatus.textContent = "";
  }, 3_000);
}

function revealPhotoNode(photo, nodeValue) {
  const key = String(photo?.nodeKey || nodeValue?.public_key || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return;
  const node = state.nodeByKey.get(key.toUpperCase())
    || nodeValue
    || { name: photo?.nodeName || t("common.unknownNode"), public_key: key };
  photoLightbox.close();
  if (elements.photoGalleryDialog.open) elements.photoGalleryDialog.close();
  if (elements.nodeDetailPage.open) closeNodeDetail();
  revealSearchNode(node);
}

function analyticsNumber(value, suffix = "") {
  const number = Number(value);
  return Number.isFinite(number) ? `${formatDecimal(number, 1)}${suffix}` : "—";
}

function analyticsCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? formatNumber(number) : "—";
}

function renderNodeAnalytics(section, data) {
  const body = section.querySelector(".node-analytics-body");
  const status = section.querySelector(".node-analytics-head small");
  if (!body) return;
  if (status) status.textContent = data.partial ? t("analytics.partial") : "";
  const stats = data.health?.stats || {};
  const clock = data.clockSkew || {};
  const observers = Array.isArray(data.health?.observers) ? data.health.observers : [];
  const adverts = Array.isArray(data.detail?.recentAdverts) ? data.detail.recentAdverts : [];
  const paths = Array.isArray(data.paths?.paths) ? data.paths.paths : [];
  const advertLimit = 10;
  const pathLimit = 10;
  const skew = clock.recentMedianSkewSec ?? clock.medianSkewSec;
  const metrics = [
    [t("analytics.totalPackets"), analyticsCount(stats.totalPackets)],
    [t("analytics.packetsToday"), analyticsCount(stats.packetsToday)],
    [t("analytics.totalObservations"), analyticsCount(stats.totalObservations)],
    [t("analytics.avgHops"), analyticsNumber(stats.avgHops)],
    [t("analytics.avgSnr"), analyticsNumber(stats.avgSnr, " dB")],
    [t("analytics.relayObservers"), analyticsCount(data.health?.relayObserverCount)],
    [t("analytics.clockSkew"), analyticsNumber(skew, " s")],
  ];
  const analyticsDetails = [
    observers.length ? `
      <details class="node-analytics-details">
        <summary>${t("analytics.directObservers")} (${observers.length})</summary>
        <ul>${observers.map((observer) => `
          <li>
            <span>${escapeHtml(observer.observer_name || t("packet.unknownObserver"))}</span>
            <small>${escapeHtml(t("analytics.observerLine", {
              packets: analyticsCount(observer.packetCount),
              snr: analyticsNumber(observer.avgSnr, " dB"),
              rssi: analyticsNumber(observer.avgRssi, " dBm"),
            }))}</small>
          </li>
        `).join("")}</ul>
      </details>
    ` : "",
    adverts.length ? `
      <details class="node-analytics-details">
        <summary>${t("analytics.recentAdverts")} (${adverts.length})</summary>
        <ul>${adverts.slice(0, advertLimit).map((advert) => {
          const kind = advert.advert_kind === "flood" ? t("analytics.flood") : t("analytics.direct");
          const observer = advert.observer_name || advert.observations?.[0]?.observer_name || t("packet.unknownObserver");
          const time = formatNodeDate(advert.timestamp || advert.first_seen);
          return `
            <li>
              <b>${escapeHtml(kind)}</b> <span>${escapeHtml(observer)}</span>
              <small>${escapeHtml(time)} · SNR ${analyticsNumber(advert.snr, " dB")} · RSSI ${analyticsNumber(advert.rssi, " dBm")}</small>
            </li>
          `;
        }).join("")}</ul>
        ${adverts.length > advertLimit ? `<p class="node-analytics-note">${escapeHtml(t("analytics.limited", { shown: advertLimit, total: adverts.length }))}</p>` : ""}
      </details>
    ` : "",
    paths.length ? `
      <details class="node-analytics-details">
        <summary>${t("analytics.paths")} (${paths.length})</summary>
        <p class="node-analytics-note">${escapeHtml(t("analytics.pathsSummary", {
          paths: analyticsCount(data.paths?.totalPaths ?? paths.length),
          transmissions: analyticsCount(data.paths?.totalTransmissions ?? 0),
        }))}</p>
        <ul>${paths.slice(0, pathLimit).map((path) => {
          const chain = path.hops.map((hop) => hop.name || hop.prefix || "?").join(" → ");
          return `
            <li>
              <span title="${escapeHtml(chain)}">${escapeHtml(chain)}</span>
              <small>${path.count}× · ${escapeHtml(formatNodeDate(path.lastSeen))}</small>
            </li>
          `;
        }).join("")}</ul>
        ${paths.length > pathLimit ? `<p class="node-analytics-note">${escapeHtml(t("analytics.limited", { shown: pathLimit, total: paths.length }))}</p>` : ""}
      </details>
    ` : "",
  ].filter(Boolean);

  if (!metrics.length && !analyticsDetails.length) {
    body.textContent = t("analytics.noData");
    return;
  }
  body.innerHTML = `
    <div class="node-analytics-grid">${metrics.map(([label, value]) => `
      <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
    `).join("")}</div>
    ${analyticsDetails.join("")}
  `;
}

async function loadNodeAnalytics(root, node) {
  const section = root.querySelector(".node-analytics");
  if (!section) return;
  const key = String(node.public_key || "").toLowerCase();
  const cached = state.nodeAnalyticsCache.get(key);
  if (cached && Date.now() - cached.at < NODE_ANALYTICS_TTL_MS) {
    renderNodeAnalytics(section, cached.data);
    return;
  }
  try {
    const data = await getJson(`/api/node-detail?key=${encodeURIComponent(key)}`);
    state.nodeAnalyticsCache.set(key, { at: Date.now(), data });
    if (section.isConnected) renderNodeAnalytics(section, data);
  } catch (error) {
    console.error("Analytiku nodu se nepodařilo načíst", error);
    if (!section.isConnected) return;
    const status = section.querySelector(".node-analytics-head small");
    if (status) status.textContent = t("analytics.failed");
    const body = section.querySelector(".node-analytics-body");
    if (body) body.textContent = t("analytics.failed");
  }
}


function setCommentsStatus(text, isError = false) {
  elements.commentsStatus.textContent = text;
  elements.commentsStatus.classList.toggle("error", Boolean(isError));
}

function renderCommentsDialog() {
  elements.commentsTitle.textContent = t("comments.dialogTitle");
  elements.commentsClose.setAttribute("aria-label", t("comments.cancel"));
  elements.commentsNameLabel.textContent = t("comments.name");
  elements.commentsName.placeholder = t("comments.namePlaceholder");
  elements.commentsTextLabel.textContent = t("comments.text");
  elements.commentsText.placeholder = t("comments.textPlaceholder");
  elements.commentsNote.textContent = t("comments.note");
  elements.commentsSubmit.textContent = t("comments.submit");
  elements.commentsCancel.textContent = t("comments.cancel");
  const target = state.commentsTarget;
  elements.commentsNode.textContent = target
    ? `${target.name || t("common.unknownNode")} · ${target.key.slice(0, 8).toUpperCase()}`
    : "";
}

function updateCommentCount(key, count, { touch = true } = {}) {
  const value = Math.max(0, Number(count) || 0);
  if (touch) state.commentCountCache.set(key, { at: Date.now(), count: value });
  for (const section of document.querySelectorAll(".node-comments[data-node-key]")) {
    if (section.dataset.nodeKey !== key) continue;
    const badge = section.querySelector(".node-comments-count");
    if (!badge) continue;
    badge.textContent = value > 999 ? "999+" : String(value);
    badge.classList.toggle("zero", value === 0);
    badge.title = tCount("comments.count", value);
  }
}

async function loadCommentCount(root, node) {
  const key = String(node.public_key || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key) || !root.querySelector(".node-comments-count")) return;
  const cached = state.commentCountCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) {
    updateCommentCount(key, cached.count, { touch: false });
    return;
  }
  try {
    const data = await getJson(`/api/comments/count?key=${encodeURIComponent(key)}`);
    updateCommentCount(key, data.count);
  } catch (error) {
    console.error("Počet komentářů se nepodařilo načíst", error);
    if (!root.isConnected) return;
    for (const section of document.querySelectorAll(".node-comments[data-node-key]")) {
      if (section.dataset.nodeKey !== key) continue;
      const badge = section.querySelector(".node-comments-count");
      if (badge) badge.textContent = "?";
    }
  }
}

function renderComments(comments, list = elements.commentsList) {
  list.replaceChildren();
  if (!comments.length) {
    const empty = document.createElement("li");
    empty.className = "comments-empty";
    empty.textContent = t("comments.empty");
    list.appendChild(empty);
    return;
  }
  for (const comment of comments) {
    const item = document.createElement("li");
    item.className = "comment";
    const head = document.createElement("div");
    head.className = "comment-head";
    const author = document.createElement("strong");
    author.textContent = comment.author || t("comments.anonymous");
    const time = document.createElement("time");
    const date = new Date(comment.createdAt);
    if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
    time.textContent = formatNodeDate(comment.createdAt);
    head.append(author, time);
    const text = document.createElement("p");
    text.textContent = comment.text;
    item.append(head, text);
    list.appendChild(item);
  }
}

async function loadComments() {
  const target = state.commentsTarget;
  if (!target) return;
  elements.commentsList.replaceChildren();
  const loading = document.createElement("li");
  loading.className = "comments-empty";
  loading.textContent = t("comments.loading");
  elements.commentsList.appendChild(loading);
  try {
    const data = await getJson(`/api/comments?key=${encodeURIComponent(target.key)}`);
    if (state.commentsTarget?.key !== target.key) return;
    updateCommentCount(target.key, data.total);
    renderComments(Array.isArray(data.comments) ? data.comments : [], elements.commentsList);
  } catch (error) {
    console.error("Komentáře se nepodařilo načíst", error);
    if (state.commentsTarget?.key !== target.key) return;
    elements.commentsList.replaceChildren();
    const failed = document.createElement("li");
    failed.className = "comments-empty";
    failed.textContent = t("comments.loadFailed");
    elements.commentsList.appendChild(failed);
  }
}

async function loadDetailComments(root, node) {
  const list = root.querySelector("[data-detail-comments]");
  const key = String(node.public_key || "").toLowerCase();
  if (!list || !/^[0-9a-f]{64}$/.test(key)) return;
  try {
    const data = await getJson(`/api/comments?key=${encodeURIComponent(key)}`);
    updateCommentCount(key, data.total);
    if (list.isConnected) renderComments(Array.isArray(data.comments) ? data.comments : [], list);
  } catch (error) {
    console.error("Komentáře v detailu se nepodařilo načíst", error);
    if (list.isConnected) list.textContent = t("comments.loadFailed");
  }
}

function openCommentsDialog(node) {
  const key = String(node.public_key || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return;
  state.commentsTarget = { key, name: node.name || t("common.unknownNode") };
  state.commentsSaving = false;
  elements.commentsForm.reset();
  elements.commentsSubmit.disabled = false;
  setCommentsStatus("");
  renderCommentsDialog();
  if (!elements.commentsDialog.open) elements.commentsDialog.showModal();
  void loadComments();
}



function refreshNodePhotoList(nodeKey) {
  const key = String(nodeKey || "").toLowerCase();
  if (!key) return;
  state.photoCache.delete(key);
  const node = state.nodeByKey.get(key.toUpperCase()) || { public_key: key };
  for (const section of document.querySelectorAll(".node-photos[data-node-key]")) {
    if (section.dataset.nodeKey === key) void loadNodePhotos(section, node);
  }
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

function reloadForServerBuild(serverBuild) {
  const target = String(serverBuild || "").trim();
  const current = typeof __BUILD_ID__ === "string" ? __BUILD_ID__.trim() : "";
  if (!target || !current || current === "dev") return;
  if (target === current) {
    try {
      sessionStorage.removeItem(BUILD_RELOAD_KEY);
    } catch {}
    return;
  }
  let attempted = "";
  try {
    attempted = sessionStorage.getItem(BUILD_RELOAD_KEY) || "";
  } catch {}
  if (attempted === target) return;
  try {
    sessionStorage.setItem(BUILD_RELOAD_KEY, target);
  } catch {}
  console.info(`Nová verze ${target}, obnovuji stránku (aktuální ${current}).`);
  window.location.reload();
}

let buildCheckPending = false;
async function checkServerBuild() {
  if (buildCheckPending) return;
  buildCheckPending = true;
  try {
    const data = await getJson("/api/version");
    reloadForServerBuild(data.build);
  } catch (error) {
    console.warn("Kontrola verze serveru selhala", error);
  } finally {
    buildCheckPending = false;
  }
}

function nodeHealthTooltip(node) {
  const { battery, temperature, humidity } = nodeHealthSnapshot(node);
  if (battery == null && temperature == null && humidity == null) return "";
  const status = nodeHealthStatusCode(node);
  const sample = nodeHealthSampleText(node);
  return `<span class="node-tooltip-health ${status}">
    ${battery == null ? "" : batteryStatusIcon(status)}
    ${battery == null ? "" : `<span>${escapeHtml(formatDecimal(battery / 1000, 2))} V</span>`}
    ${temperature == null ? "" : `${THERMOMETER_ICON}<span>${escapeHtml(formatDecimal(temperature, 1))} °C</span>`}
    ${humidity == null ? "" : `${HUMIDITY_ICON}<span>${escapeHtml(formatNumber(humidity))} %</span>`}
    ${sample ? `<span class="node-tooltip-sample">${escapeHtml(sample)}</span>` : ""}
  </span>`;
}

function nodeTooltip(node) {
  const key = String(node.public_key || "").toUpperCase();
  const coverId = state.photoCoverCache.get(key);
  const photo = coverId
    ? `<img class="node-tooltip-photo" src="${appPath(`/api/photos/${encodeURIComponent(coverId)}`)}" alt="" loading="lazy" decoding="async" />`
    : "";
  const prefix = shortNodePrefix(node);
  const identity = [escapeHtml(roleLabel(node.role)), prefix ? `<span class="node-tooltip-prefix">${escapeHtml(prefix)}</span>` : ""]
    .filter(Boolean)
    .join(" · ");
  const archiveHint = state.routeWindowMs
    ? `<small class="node-tooltip-hint">${escapeHtml(t("archive.nodeHint"))}</small>`
    : "";
  return `<span class="node-tooltip-body">${photo}<span><strong>${escapeHtml(node.name || t("common.unknownNode"))}</strong><br>${identity}${nodeNewBadge(node)}${nodeHealthTooltip(node)}${archiveHint}</span></span>`;
}

function refreshOpenNodePopup(entry) {
  const { marker, node } = entry;
  if (!marker.isPopupOpen()) return;
  const root = marker.getPopup().getElement();
  if (!root) return;
  const status = root.querySelector(".node-popup-card header > span");
  if (status) {
    const active = nodeIsActive(node, nowMs(), NODE_ACTIVE_MS);
    status.className = active ? "active" : "inactive";
    status.textContent = active ? t("common.active") : t("common.inactive");
  }
  updateNodeActivityDisplay(root, node);
  const lastRoute = root.querySelector(".node-last-route");
  if (lastRoute) lastRoute.outerHTML = nodeLastRoute(node);
  const neighbors = root.querySelector(".node-neighbors");
  if (neighbors) neighbors.outerHTML = nodeNeighbors(node);
  bindNodeRouteButton(root.querySelector(".node-route-show"), node);
  root.querySelectorAll(".node-neighbor").forEach(bindNodeNeighborButton);
}

function refreshOpenNodeDetailStatus() {
  if (!elements.nodeDetailPage.open || !state.nodeDetailKey) return;
  const node = state.nodeByKey.get(String(state.nodeDetailKey).toUpperCase());
  const status = elements.nodeDetailPage.querySelector(".node-detail-header > div > span");
  if (!node || !status) return;
  const active = nodeIsActive(node, nowMs(), NODE_ACTIVE_MS);
  status.className = active ? "active" : "inactive";
  status.textContent = active ? t("common.active") : t("common.inactive");
  updateNodeActivityDisplay(elements.nodeDetailPage, node);
  const lastRoute = elements.nodeDetailPage.querySelector(".node-last-route");
  if (lastRoute) {
    const next = nodeLastRoute(node);
    if (lastRoute.outerHTML !== next) {
      lastRoute.outerHTML = next;
      bindNodeRouteButton(elements.nodeDetailPage.querySelector(".node-route-show"), node);
    }
  }
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
  entry.active = nodeIsActive(node, nowMs(), NODE_ACTIVE_MS);
  if (validCoords(node.lat, node.lon)) marker.setLatLng([node.lat, node.lon]);
  marker.setTooltipContent(() => nodeTooltip(node));
  applyNodeStyle(entry, entry.tier);
  syncNodeHealthBadge(entry);
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
        openNodeEntry(entry);
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

function nodeObserverLastSeen(node) {
  const key = String(node.public_key || "").toUpperCase();
  const observer = state.observerByKey.get(key);
  const timestamp = Date.parse(observer?.last_seen || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function nodeActivityAt(node) {
  return Math.max(nodeLastActivity(node), nodeObserverLastSeen(node));
}

function updateNodeActivityDisplay(root, node) {
  for (const row of root.querySelectorAll(".node-popup-details dl div")) {
    const label = row.querySelector("dt")?.firstChild?.textContent?.trim();
    if (label !== t("node.lastActivity")) continue;
    const value = row.querySelector("dd");
    if (value) value.textContent = formatNodeDate(nodeActivityAt(node));
    break;
  }
}

function nodeIsActive(node, now = nowMs(), activeMs = NODE_ACTIVE_MS) {
  return now - nodeActivityAt(node) < activeMs;
}

function nodePassesFilters(node) {
  const key = String(node.public_key || "").toUpperCase();
  if (!isNodeRoleAllowed(node, state.allowedRoles)) return false;
  if (state.photosOnly && !state.photoNodeKeys.has(key)) return false;
  if (state.healthOnly) {
    if (!node.health) return false;
    if (!nodeHealthMatchesFilter(node, state.healthStatus)) return false;
  }
  if (state.inactiveOnly && nodeIsActive(node)) return false;
  return true;
}

function syncNodeHealthBadge(entry) {
  const node = entry?.node;
  const shouldShow = Boolean(state.healthOnly
    && node
    && node.health
    && validCoords(node.lat, node.lon)
    && nodePassesFilters(node));
  if (!shouldShow) {
    if (entry?.healthMarker) {
      healthLayer.removeLayer(entry.healthMarker);
      entry.healthMarker = null;
    }
    return;
  }
  const status = nodeHealthStatusCode(node);
  const title = nodeHealthMapTitle(node);
  const icon = L.divIcon({
    className: "node-health-map-icon",
    html: `<span class="node-health-map-badge ${status}" title="${escapeHtml(title)}">${batteryStatusIcon(status)}</span>`,
    iconAnchor: [-4, 4],
    iconSize: [20, 20],
  });
  const latlng = [node.lat, node.lon];
  if (entry.healthMarker) {
    entry.healthMarker.setLatLng(latlng);
    entry.healthMarker.setIcon(icon);
    return;
  }
  entry.healthMarker = L.marker(latlng, {
    icon,
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
  }).addTo(healthLayer);
}

function syncHealthBadges() {
  if (!state.healthOnly) {
    healthLayer.clearLayers();
    for (const entry of state.nodeMarkers) entry.healthMarker = null;
    return;
  }
  for (const entry of state.nodeMarkers) syncNodeHealthBadge(entry);
}

function addNodeMarker(node) {
  const active = nodeIsActive(node, nowMs(), NODE_ACTIVE_MS);
  const entry = { active, healthMarker: null, marker: null, node, shown: false, stackRole: node.role || "unknown", styleKey: nodeStyleKey(node, null), tier: null };
  const marker = L.circleMarker([node.lat, node.lon], {
    ...nodeMarkerStyle(node, null),
    pane: "markerPane",
  })
    .bindTooltip(() => nodeTooltip(node), {
      className: "node-tooltip",
    })
    .on("tooltipopen", (event) => {
      const image = event.tooltip.getElement()?.querySelector(".node-tooltip-photo");
      if (!image) return;
      const hideBroken = () => image.remove();
      if (image.complete && image.naturalWidth === 0) hideBroken();
      else image.addEventListener("error", hideBroken, { once: true });
    })
    .bindPopup(() => nodePopup(entry.node, nodeIsActive(entry.node, nowMs(), NODE_ACTIVE_MS)), {
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
      if (state.coverageMode) {
        marker.closePopup();
        void handleCoverageClick(marker.getLatLng());
        return;
      }
      if (state.losMode) {
        marker.closePopup();
        void handleLosClick(marker.getLatLng(), node);
        return;
      }
      const stack = nodeStackEntries(entry);
      if (stack.length > 1) openNodeStack(stack, marker.getLatLng());
      else openNodeEntry(entry);
    });
  marker.off("click", marker._openPopup, marker);
  const key = node.public_key?.toUpperCase();
  const allowed = nodePassesFilters(node);
  if (allowed) {
    marker.addTo(nodeLayer);
    applyNodeStacking(marker, node);
  }
  entry.marker = marker;
  entry.shown = allowed;
  state.nodeMarkers.push(entry);
  if (key) state.nodeMarkerByKey.set(key, entry);
  syncNodeHealthBadge(entry);
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
    ? Math.max(6, Math.min(MAX_MAP_ZOOM, INITIAL_ZOOM))
    : 11;
  map.setView(entry.marker.getLatLng(), zoom);
  openNodeEntry(entry);
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

function buildShareUrl(node = null) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("lat", map.getCenter().lat.toFixed(5));
  url.searchParams.set("lon", map.getCenter().lng.toFixed(5));
  url.searchParams.set("z", String(map.getZoom()));
  url.searchParams.set("roles", [...state.allowedRoles].join(","));
  url.searchParams.set("sizes", [...state.allowedHashBytes].sort((a, b) => a - b).join(","));
  url.searchParams.set("lang", getLocale());
  url.searchParams.set("base", activeBaseLayerKey);
  url.searchParams.set("retention", String(Math.round(state.retentionMs / 1000)));
  url.searchParams.set("other", state.showOtherPacketTypes ? "1" : "0");
  url.searchParams.set("labels", state.showNodeLabels ? "1" : "0");
  url.searchParams.set("hide", state.hideRoutes ? "1" : "0");
  url.searchParams.set("animate", state.animationEnabled ? "1" : "0");
  url.searchParams.set("photos", state.photosOnly ? "1" : "0");
  url.searchParams.set("health", state.healthOnly ? "1" : "0");
  if (state.healthOnly && state.healthStatus !== "all") url.searchParams.set("healthStatus", state.healthStatus);
  if (state.healthOnly && state.showHealthValues) {
    url.searchParams.set("healthValues", "1");
    url.searchParams.set("healthValue", state.healthValueMode);
  }
  url.searchParams.set("inactive", state.inactiveOnly ? "1" : "0");
  url.searchParams.set("observers", state.showObservers ? "1" : "0");
  if (state.animationMode === "svg") url.searchParams.set("anim", "svg");
  const windowValue = routeWindowParam(state.routeWindowMs);
  if (windowValue) url.searchParams.set("window", windowValue);
  if (node) url.searchParams.set("node", String(node.public_key || "").toUpperCase());
  return url.toString();
}

function shareUrlForNode(node) {
  return buildShareUrl(node);
}

function nodeStyleKey(node, tier) {
  return `${node.role || "unknown"}:${tier || "none"}:${isNewNode(node, nowMs()) ? "new" : "old"}`;
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
    const allowed = nodePassesFilters(entry.node);
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

function updateHealthLegend() {
  for (const element of document.querySelectorAll(".legend-health")) {
    element.hidden = !state.healthOnly;
  }
}

function applyNodeTiers() {
  const tiers = rankNodeTiers(state.nodeMarkers.map(({ node }) => node), nowMs(), NODE_RANKING_ACTIVE_MS);
  let top = 0;
  let second = 0;
  for (const tier of tiers.values()) {
    if (tier === "top") top += 1;
    else if (tier === "second") second += 1;
  }
  if (elements.legendTop) elements.legendTop.textContent = tCount("legend.top", top);
  if (elements.legendSecond) elements.legendSecond.textContent = tCount("legend.second", second);
  for (const entry of state.nodeMarkers) applyNodeStyle(entry, tiers.get(entry.node));
}

function refreshNodeState() {
  const now = nowMs();
  for (const entry of state.nodeMarkers) {
    const active = nodeIsActive(entry.node, now, NODE_ACTIVE_MS);
    if (entry.active !== active) {
      entry.active = active;
      scheduleOpenNodePopupRefresh(entry);
    }
  }
  applyNodeTiers();
  updateHealthLegend();
  refreshOpenNodeDetailStatus();
  applyNodeMembership();
  syncHealthBadges();
  statsPanel.renderStats();
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
const HEALTH_LABEL_GAP = 2;
const HEALTH_LABEL_COLUMNS = [0, -1, 1];
const HEALTH_LABEL_WIDE_COLUMNS = [2, -2];
const HEALTH_LABEL_MAX_ROWS = 4;
let labelRebuildTimer = null;
let labelRenderGeneration = 0;
let lastLabelSignature = null;

function scheduleNodeLabels() {
  clearTimeout(labelRebuildTimer);
  labelRebuildTimer = setTimeout(rebuildNodeLabels, 120);
}

function nodeMapHealthValue(node) {
  const { health, battery, temperature } = nodeHealthSnapshot(node);
  if (!health) return "";
  const batteryText = battery == null ? "" : `${formatDecimal(battery / 1000, 2)} V`;
  const temperatureText = temperature == null ? "" : `${formatDecimal(temperature, 1)} °C`;
  return state.healthValueMode === "voltage"
    ? (batteryText || temperatureText)
    : (temperatureText || batteryText);
}

function temperatureTone(temperature) {
  if (temperature == null) return "";
  if (temperature < 0) return "tone-cold";
  if (temperature > 40) return "tone-alert";
  return "";
}

function nodeMapHealthTone(node) {
  const { battery, temperature } = nodeHealthSnapshot(node);
  const status = nodeHealthStatusCode(node);
  const statusAlert = status === "warn" || status === "critical";
  if (state.healthValueMode === "voltage") {
    return battery == null ? temperatureTone(temperature) : (statusAlert ? "tone-alert" : "");
  }
  return temperature == null ? (statusAlert ? "tone-alert" : "") : temperatureTone(temperature);
}

function healthLabelsOverlap(a, b) {
  return a.left < b.right + HEALTH_LABEL_GAP
    && a.right + HEALTH_LABEL_GAP > b.left
    && a.top < b.bottom + HEALTH_LABEL_GAP
    && a.bottom + HEALTH_LABEL_GAP > b.top;
}

function findHealthLabelSlot(placed, rect, columns) {
  const stepX = rect.width + HEALTH_LABEL_GAP;
  const stepY = rect.height + HEALTH_LABEL_GAP;
  for (let row = 0; row < HEALTH_LABEL_MAX_ROWS; row += 1) {
    for (const column of columns) {
      const dx = column * stepX;
      const dy = -row * stepY;
      const box = {
        left: rect.left + dx,
        right: rect.right + dx,
        top: rect.top + dy,
        bottom: rect.bottom + dy,
      };
      if (!placed.some((other) => healthLabelsOverlap(box, other))) return { box, dx, dy };
    }
  }
  return null;
}

function resolveHealthLabelCollisions(markers, generation) {
  if (generation !== labelRenderGeneration) return;
  const placed = [];
  for (const marker of markers) {
    const element = marker.getElement();
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const slot = findHealthLabelSlot(placed, rect, HEALTH_LABEL_COLUMNS)
      || findHealthLabelSlot(placed, rect, HEALTH_LABEL_WIDE_COLUMNS);
    if (!slot) {
      element.style.display = "none";
      continue;
    }
    if (slot.dx) {
      const baseMarginLeft = Number.parseFloat(element.style.marginLeft) || 0;
      element.style.marginLeft = `${baseMarginLeft + slot.dx}px`;
    }
    if (slot.dy) {
      const baseMarginTop = Number.parseFloat(element.style.marginTop) || 0;
      element.style.marginTop = `${baseMarginTop + slot.dy}px`;
    }
    placed.push(slot.box);
  }
}

function rebuildNodeLabels() {
  const showHealthValues = state.healthOnly && state.showHealthValues;
  if ((!state.showNodeLabels && !showHealthValues) || (!showHealthValues && map.getZoom() < LABEL_MIN_ZOOM)) {
    if (nodeLabelLayer.getLayers().length) nodeLabelLayer.clearLayers();
    labelRenderGeneration += 1;
    lastLabelSignature = null;
    return;
  }
  const bounds = map.getBounds().pad(0.15);
  const labels = [];
  for (const entry of state.nodeMarkers) {
    if (labels.length >= LABEL_MAX) break;
    const { node } = entry;
    if (!node.name) continue;
    if (!nodePassesFilters(node)) continue;
    if (!validCoords(node.lat, node.lon)) continue;
    if (!bounds.contains([node.lat, node.lon])) continue;
    const value = showHealthValues ? nodeMapHealthValue(node) : "";
    if (showHealthValues && !value) continue;
    labels.push({ node, tone: showHealthValues ? nodeMapHealthTone(node) : "", value });
  }
  const size = map.getSize();
  const signature = JSON.stringify([
    showHealthValues,
    map.getZoom(),
    size.x,
    size.y,
    document.documentElement.dataset.fontSize || "",
    labels.map(({ node, tone, value }) => [node.public_key, node.lat, node.lon, value, tone, node.name]),
  ]);
  if (signature === lastLabelSignature && nodeLabelLayer.getLayers().length === labels.length) return;
  lastLabelSignature = signature;
  nodeLabelLayer.clearLayers();
  labelRenderGeneration += 1;
  const generation = labelRenderGeneration;
  const healthMarkers = [];
  for (const { node, tone, value } of labels) {
    const html = showHealthValues
      ? `<span class="node-label-values${tone ? ` ${tone}` : ""}">${escapeHtml(value)}</span>`
      : escapeHtml(node.name);
    const marker = L.marker([node.lat, node.lon], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: showHealthValues ? "node-label node-label-health" : "node-label",
        html,
        iconSize: null,
        iconAnchor: showHealthValues ? [-6, 28] : [-9, 10],
      }),
    }).addTo(nodeLabelLayer);
    if (showHealthValues) healthMarkers.push(marker);
  }
  if (healthMarkers.length > 1) {
    setTimeout(() => resolveHealthLabelCollisions(healthMarkers, generation), 0);
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
      if (entry.healthMarker) healthLayer.removeLayer(entry.healthMarker);
      state.nodeMarkerByKey.delete(key);
      state.nodeMarkers = state.nodeMarkers.filter((candidate) => candidate !== entry);
    }
  }
  scheduleNodeRefresh();
}

let nodeRefreshPromise = null;
async function loadNodes() {
  if (nodeRefreshPromise) return nodeRefreshPromise;
  nodeRefreshPromise = (async () => {
    try {
      const { data, response } = await getJsonWithResponse("/api/nodes?limit=2000");
      setDataFreshness(response.headers.get("X-Data-Stale") === "1");
      syncNodes(data.nodes || []);
      applyInitialNode();
      applyInitialDetail();
      if (!state.routeHistoryLoaded && packetHandlingReady) void loadRouteHistory();
      return true;
    } catch (error) {
      console.error("Nody se nepodařilo načíst", error);
      return false;
    }
  })();
  try {
    return await nodeRefreshPromise;
  } finally {
    nodeRefreshPromise = null;
  }
}

let statsRefreshActive = false;
let statsRetryTimer = null;
async function loadStats() {
  if (statsRefreshActive) return;
  statsRefreshActive = true;
  try {
    const { data, response } = await getJsonWithResponse("/api/stats");
    elements.packetRate.textContent = formatNumber(Number(data.packetsLastHour || 0));
    const stale = response.headers.get("X-Data-Stale") === "1";
    const partial = data.partial === true;
    elements.packetRate.classList.toggle("metric-stale", stale || partial);
    elements.packetRate.title = partial
      ? t("stats.localValue")
      : stale ? t("stats.staleValue") : "";
    if (statsRetryTimer != null) {
      clearTimeout(statsRetryTimer);
      statsRetryTimer = null;
    }
    if ((partial || stale) && statsRetryTimer == null) {
      statsRetryTimer = setTimeout(() => {
        statsRetryTimer = null;
        void loadStats();
      }, 60_000);
    }
    if (!partial) statsPanel.setNetworkStats(data);
  } catch (error) {
    console.error("Statistiky se nepodařilo načíst", error);
    if (statsRetryTimer == null) {
      statsRetryTimer = setTimeout(() => {
        statsRetryTimer = null;
        void loadStats();
      }, 60_000);
    }
  } finally {
    statsRefreshActive = false;
  }
}

let networkTrendLoadedAt = 0;
let networkTrendLoading = false;

function renderNetworkTrend(series) {
  const points = Array.isArray(series) ? series : [];
  const chart = elements.statsNetworkTrendChart;
  chart.replaceChildren();
  chart.setAttribute("aria-label", t("stats.networkTrendAria"));
  const width = 300;
  const height = 64;
  const pad = 5;
  const values = points.flatMap((point) => [
    point.nodes == null ? null : Number(point.nodes),
    point.observers == null ? null : Number(point.observers),
  ]).filter((value) => Number.isFinite(value));
  if (!values.length) {
    const empty = svgNode("text", { class: "trend-empty", x: width / 2, y: height / 2, "text-anchor": "middle" });
    empty.textContent = t("stats.networkTrendEmpty");
    chart.appendChild(empty);
    elements.statsNetworkTrendSummary.textContent = "";
    elements.statsNetworkTrend.hidden = false;
    return;
  }
  const maxValue = Math.max(1, ...values);
  const x = (index) => pad + (points.length <= 1 ? 0 : (index / (points.length - 1)) * (width - pad * 2));
  const y = (value) => height - pad - (value / maxValue) * (height - pad * 2);
  for (const ratio of [0.5, 1]) {
    const lineY = height - pad - ratio * (height - pad * 2);
    chart.appendChild(svgNode("line", {
      class: "trend-grid",
      x1: pad,
      x2: width - pad,
      y1: lineY,
      y2: lineY,
    }));
  }
  const linePath = (key) => {
    let path = "";
    let drawing = false;
    points.forEach((point, index) => {
      const value = point[key] == null ? NaN : Number(point[key]);
      if (!Number.isFinite(value)) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      drawing = true;
    });
    return path;
  };
  chart.appendChild(svgNode("path", {
    class: "trend-line-observers",
    d: linePath("observers"),
    fill: "none",
  }));
  chart.appendChild(svgNode("path", {
    class: "trend-line-nodes",
    d: linePath("nodes"),
    fill: "none",
  }));
  const latest = (key) => {
    for (let index = points.length - 1; index >= 0; index -= 1) {
      if (points[index][key] != null && Number.isFinite(Number(points[index][key]))) return Number(points[index][key]);
    }
    return null;
  };
  elements.statsNetworkTrendSummary.textContent = t("stats.networkTrendSummary", {
    nodes: latest("nodes") == null ? "—" : formatNumber(latest("nodes")),
    observers: latest("observers") == null ? "—" : formatNumber(latest("observers")),
  });
  elements.statsNetworkTrend.hidden = false;
}

async function loadNetworkTrend(force = false) {
  if (networkTrendLoading) return;
  if (!force && networkTrendLoadedAt && Date.now() - networkTrendLoadedAt < 5 * 60_000) return;
  networkTrendLoading = true;
  try {
    const data = await getJson("/api/packet-history?hours=168");
    renderNetworkTrend(data.series || []);
    networkTrendLoadedAt = Date.now();
  } catch (error) {
    console.error("Trend sítě se nepodařilo načíst", error);
  } finally {
    networkTrendLoading = false;
  }
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function renderPacketHistory(series, hours, granularity = "hour") {
  elements.packetHistoryChart.replaceChildren();
  elements.packetHistoryHover.textContent = "";
  elements.packetHistoryNote.textContent = granularity === "day"
    ? t("packetHistory.noteDaily")
    : t("packetHistory.note");
  const points = Array.isArray(series) ? series : [];
  const values = points.map((point) => (point.packets == null ? null : Number(point.packets)));
  const present = values.filter((value) => value != null);
  if (!points.length || !present.length) {
    const empty = document.createElement("div");
    empty.className = "packet-history-empty";
    empty.textContent = t("packetHistory.empty");
    elements.packetHistoryChart.appendChild(empty);
    elements.packetHistorySummary.textContent = "";
    return;
  }
  const total = present.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(0, ...present);
  const average = Math.round(total / present.length);
  elements.packetHistorySummary.textContent = granularity === "day"
    ? `${t("packetHistory.summaryDaily", {
      avg: formatNumber(average),
      peak: formatNumber(Math.round(peak)),
    })} · ${t("packetHistory.coveragePeriod", { count: present.length, total: points.length })}`
    : `${t("packetHistory.summary", {
      avg: formatNumber(average),
      peak: formatNumber(Math.round(peak)),
      total: formatNumber(total),
    })} · ${tCount("packetHistory.coverage", present.length, { hours: points.length })}`;
  const width = 640;
  const height = 200;
  const left = 38;
  const right = 12;
  const top = 12;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, peak);
  const x = (index) => left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value) => top + plotHeight - (value / maxValue) * plotHeight;
  const svg = svgNode("svg", {
    "aria-label": t("packetHistory.title"),
    role: "img",
    viewBox: `0 0 ${width} ${height}`,
  });
  for (const ratio of [0, 0.5, 1]) {
    const lineY = top + plotHeight * (1 - ratio);
    svg.appendChild(svgNode("line", {
      class: "packet-history-grid",
      x1: left,
      x2: width - right,
      y1: lineY,
      y2: lineY,
    }));
    const label = svgNode("text", {
      "text-anchor": "end",
      class: "packet-history-axis",
      x: left - 5,
      y: lineY + 3,
    });
    label.textContent = formatNumber(Math.round(maxValue * ratio));
    svg.appendChild(label);
  }
  const step = granularity === "day"
    ? Math.max(1, Math.ceil(points.length / 8))
    : (hours > 48 ? 24 : 6);
  for (let index = 0; index < points.length; index += step) {
    const label = svgNode("text", {
      "text-anchor": "middle",
      class: "packet-history-axis",
      x: x(index),
      y: height - 6,
    });
    label.textContent = granularity === "day" || hours > 48
      ? formatDate(new Date(points[index].hour))
      : `${String(new Date(points[index].hour).getHours()).padStart(2, "0")}:00`;
    svg.appendChild(label);
  }
  const segments = [];
  let segment = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] == null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else {
      segment.push(index);
    }
  }
  if (segment.length) segments.push(segment);
  for (const indexes of segments) {
    if (indexes.length >= 2) {
      const area = [`M ${x(indexes[0])} ${top + plotHeight}`];
      for (const index of indexes) area.push(`L ${x(index)} ${y(values[index])}`);
      area.push(`L ${x(indexes.at(-1))} ${top + plotHeight}`, "Z");
      svg.appendChild(svgNode("path", { class: "packet-history-area", d: area.join(" ") }));
      const line = [`M ${x(indexes[0])} ${y(values[indexes[0]])}`];
      for (let offset = 1; offset < indexes.length; offset += 1) {
        line.push(`L ${x(indexes[offset])} ${y(values[indexes[offset]])}`);
      }
      svg.appendChild(svgNode("path", { class: "packet-history-line", d: line.join(" ") }));
    }
    if (indexes.length === 1 || points.length <= 48) {
      for (const index of indexes) {
        svg.appendChild(svgNode("circle", {
          class: "packet-history-dot",
          cx: x(index),
          cy: y(values[index]),
          r: 2.5,
        }));
      }
    }
  }
  const cursor = svgNode("line", {
    class: "packet-history-cursor",
    style: "display:none",
    x1: x(0),
    x2: x(0),
    y1: top,
    y2: top + plotHeight,
  });
  svg.appendChild(cursor);
  svg.appendChild(svgNode("rect", {
    fill: "transparent",
    height: plotHeight,
    width: plotWidth,
    x: left,
    y: top,
  }));
  svg.addEventListener("mousemove", (event) => {
    const rect = svg.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = Math.min(1, Math.max(0, (localX - left) / plotWidth));
    const index = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
    const point = points[index];
    const value = values[index];
    const timeLabel = granularity === "day" ? formatDate(new Date(point.hour)) : formatDateTimeShort(point.hour);
    elements.packetHistoryHover.textContent = value == null
      ? t("packetHistory.noSample", { time: timeLabel })
      : t("packetHistory.hover", {
        packets: formatNumber(value),
        time: timeLabel,
      });
    cursor.setAttribute("x1", x(index));
    cursor.setAttribute("x2", x(index));
    cursor.style.display = "";
  });
  svg.addEventListener("mouseleave", () => {
    cursor.style.display = "none";
    elements.packetHistoryHover.textContent = "";
  });
  elements.packetHistoryChart.appendChild(svg);
}

async function loadPacketHistory(hours) {
  const allowed = [24, 168, 720, 8760];
  const requested = Number(hours);
  const nextHours = allowed.includes(requested) ? requested : 24;
  state.packetHistoryHours = nextHours;
  for (const button of elements.packetHistoryWindows) {
    button.classList.toggle("active", Number(button.dataset.hours) === nextHours);
  }
  const requestId = ++state.packetHistoryRequestId;
  elements.packetHistorySummary.textContent = t("packetHistory.loading");
  elements.packetHistoryChart.replaceChildren();
  elements.packetHistoryHover.textContent = "";
  try {
    const data = await getJson(`/api/packet-history?hours=${nextHours}`);
    if (requestId !== state.packetHistoryRequestId) return;
    renderPacketHistory(data.series || [], nextHours, data.granularity || "hour");
  } catch (error) {
    if (requestId !== state.packetHistoryRequestId) return;
    console.error("Historii paketů se nepodařilo načíst", error);
    elements.packetHistorySummary.textContent = t("packetHistory.failed");
  }
}

function openPacketHistory() {
  if (!elements.packetHistoryDialog.open) elements.packetHistoryDialog.showModal();
  void loadPacketHistory(state.packetHistoryHours);
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

function packetPoints(packet, path, hashBytes = packetPathHashBytes(packet, path)) {
  const maxHopKm = maxRouteHopKm(hashBytes);
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

  const observerKey = (packet.observer_id || "").toUpperCase();
  const observerNode = state.nodeByKey.get(observerKey);
  const isDirectRoute = [2, 3].includes(Number(packet.route_type));
  const observerPoint = observerNode && validCoords(observerNode.lat, observerNode.lon)
    ? { lat: observerNode.lat, lon: observerNode.lon }
    : observerAnchor(packet.observer_iata);
  const end = observerPoint;

  let block = [];
  const blocks = [];
  for (const prefix of path) {
    const resolved = state.prefixCache.get(prefix);
    const candidates = (resolved?.candidates || []).filter((candidate) => (
      validCoords(candidate.lat, candidate.lon)
    ));
    if (!candidates.length) {
      if (block.length) blocks.push(block);
      block = [];
      breakNext = true;
      continue;
    }
    block.push(candidates);
  }
  if (block.length) blocks.push(block);

  for (const candidateSets of blocks) {
    const last = points.at(-1);
    const start = last ? { lat: last.lat, lon: last.lon } : null;
    let chain = resolveCandidateChain(candidateSets, { maxHopKm, start, end });
    if (!chain && end) chain = resolveCandidateChain(candidateSets, { maxHopKm, start });
    if (!chain) {
      breakNext = true;
      continue;
    }
    for (const candidate of chain) {
      const previous = points.at(-1);
      if (previous && previous.lat === candidate.lat && previous.lon === candidate.lon) continue;
      pushPoint(
        candidate.lat,
        candidate.lon,
        candidate.name || candidate.pubkey || t("common.unknownShort"),
        candidate.pubkey || candidate.public_key,
      );
    }
  }

  if (!isDirectRoute && observerKey.length >= 4 && observerNode && validCoords(observerNode.lat, observerNode.lon)) {
    const last = points.at(-1);
    const plausibleDistance = !last
      || haversineKm(last, observerNode) <= maxHopKm;
    const distinct = !last || last.lat !== observerNode.lat || last.lon !== observerNode.lon;
    if (plausibleDistance && distinct) {
      pushPoint(observerNode.lat, observerNode.lon, observerNode.name || packet.observer_name || "Observer", observerNode.public_key);
    } else if (!plausibleDistance) {
      breakNext = true;
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

function routeAnomalies(route) {
  const points = route?.points || [];
  const anomalies = [];
  let longest = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (point.breakBefore) continue;
    longest = Math.max(longest, haversineKm(previous, point));
  }
  if (longest > 140) anomalies.push(t("anomaly.longHop", { distance: formatDecimal(longest, 0) }));
  const seen = new Set();
  for (const point of points) {
    const key = String(point.publicKey || `${point.name}|${point.lat}|${point.lon}`).toUpperCase();
    if (seen.has(key)) {
      anomalies.push(t("anomaly.loop", { name: point.name || t("common.unknownShort") }));
      break;
    }
    seen.add(key);
  }
  if (points.length - 1 > 20) anomalies.push(t("anomaly.manyHops", { count: points.length - 1 }));
  return anomalies;
}

function routeColor(packetType) {
  return ROUTE_COLORS[packetType] || ROUTE_COLORS.default;
}

function historyRoutePoints(packet, hashBytes = packetPathHashBytes(packet)) {
  const maxHopKm = maxRouteHopKm(hashBytes);
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
    const previous = points.at(-1);
    if (previous && haversineKm(previous, node) > maxHopKm) {
      breakNext = true;
      continue;
    }
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
  const snr = Number(packet.snr);
  const rssi = Number(packet.rssi);
  const decoded = parseDecoded(packet);
  const traceTag = Number(packet.payload_type) === 9 && decoded.tag != null ? String(decoded.tag) : null;
  return {
    bounds: L.latLngBounds(points.map((point) => [point.lat, point.lon])),
    color,
    createdAt,
    from: points[0].name || t("common.unknownShort"),
    hashBytes,
    id,
    nodeCount: points.length,
    observerCount: Number(packet.observer_count || 1),
    observerId: String(packet.observer_id || "").toUpperCase(),
    observerName: String(packet.observer_name || "").trim() || null,
    packetHash: String(packet.hash || "").toUpperCase(),
    packetType: packet.payload_type,
    points: points.map(({ lat, lon, name, publicKey, breakBefore }) => ({
      lat,
      lon,
      name,
      publicKey,
      breakBefore: Boolean(breakBefore),
    })),
    rssi: Number.isFinite(rssi) ? rssi : null,
    scope: String(packet.scope_name || "").trim() || null,
    snr: Number.isFinite(snr) ? snr : null,
    snrValues: packetSnrValues(packet),
    timestamp,
    to: points.at(-1).name || t("common.unknownShort"),
    traceTag,
    typeLabel,
    versionId,
  };
}

async function historyRoutesFromPackets(packets) {
  const pendingPrefixes = new Set();
  for (const packet of packets) {
    const resolved = Array.isArray(packet.resolved_path) ? packet.resolved_path : [];
    if (resolved.some(Boolean)) continue;
    for (const prefix of parsePath(packet)) pendingPrefixes.add(prefix);
  }
  if (pendingPrefixes.size) await resolvePrefixes([...pendingPrefixes]);

  const routes = [];
  for (const packet of packets) {
    const path = parsePath(packet);
    const hashBytes = packetPathHashBytes(packet, path);
    if (!path.length) continue;
    const resolved = Array.isArray(packet.resolved_path) ? packet.resolved_path : [];
    const points = resolved.some(Boolean) ? historyRoutePoints(packet, hashBytes) : packetPoints(packet, path, hashBytes);
    if (!routeSegments(points).length) continue;
    const id = `${packet.hash || packet.id}:${packet.observer_id || "history"}`;
    routes.push(routeRecord(
      packet,
      points,
      hashBytes,
      id,
      `history:${packet.id || id}`,
      routeTimestamp(packet, 0),
    ));
  }
  return routes;
}

async function loadRouteHistory() {
  if (state.routeHistoryLoaded || state.routeHistoryLoading) return;
  state.routeHistoryLoading = true;
  try {
    const data = await getJson(`/api/packets?limit=${ROUTE_HISTORY_LIMIT}`);
    const packets = (data.packets || []).slice().sort((a, b) => Number(b.id) - Number(a.id));
    for (const route of await historyRoutesFromPackets(packets)) routeStore.addHistory(route);
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

function scheduleSnrLabels(delay = 250) {
  clearTimeout(snrLabelTimer);
  snrLabelTimer = setTimeout(() => {
    snrLabelTimer = null;
    rebuildSnrLabels();
  }, delay);
}

function rebuildSnrLabels() {
  if (routesSuppressed() || map.getZoom() < LABEL_MIN_ZOOM) {
    snrLabelLayer.clearLayers();
    snrLabelSignature = "";
    return;
  }
  const viewport = map.getBounds().pad(0.05);
  const source = state.routeWindowMs === 0
    ? routeStore.visibleLive(state, nowMs())
    : [...state.archiveRoutes.values()];
  const routes = source
    .filter((route) => Number(route.packetType) === 9 && route.snrValues?.length >= 1)
    .filter((route) => routeVisibleIn(viewport, route));
  const signature = routes
    .map((route) => `${route.id}:${route.versionId}`)
    .sort()
    .join("|")
    + `|${state.routeWindowMs}|${map.getZoom()}|${map.getCenter().lat.toFixed(3)},${map.getCenter().lng.toFixed(3)}`;
  if (signature === snrLabelSignature) return;
  snrLabelSignature = signature;
  snrLabelLayer.clearLayers();
  let count = 0;
  for (const route of routes) {
    for (let index = 1; index < route.points.length; index += 1) {
      if (count >= 150) return;
      const previous = route.points[index - 1];
      const point = route.points[index];
      if (point.breakBefore) continue;
      if (index - 1 >= route.snrValues.length) continue;
      const snr = Number(route.snrValues[index - 1]);
      if (!Number.isFinite(snr)) continue;
      const tone = snr >= SNR_GOOD_DB ? "good" : snr >= SNR_FAIR_DB ? "fair" : "bad";
      L.marker(
        [previous.lat + (point.lat - previous.lat) * 0.55, previous.lon + (point.lon - previous.lon) * 0.55],
        {
          icon: L.divIcon({
            className: `route-snr-label ${tone}`,
            html: `${formatDecimal(snr, 1)} dB`,
            iconAnchor: [28, 9],
            iconSize: [56, 18],
          }),
          interactive: false,
          keyboard: false,
          pane: "snrLabelPane",
        },
      ).addTo(snrLabelLayer);
      count += 1;
    }
  }
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
  const breakMarkers = [];
  const traceWithSnr = Number(route.packetType) === 9 && snrValues.length > 0;

  if (traceWithSnr) {
    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1];
      const point = route.points[index];
      if (point.breakBefore) {
        if (!archive) {
          const marker = L.marker(
            [(previous.lat + point.lat) / 2, (previous.lon + point.lon) / 2],
            {
              icon: L.divIcon({
                className: "route-break-marker",
                html: "?",
                iconAnchor: [8, 8],
                iconSize: [16, 16],
              }),
            },
          ).bindTooltip(t("route.breakUnknown"), {
            className: "node-tooltip",
            direction: "top",
          }).addTo(group);
          breakMarkers.push(marker);
        }
        continue;
      }
      const snr = index - 1 < snrValues.length ? Number(snrValues[index - 1]) : null;
      lines.push(L.polyline([[previous.lat, previous.lon], [point.lat, point.lon]], {
        renderer: layerRenderer,
        color: Number.isFinite(snr) ? snrColor(snr) : route.color,
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
    if (!archive) {
      for (let index = 1; index < route.points.length; index += 1) {
        const previous = route.points[index - 1];
        const point = route.points[index];
        if (!point.breakBefore) continue;
        const marker = L.marker(
          [(previous.lat + point.lat) / 2, (previous.lon + point.lon) / 2],
          {
            icon: L.divIcon({
              className: "route-break-marker",
              html: "?",
              iconAnchor: [8, 8],
              iconSize: [16, 16],
            }),
          },
        ).bindTooltip(t("route.breakUnknown"), {
          className: "node-tooltip",
          direction: "top",
        }).addTo(group);
        breakMarkers.push(marker);
      }
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
  for (const marker of breakMarkers) marker.on("click", openDetail);
  endpoint.on("click", openDetail);

  return { endpoint, group, line: lines[0], lines, versionId: route.versionId };
}

let routeCacheSavedAt = 0;

function saveRouteCache(routes) {
  if (state.routeWindowMs !== 0 || !routes?.length) return;
  const now = Date.now();
  if (now - routeCacheSavedAt < ROUTE_CACHE_SAVE_MS) return;
  routeCacheSavedAt = now;
  const payload = {
    savedAt: now,
    v: ROUTE_CACHE_VERSION,
    routes: routes.slice(0, ROUTE_CACHE_MAX).map((route) => ({
      color: route.color,
      createdAt: route.createdAt,
      from: route.from,
      hashBytes: route.hashBytes,
      id: route.id,
      nodeCount: route.nodeCount,
      observerCount: route.observerCount,
      observerId: route.observerId,
      observerName: route.observerName,
      packetHash: route.packetHash,
      packetType: route.packetType,
      points: route.points,
      rssi: route.rssi,
      scope: route.scope,
      snr: route.snr,
      snrValues: route.snrValues,
      timestamp: route.timestamp,
      to: route.to,
      traceObserverCount: route.traceObserverCount,
      traceObservations: route.traceObservations,
      traceTag: route.traceTag,
      typeLabel: route.typeLabel,
      versionId: route.versionId,
    })),
  };
  try {
    localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    try {
      localStorage.removeItem(ROUTE_CACHE_KEY);
    } catch {}
  }
}

function clearCachedRoutes() {
  if (!state.cachedRendered.length && !state.cachedRoutes.length) return;
  for (const rendered of state.cachedRendered) routeLayer.removeLayer(rendered.group);
  state.cachedRendered = [];
  state.cachedRoutes = [];
  elements.routeCacheBadge.hidden = true;
  updateRouteCount();
  updateMapStatus();
}

function restoreRouteCache() {
  if (state.routeWindowMs !== 0) return;
  let cache;
  try {
    cache = JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY) || "null");
  } catch {
    return;
  }
  if (!cache || cache.v !== ROUTE_CACHE_VERSION || !Array.isArray(cache.routes) || !cache.routes.length) return;
  const savedAt = Number(cache.savedAt) || 0;
  const age = Date.now() - savedAt;
  if (!(age >= 0 && age <= ROUTE_CACHE_TTL_MS)) {
    try {
      localStorage.removeItem(ROUTE_CACHE_KEY);
    } catch {}
    return;
  }
  const routes = [];
  const rendered = [];
  for (const stored of cache.routes.slice(0, ROUTE_CACHE_MAX)) {
    if (!stored || !Array.isArray(stored.points) || stored.points.length < 2) continue;
    if (stored.points.some((point) => !validCoords(point.lat, point.lon))) continue;
    const route = {
      ...stored,
      bounds: L.latLngBounds(stored.points.map((point) => [point.lat, point.lon])),
    };
    const view = renderRoute(route, { archive: true });
    if (!view) continue;
    routes.push(route);
    rendered.push(view);
  }
  if (!routes.length) return;
  state.cachedRoutes = routes;
  state.cachedRendered = rendered;
  elements.routeCacheBadge.textContent = t("cache.routes", { age: formatNodeDate(savedAt) });
  elements.routeCacheBadge.hidden = false;
  updateRouteCount();
  updateMapStatus();
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
  mode: "live",
  historyLoadedAt: 0,
  historyLoading: false,
  historyRoutes: [],
  channelMessages: [],
  channelFilter: "",
  channelsFailedAt: 0,
  channelsLoadedAt: 0,
  channelsLoading: false,
  pendingVersions: new Set(),
  renderTimer: null,
  resumeTimer: null,
};

function setFeedBadge() {
  if (feedState.mode !== "live") {
    elements.activityNew.hidden = true;
    return;
  }
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

function groupFeedRoutes(routes, limit = MAX_FEED_ITEMS) {
  const groups = new Map();
  for (const route of routes) {
    const key = route.packetHash || `${route.typeLabel}|${route.from}|${route.to}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.add(route.id);
      existing.count = existing.ids.size;
      if (route.timestamp > existing.route.timestamp) existing.route = route;
    } else {
      groups.set(key, { ids: new Set([route.id]), route, count: 1 });
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.route.timestamp - a.route.timestamp)
    .slice(0, limit);
}

function renderFeedNow(groups, emptyText, { history = false } = {}) {
  if (!groups.length) {
    const empty = document.createElement("li");
    empty.className = "feed-empty";
    empty.textContent = emptyText;
    elements.feed.replaceChildren(empty);
    return;
  }
  elements.feed.replaceChildren(...groups.map(({ route, count }) => {
    const item = document.createElement("li");
    const observations = Math.max(count, Number(route.traceObservations) || 1);
    const observers = Math.max(count, Number(route.traceObserverCount) || 1);
    item.dataset.hashBytes = String(route.hashBytes);
    item.dataset.packetHash = route.packetHash || "";
    item.dataset.packetType = String(route.packetType);
    item.style.setProperty("--route-color", route.color);
    const when = history ? formatDateTimeShort(route.timestamp) : formatTime(route.timestamp);
    item.innerHTML = `
      <div>
        <b>${escapeHtml(route.typeLabel)}</b>
        ${observations > 1 ? `<span class="feed-count">×${observations}</span>` : ""}
        <time>${escapeHtml(when)}</time>
      </div>
      <p>${escapeHtml(route.from)} <span>→</span> ${escapeHtml(route.to)}</p>
      <small>${route.scope?.trim() ? `${escapeHtml(route.scope.trim())} · ` : ""}${formatHops(Math.max(1, route.points.length - 1))} · ${route.hashBytes}B · ${formatObservers(observers)}${observations > 1 ? ` · ${tCount("units.observations", observations)}` : ""}</small>
    `;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.title = t("route.clickHint");
    const openDetail = (event) => {
      event?.preventDefault();
      event?.stopPropagation();
      openPacketDetail(route, route.bounds?.isValid() ? route.bounds.getCenter() : null);
    };
    item.addEventListener("click", openDetail);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openDetail(event);
    });
    return item;
  }));
}

function flushFeed(force = false) {
  if (feedState.mode !== "live") return;
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
  const signature = `${feedState.latestEmptyText}|${groups.map(({ route, count }) => `${route.versionId || route.id}:${count}:${route.traceObservations || 1}`).join("|")}`;
  feedState.lastRenderAt = Date.now();
  feedState.lastRenderedVersions = new Set(feedState.latestRoutes.map((route) => route.versionId || route.id));
  feedState.pendingVersions.clear();
  setFeedBadge();
  if (signature === feedState.lastSignature) return;
  feedState.lastSignature = signature;
  renderFeedNow(groups, feedState.latestEmptyText);
}

function updateFeed(routes, emptyText = t("feed.empty"), { immediate = false } = {}) {
  if (feedState.mode !== "live") return;
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

function filteredHistoryRoutes() {
  const query = elements.historySearch.value.trim().toLowerCase();
  const type = elements.historyType.value;
  const cutoff = Date.now() - Number(elements.historyWindow.value);
  return feedState.historyRoutes.filter((route) => {
    if (route.timestamp < cutoff) return false;
    if (elements.historyAnomalies.checked && !routeAnomalies(route).length) return false;
    if (type === "other") {
      if ([2, 4, 5, 9].includes(Number(route.packetType))) return false;
    } else if (type && Number(route.packetType) !== Number(type)) {
      return false;
    }
    if (!query) return true;
    const text = [
      route.packetHash,
      route.from,
      route.to,
      route.observerName,
      route.observerId,
      route.scope,
    ].filter(Boolean).join(" ").toLowerCase();
    return text.includes(query);
  });
}

function renderHistoryFeed() {
  const routes = filteredHistoryRoutes()
    .filter((route) => isRouteVisible(route.packetType, route.hashBytes, state));
  const groups = groupFeedRoutes(routes, HISTORY_FEED_ITEMS);
  elements.activityTitleText.textContent = `${t("activity.historyTitle")} (${formatNumber(groups.length)})`;
  renderFeedNow(groups, t("activity.historyEmpty"), { history: true });
}

async function loadHistoryFeed(force = false) {
  if (feedState.historyLoading) return;
  if (!force && feedState.historyLoadedAt && Date.now() - feedState.historyLoadedAt < 60_000) {
    renderHistoryFeed();
    return;
  }
  feedState.historyLoading = true;
  renderFeedNow([], t("activity.historyLoading"), { history: true });
  try {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const data = await getJson(`/api/history?since=${since}&limit=${HISTORY_SOURCE_LIMIT}`);
    feedState.historyRoutes = await historyRoutesFromPackets(data.packets || []);
    feedState.historyLoadedAt = Date.now();
    renderHistoryFeed();
  } catch (error) {
    console.error("Historii paketů se nepodařilo načíst", error);
    renderFeedNow([], t("activity.historyFailed"), { history: true });
  } finally {
    feedState.historyLoading = false;
  }
}

function renderChannelFeed() {
  const allMessages = feedState.channelMessages;
  const counts = new Map();
  for (const message of allMessages) counts.set(message.channel, (counts.get(message.channel) || 0) + 1);
  if (feedState.channelFilter && !counts.has(feedState.channelFilter)) feedState.channelFilter = "";
  const messages = feedState.channelFilter
    ? allMessages.filter((message) => message.channel === feedState.channelFilter)
    : allMessages;

  elements.channelTabs.replaceChildren(...[
    { channel: "", label: t("activity.channelsAll"), count: allMessages.length },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([channel, count]) => ({ channel, label: channel, count })),
  ].map(({ channel, label, count }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${label} (${count})`;
    button.classList.toggle("active", feedState.channelFilter === channel);
    button.addEventListener("click", () => {
      feedState.channelFilter = channel;
      renderChannelFeed();
    });
    return button;
  }));

  elements.activityTitleText.textContent = `${t("activity.channelsTitle")} (${formatNumber(messages.length)})`;
  if (!messages.length) {
    renderFeedNow([], t("activity.channelsEmpty"), { history: true });
    return;
  }
  elements.feed.replaceChildren(...messages.slice(0, 200).map((message) => {
    const item = document.createElement("li");
    item.className = "channel-feed-item";
    item.dataset.packetHash = message.hash;
    item.innerHTML = `
      <div>
        <b>${escapeHtml(message.channel)}</b>
        <time>${escapeHtml(formatDateTimeShort(message.timestamp))}</time>
      </div>
      <p class="channel-text">${escapeHtml(message.sender && !message.text.startsWith(`${message.sender}:`) ? `${message.sender}: ${message.text}` : message.text)}</p>
      <small>${escapeHtml(packetObserverLabel(message))}${Number.isFinite(message.snr) ? ` · SNR ${formatDecimal(message.snr, 1)} dB` : ""}${message.observerCount > 1 ? ` · ${tCount("units.observers", message.observerCount)}` : ""}</small>
    `;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    const open = (event) => {
      event?.preventDefault();
      event?.stopPropagation();
      void openPacketByHash(message.hash);
    };
    item.addEventListener("click", open);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open(event);
    });
    return item;
  }));
}

async function fetchChannelMessages(force = false) {
  if (!force && feedState.channelsLoadedAt && Date.now() - feedState.channelsLoadedAt < 60_000) {
    return feedState.channelMessages;
  }
  if (feedState.channelsLoading) return null;
  feedState.channelsLoading = true;
  try {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const data = await getJson(`/api/history?since=${since}&limit=4000`);
    const byHash = new Map();
    for (const packet of data.packets || []) {
      if (Number(packet.payload_type) !== 5) continue;
      const decoded = parseDecoded(packet);
      const channel = String(decoded.channel || "");
      const text = String(decoded.text || "").trim();
      if (decoded.decryptionStatus !== "decrypted" || !channel.startsWith("#") || !text) continue;
      const timestamp = routeTimestamp(packet, 0);
      const existing = byHash.get(packet.hash);
      const observerCount = (existing?.observerCount || 0) + 1;
      if (!existing || timestamp > existing.timestamp) {
        byHash.set(packet.hash, {
          channel,
          hash: packet.hash,
          observerCount,
          observerName: packet.observer_name,
          observerId: packet.observer_id,
          sender: String(decoded.sender || "").trim(),
          snr: Number(packet.snr),
          text,
          timestamp,
        });
      } else {
        existing.observerCount = observerCount;
      }
    }
    feedState.channelMessages = [...byHash.values()].sort((a, b) => b.timestamp - a.timestamp);
    feedState.channelsLoadedAt = Date.now();
    return feedState.channelMessages;
  } catch (error) {
    console.error("Kanály se nepodařilo načíst", error);
    feedState.channelsFailedAt = Date.now();
    return null;
  } finally {
    feedState.channelsLoading = false;
  }
}

async function loadChannels(force = false) {
  if (feedState.channelsLoading) return;
  renderFeedNow([], t("activity.channelsLoading"), { history: true });
  const messages = await fetchChannelMessages(force);
  if (messages) renderChannelFeed();
  else renderFeedNow([], t("activity.channelsFailed"), { history: true });
}

function setFeedMode(mode) {
  const history = mode === "history";
  const channels = mode === "channels";
  feedState.mode = history ? "history" : channels ? "channels" : "live";
  elements.activityHistory.classList.toggle("active", history);
  elements.activityHistory.setAttribute("aria-pressed", String(history));
  elements.activityChannels.classList.toggle("active", channels);
  elements.activityChannels.setAttribute("aria-pressed", String(channels));
  elements.activityHistory.textContent = t("activity.history");
  elements.activityChannels.textContent = t("activity.channels");
  elements.activityTitleText.textContent = t(history
    ? "activity.historyTitle"
    : channels ? "activity.channelsTitle" : "activity.liveTitle");
  elements.activityPause.hidden = history || channels;
  elements.historyFilters.hidden = !history;
  elements.channelTabs.hidden = !channels;
  if (history) {
    setFeedBadge();
    void loadHistoryFeed();
  } else if (channels) {
    setFeedBadge();
    void loadChannels();
  } else {
    if (state.routeWindowMs !== 0) renderArchive();
    else syncRoutePresentation();
  }
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

elements.packetFocusClose.addEventListener("click", exitPacketFocus);
elements.neighborFocusClose.addEventListener("click", clearNeighborFocus);
elements.archiveFocusClose.addEventListener("click", () => clearArchiveNodeFilter());
elements.activityHistory.addEventListener("click", () => {
  setFeedMode(feedState.mode === "history" ? "live" : "history");
});
elements.activityChannels.addEventListener("click", () => {
  setFeedMode(feedState.mode === "channels" ? "live" : "channels");
});
for (const input of [elements.historySearch, elements.historyType, elements.historyWindow, elements.historyAnomalies]) {
  input.addEventListener("input", () => {
    if (feedState.mode === "history") renderHistoryFeed();
  });
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
  if (state.archiveLoading) {
    elements.mapStatus.textContent = t("map.preparingArchive");
    elements.mapStatus.hidden = false;
    return;
  }
  const show = state.routeWindowMs === 0 && state.liveRouteCount === 0;
  if (!show) {
    elements.mapStatus.hidden = true;
    return;
  }
  elements.mapStatus.textContent = state.cachedRoutes.length
    ? t("map.waitingCache")
    : state.mqttConnected
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
  const count = state.routeWindowMs !== 0
    ? archiveRoutesSorted().length
    : (state.liveRouteCount || state.cachedRoutes.length);
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
  const nodesReady = state.nodeByKey.size ? Promise.resolve(true) : loadNodes();
  const data = await getJson(`/api/history?${archiveQuery(windowMs, nowMs())}`);
  await nodesReady;
  if (requestId !== state.windowRequestId || state.routeWindowMs !== windowMs) return;
  const packets = [];
  const pendingPrefixes = new Set();
  for (const parent of data.packets || []) {
    const observations = parent.observations?.length ? parent.observations : [parent];
    for (const observation of observations) {
      const packet = { ...parent, ...observation };
      const path = parsePath(packet);
      if (!path.length || path.length > MAX_ROUTE_PATH_LENGTH) continue;
      const hashBytes = packetPathHashBytes(packet, path);
      if (!isRouteVisible(Number(packet.payload_type), hashBytes, state)) continue;
      const resolved = Array.isArray(packet.resolved_path) ? packet.resolved_path : [];
      if (!resolved.some(Boolean)) {
        for (const prefix of path) pendingPrefixes.add(prefix);
      }
      packets.push({ hashBytes, packet, path, resolved: resolved.some(Boolean) });
    }
  }
  if (pendingPrefixes.size) await resolvePrefixes([...pendingPrefixes]);
  if (requestId !== state.windowRequestId || state.routeWindowMs !== windowMs) return;
  const routes = new Map();
  for (const { hashBytes, packet, path, resolved } of packets) {
    let points = resolved ? historyRoutePoints(packet, hashBytes) : [];
    if (!routeSegments(points).length) points = packetPoints(packet, path, hashBytes);
    if (!routeSegments(points).length) continue;
    const observedAt = routeTimestamp(packet, 0);
    const id = `${packet.hash || "archive"}:${packet.observer_id || "archive"}`;
    routes.set(id, routeRecord(packet, points, hashBytes, id, `archive:${id}`, observedAt));
  }
  state.archiveRoutes.clear();
  for (const route of groupTraceObservations([...routes.values()])) {
    state.archiveRoutes.set(route.id, route);
  }
  renderArchive();
  scheduleSnrLabels(150);
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

function routeHasNode(route, key) {
  const wanted = String(key || "").toUpperCase();
  return Boolean(wanted && route.points.some((point) => String(point.publicKey || "").toUpperCase() === wanted));
}

function archiveRouteCountForNode(key) {
  const wanted = String(key || "").toUpperCase();
  if (!wanted) return 0;
  let count = 0;
  for (const route of state.archiveRoutes.values()) {
    if (routeHasNode(route, wanted)) count += 1;
  }
  return count;
}

function archiveRoutesSorted() {
  const routes = [...state.archiveRoutes.values()];
  const filtered = state.archiveNodeFilterKey
    ? routes.filter((route) => routeHasNode(route, state.archiveNodeFilterKey))
    : routes;
  return filtered.sort((a, b) => b.timestamp - a.timestamp);
}

function updateArchiveHint() {
  const show = state.routeWindowMs !== 0 && !state.archiveNodeFilterKey;
  elements.archiveFilterHint.hidden = !show;
  if (show) elements.archiveFilterHint.textContent = t("archive.clickHint");
}

function updateArchiveFocusBar() {
  updateArchiveHint();
  const key = state.archiveNodeFilterKey;
  const node = key ? state.nodeByKey.get(key) : null;
  if (state.routeWindowMs === 0 || !key || !node) {
    elements.archiveFocusBar.hidden = true;
    return;
  }
  elements.archiveFocusTitle.textContent = t("archive.focusTitle");
  elements.archiveFocusName.textContent = node.name || t("common.unknownNode");
  elements.archiveFocusCount.textContent = tCount("packet.focusRoutes", archiveRoutesSorted().length);
  elements.archiveFocusClose.textContent = t("archive.clearFilter");
  elements.archiveFocusBar.hidden = false;
}

function clearArchiveNodeFilter({ render = true } = {}) {
  if (!state.archiveNodeFilterKey) {
    updateArchiveFocusBar();
    return;
  }
  state.archiveNodeFilterKey = null;
  updateArchiveFocusBar();
  if (render && state.routeWindowMs !== 0) renderArchive();
}

function toggleArchiveNodeFilter(node) {
  const key = String(node.public_key || "").toUpperCase();
  if (!key || state.routeWindowMs === 0) return;
  if (state.archiveNodeFilterKey === key) {
    clearArchiveNodeFilter();
    return;
  }
  if (state.packetFocus) exitPacketFocus();
  if (state.neighborFocusKey) clearNeighborFocus();
  state.archiveNodeFilterKey = key;
  renderArchive();
}

function renderArchive() {
  const routes = archiveRoutesSorted();
  const viewport = map.getBounds().pad(0.25);
  updateArchiveLayers(routes.filter((route) => routeVisibleIn(viewport, route)).slice(0, ARCHIVE_MAX_ROUTES));
  updateRouteCount();
  updateArchiveFocusBar();
  refreshOpenNodePopupActions();
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
  const requestedWindowMs = Number(windowMs);
  const previousWindowMs = state.routeWindowMs;
  clearCachedRoutes();
  state.routeWindowMs = requestedWindowMs;
  if (previousWindowMs !== requestedWindowMs) {
    state.archiveNodeFilterKey = null;
    updateArchiveFocusBar();
  }
  for (const button of elements.windowButtons) {
    button.classList.toggle("active", Number(button.dataset.windowMs) === state.routeWindowMs);
  }
  clearSelectedRoute();
  if (!requestedWindowMs) {
    state.archiveLoading = false;
    clearArchivePresentation();
    updateRouteCount();
    updateFeed([], t("feed.empty"), { immediate: true });
    syncRoutePresentation();
    return;
  }
  state.windowRequestId += 1;
  state.archiveLoading = true;
  clearLivePresentation();
  clearArchivePresentation();
  updateRouteCount();
  updateFeed([], t("feed.loadingHistory"), { immediate: true });
  try {
    await loadArchiveWindow(requestedWindowMs);
  } catch (error) {
    console.error("Historii tras se nepodařilo načíst", error);
  } finally {
    if (state.routeWindowMs === requestedWindowMs) {
      state.archiveLoading = false;
      updateRouteCount();
    }
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
  perf.set("nody", shownNodes);
  perf.set("nodyCelkem", state.nodeMarkers.length);
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
  if (state.cachedRoutes.length && visibleRoutes.length) clearCachedRoutes();
  saveRouteCache(visibleRoutes);
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
  scheduleSnrLabels();
  for (const entry of state.nodeMarkers) {
    const key = entry.node.public_key?.toUpperCase();
    const previous = key ? previousLastRoutes.get(key) : null;
    const current = key ? state.lastRouteByNodeKey.get(key) : null;
    if (entry.marker.isPopupOpen()
      && (previous?.versionId !== current?.versionId || previous?.position !== current?.position)) {
      scheduleOpenNodePopupRefresh(entry);
    }
  }
  refreshOpenNodeDetailStatus();
  updatePerfGauges();
}

let routeAnimationFrame = null;
let lastRouteAnimationAt = 0;
const CANVAS_ANIMATION_FPS = 10;

function routeAnimationEnabled() {
  return state.animationEnabled
    && !routesSuppressed()
    && state.activeRoutes.size > 0
    && !document.hidden;
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
      const points = packetPoints(packet, path, hashBytes);
      if (!routeSegments(points).length) return false;
      routeStore.addLive(routeRecord(packet, points, hashBytes, routeId, versionId, createdAt));
      if (!suppressRoutePresentation) syncRoutePresentation();
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
  const source = new EventSource(appPath("/events/packets?replay=0"));
  state.packetSource = source;
  source.addEventListener("status", (event) => {
    const status = JSON.parse(event.data);
    reloadForServerBuild(status.build);
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
async function refreshRecentSnapshot() {
  try {
    const data = await getJson("/api/recent?seconds=30");
    await processPacketBatch(data.packets || []);
  } catch (error) {
    console.error("Snapshot posledních paketů se nepodařilo načíst", error);
  }
}

function watchPacketStream() {
  if (!state.mqttConnected) return;
  if (state.lastPacketAt && Date.now() - state.lastPacketAt < STREAM_STALL_MS) return;
  console.warn("SSE stream se zasekl, obnovuji připojení");
  state.lastPacketAt = Date.now();
  connectPacketStream();
  void refreshRecentSnapshot();
}

let packetHandlingReady = false;
let suppressRoutePresentation = false;
const pendingPackets = [];

function dispatchPacket(packet) {
  if (packetHandlingReady) {
    void handlePacket(packet);
    return;
  }
  if (pendingPackets.length >= MAX_PENDING_PACKETS) pendingPackets.shift();
  pendingPackets.push(packet);
}

async function processPacketBatch(packets) {
  if (!packets.length) return;
  suppressRoutePresentation = true;
  try {
    await resolvePrefixes(packets.flatMap((packet) => parsePath(packet)));
  } catch (error) {
    console.error("Cache tras se nepodařilo připravit", error);
  }
  try {
    for (const packet of packets) await handlePacket(packet);
  } finally {
    suppressRoutePresentation = false;
  }
  syncRoutePresentation();
}

async function releasePendingPackets(snapshotPackets = []) {
  const packets = [...snapshotPackets, ...pendingPackets.splice(0)];
  await processPacketBatch(packets);
  packetHandlingReady = true;
  for (const packet of pendingPackets.splice(0)) void handlePacket(packet);
}

function refreshAfterFilterChange() {
  clearCachedRoutes();
  if (state.selectedRouteId
    && !isRouteVisible(state.selectedRoutePacketType, state.selectedRouteHashBytes, state)) clearSelectedRoute();
  if (state.routeWindowMs !== 0) void setRouteWindow(state.routeWindowMs);
  else syncRoutePresentation();
  if (feedState.mode === "history") renderHistoryFeed();
}

elements.routeRetention.addEventListener("change", () => {
  const value = Number(elements.routeRetention.value);
  if (!ROUTE_RETENTION_OPTIONS.includes(value)) return;
  state.retentionMs = value;
  routeStore.retentionMs = value;
  try {
    localStorage.setItem("meshcoreRouteRetentionMs", String(value));
  } catch {}
  refreshAfterFilterChange();
});

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
const LOS_NODE_INPUTS = [elements.losNodeA, elements.losNodeB];
const LOS_NODE_RESULTS = [elements.losResultsA, elements.losResultsB];

function losOptions() {
  const frequencyMhz = Number(elements.losFrequency.value) || 869.525;
  return {
    antennaAM: Math.max(1, Number(elements.losAntennaA.value) || 2),
    antennaBM: Math.max(1, Number(elements.losAntennaB.value) || 2),
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

function updateLosActions() {
  elements.losShare.disabled = !(state.losMarkers[0] && state.losMarkers[1]);
}

function hideLosResults(index) {
  if (index == null) {
    for (const results of LOS_NODE_RESULTS) results.hidden = true;
    return;
  }
  LOS_NODE_RESULTS[index].hidden = true;
}

function clearLosMarkers() {
  losMarkerLayer.clearLayers();
  state.losMarkers = [];
  state.losNodeKeys = [null, null];
  for (const input of LOS_NODE_INPUTS) input.value = "";
  hideLosResults();
  updateLosActions();
  renderLosBudget();
}

function createLosMarker(latlng, label, index, node = null) {
  if (state.losMarkers[index]) losMarkerLayer.removeLayer(state.losMarkers[index]);
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
    state.losNodeKeys[index] = null;
    LOS_NODE_INPUTS[index].value = "";
  });
  marker.on("dragend", () => {
    void computeLos();
    // Až po kliknutí (mouseup) zase povolíme vrstvy, aby nod pod kurzorem nechytil klik.
    setTimeout(() => container.classList.remove("los-dragging"), 0);
  });
  marker.addTo(losMarkerLayer);
  state.losMarkers[index] = marker;
  state.losNodeKeys[index] = node?.public_key?.toUpperCase() || null;
  LOS_NODE_INPUTS[index].value = node ? (node.name || t("common.unknownNode")) : "";
  updateLosActions();
}

function losRepeaterMatches(value) {
  const { query, hexQuery } = parseNodeQuery(value);
  if ((!query || query.length < 2) && hexQuery.length < 2) return [];
  return state.nodeMarkers
    .filter((entry) => (entry.node.role || "unknown") === "repeater")
    .filter((entry) => nodeMatchesQuery(entry.node, query, hexQuery))
    .sort((a, b) => Number(nodeIsActive(b.node, nowMs(), NODE_ACTIVE_MS))
      - Number(nodeIsActive(a.node, nowMs(), NODE_ACTIVE_MS))
      || String(a.node.name || "").localeCompare(String(b.node.name || ""), getLocale()))
    .slice(0, 8);
}

function renderLosResults(index, entries) {
  const results = LOS_NODE_RESULTS[index];
  results.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "los-picker-empty";
    empty.textContent = t("los.noResults");
    results.appendChild(empty);
  } else {
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      const active = nodeIsActive(entry.node, nowMs(), NODE_ACTIVE_MS);
      button.innerHTML = `<strong>${escapeHtml(entry.node.name || t("common.unknownNode"))}</strong><small>${escapeHtml(roleLabel(entry.node.role))} · ${active ? t("common.active") : t("common.inactive")}</small>`;
      button.addEventListener("click", () => {
        LOS_NODE_INPUTS[index].value = entry.node.name || t("common.unknownNode");
        hideLosResults(index);
        setLosEndpoint(index, entry.marker.getLatLng(), entry.node);
      });
      results.appendChild(button);
    }
  }
  results.hidden = false;
}

function updateLosResults(index) {
  const value = LOS_NODE_INPUTS[index].value.trim();
  const { query, hexQuery } = parseNodeQuery(value);
  if ((query.length < 2) && (hexQuery.length < 2)) {
    hideLosResults(index);
    return;
  }
  renderLosResults(index, losRepeaterMatches(value));
}

function bindLosPicker(index) {
  const input = LOS_NODE_INPUTS[index];
  input.addEventListener("input", () => updateLosResults(index));
  input.addEventListener("focus", () => updateLosResults(index));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideLosResults(index);
      input.blur();
      return;
    }
    if (event.key !== "Enter") return;
    const first = LOS_NODE_RESULTS[index].querySelector("button");
    if (!first) return;
    event.preventDefault();
    first.click();
  });
}

function setLosEndpoint(index, latlng, node = null) {
  if (state.losAbortController) state.losAbortController.abort();
  state.losProfile = null;
  state.losSamples = null;
  state.losEndpoints = null;
  clearLosDrawing();
  clearLosCursor();
  createLosMarker(latlng, index === 0 ? "A" : "B", index, node);
  if (state.losMarkers[0] && state.losMarkers[1]) {
    void computeLos();
  } else if (index === 0) {
    setLosStatus(node
      ? t("los.pointA", {
        name: node.name || t("common.unknownNode"),
        role: roleLabel(node.role),
      })
      : t("los.pointBHint"));
  } else {
    setLosStatus(t("los.firstHint"));
  }
}

function renderLosBudget(result = null) {
  const summary = elements.losBudgetSummary;
  if (!summary) return;
  const endpoints = state.losEndpoints;
  const distanceKm = result?.distanceKm
    ?? (endpoints ? map.distance([endpoints[0].lat, endpoints[0].lon], [endpoints[1].lat, endpoints[1].lon]) / 1000 : 0);
  if (!endpoints || !(distanceKm > 0)) {
    summary.textContent = t("los.budgetNoPath");
    summary.className = "los-budget-summary";
    return;
  }
  const frequencyMhz = Number(elements.losFrequency.value) || 869.525;
  const txPower = Number(elements.losTxPower.value);
  const gainA = Number(elements.losGainA.value);
  const gainB = Number(elements.losGainB.value);
  const lossA = Number(elements.losLossA.value);
  const lossB = Number(elements.losLossB.value);
  const sensitivity = Number(elements.losSensitivity.value);
  const required = Number(elements.losRequiredMargin.value);
  const values = [txPower, gainA, gainB, lossA, lossB, sensitivity, required];
  if (values.some((value) => !Number.isFinite(value))) {
    summary.textContent = t("los.budgetNoPath");
    summary.className = "los-budget-summary";
    return;
  }
  const fspl = 32.44 + 20 * Math.log10(distanceKm) + 20 * Math.log10(frequencyMhz);
  const rx = txPower + gainA + gainB - lossA - lossB - fspl;
  const margin = rx - sensitivity;
  const reserve = margin - required;
  const status = margin < 0 ? "fail" : (reserve < 0 ? "tight" : "ok");
  const statusKey = status === "fail" ? "los.budgetFail" : status === "tight" ? "los.budgetTight" : "los.budgetOk";
  summary.textContent = `${t("los.budgetSummary", {
    fspl: formatDecimal(fspl, 1),
    rx: formatDecimal(rx, 1),
    margin: formatDecimal(margin, 1),
    reserve: formatDecimal(reserve, 1),
  })} · ${t(statusKey)}`;
  summary.className = `los-budget-summary ${status}`;
}

function losShareUrl() {
  const a = state.losMarkers[0]?.getLatLng();
  const b = state.losMarkers[1]?.getLatLng();
  if (!a || !b) return null;
  const url = new URL(location.href);
  url.searchParams.delete("node");
  url.searchParams.delete("sheet");
  url.searchParams.set("los", [a.lat, a.lng, b.lat, b.lng].map((value) => value.toFixed(6)).join(","));
  url.searchParams.set("losF", elements.losFrequency.value || "869.525");
  url.searchParams.set("losA", elements.losAntennaA.value || "2");
  url.searchParams.set("losB", elements.losAntennaB.value || "2");
  url.searchParams.set("losTx", elements.losTxPower.value || "22");
  url.searchParams.set("losGA", elements.losGainA.value || "3");
  url.searchParams.set("losGB", elements.losGainB.value || "3");
  url.searchParams.set("losLA", elements.losLossA.value || "1");
  url.searchParams.set("losLB", elements.losLossB.value || "1");
  url.searchParams.set("losSens", elements.losSensitivity.value || "-137");
  url.searchParams.set("losMargin", elements.losRequiredMargin.value || "10");
  if (state.losNodeKeys[0]) url.searchParams.set("losNodeA", state.losNodeKeys[0]);
  else url.searchParams.delete("losNodeA");
  if (state.losNodeKeys[1]) url.searchParams.set("losNodeB", state.losNodeKeys[1]);
  else url.searchParams.delete("losNodeB");
  url.searchParams.set("lang", getLocale());
  return url.toString();
}

async function shareLosLink() {
  const url = losShareUrl();
  if (!url) return;
  const copied = await copyText(url);
  setLosStatus(copied ? t("los.linkCopied") : t("common.copyFailed"));
}

function parseLosLink() {
  const raw = INITIAL_PARAMS.get("los");
  if (!raw) return null;
  const values = raw.split(",").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [latA, lonA, latB, lonB] = values;
  if (Math.abs(latA) > 90 || Math.abs(latB) > 90 || Math.abs(lonA) > 180 || Math.abs(lonB) > 180) return null;
  const numeric = (name) => {
    const raw = INITIAL_PARAMS.get(name);
    if (raw == null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    points: [{ lat: latA, lon: lonA }, { lat: latB, lon: lonB }],
    frequency: numeric("losF"),
    antennaA: numeric("losA"),
    antennaB: numeric("losB"),
    budget: {
      txPower: numeric("losTx"),
      gainA: numeric("losGA"),
      gainB: numeric("losGB"),
      lossA: numeric("losLA"),
      lossB: numeric("losLB"),
      sensitivity: numeric("losSens"),
      required: numeric("losMargin"),
    },
    nodeKeys: [INITIAL_PARAMS.get("losNodeA"), INITIAL_PARAMS.get("losNodeB")],
  };
}

function initSharedLos(link) {
  setLosMode(true);
  if (link.frequency != null) elements.losFrequency.value = String(link.frequency);
  if (link.antennaA != null) elements.losAntennaA.value = String(link.antennaA);
  if (link.antennaB != null) elements.losAntennaB.value = String(link.antennaB);
  const budgetFields = {
    txPower: elements.losTxPower,
    gainA: elements.losGainA,
    gainB: elements.losGainB,
    lossA: elements.losLossA,
    lossB: elements.losLossB,
    sensitivity: elements.losSensitivity,
    required: elements.losRequiredMargin,
  };
  for (const [key, input] of Object.entries(budgetFields)) {
    if (link.budget?.[key] != null) input.value = String(link.budget[key]);
  }
  const entries = link.nodeKeys.map((key) => (key ? findNodeEntry(key) : null));
  const latlngs = link.points.map((point, index) => (
    entries[index] ? entries[index].marker.getLatLng() : L.latLng(point.lat, point.lon)
  ));
  setLosEndpoint(0, latlngs[0], entries[0]?.node || null);
  setLosEndpoint(1, latlngs[1], entries[1]?.node || null);
  const bounds = L.latLngBounds(latlngs);
  if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 12, padding: [40, 40] });
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
  renderLosBudget(result);
  if (!elements.losDialog.open) elements.losDialog.show();
  updateLosActions();
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
    setLosEndpoint(0, latlng, node);
    return;
  }
  setLosEndpoint(1, latlng, node);
}

let coverageTimer = null;

function coverageSettings() {
  const antenna = Math.min(300, Math.max(1, Number(elements.coverageAntenna.value) || 10));
  const radius = Math.min(100, Math.max(3, Number(elements.coverageRadius.value) || 100));
  const frequency = Math.min(6000, Math.max(100, Number(elements.coverageFrequency.value) || 868));
  return { antenna, radius, frequency };
}

function cancelCoverageCompute() {
  state.coverageComputeId += 1;
  if (state.coverageWorker) {
    state.coverageWorker.terminate();
    state.coverageWorker = null;
  }
}

function clearCoverageOverlay() {
  if (state.coverageOverlay) {
    map.removeLayer(state.coverageOverlay);
    state.coverageOverlay = null;
  }
  if (state.coverageImageUrl) {
    URL.revokeObjectURL(state.coverageImageUrl);
    state.coverageImageUrl = null;
  }
}

function clearCoverageMarker() {
  if (state.coverageMarker) {
    map.removeLayer(state.coverageMarker);
    state.coverageMarker = null;
  }
}

function setCoverageStatus(text) {
  elements.coverageStatus.textContent = text || "";
}

function setCoverageMode(on) {
  const next = Boolean(on);
  if (next && state.losMode) setLosMode(false);
  state.coverageMode = next;
  elements.coverageToggle.classList.toggle("active", next);
  elements.coverageToggle.setAttribute("aria-pressed", String(next));
  elements.coverageHint.hidden = !next;
  elements.coverageHint.textContent = next ? t("coverage.hint") : "";
  map.getContainer().style.cursor = next || state.losMode ? "crosshair" : "";
  if (!next) {
    clearTimeout(coverageTimer);
    cancelCoverageCompute();
    clearCoverageOverlay();
    clearCoverageMarker();
    state.coverageCenter = null;
    setCoverageStatus("");
    elements.coverageSummary.textContent = "";
    if (elements.coverageDialog.open) elements.coverageDialog.close();
  }
}

function mercatorY(latDeg) {
  const rad = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function renderCoverage(result) {
  const center = result.center;
  const radiusKm = result.radiusKm;
  if (!Number.isFinite(result.centerGroundM)) {
    clearCoverageOverlay();
    elements.coverageSummary.textContent = "";
    setCoverageStatus(t("coverage.noTerrain"));
    return;
  }
  const size = 560;
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(0.05, Math.cos((center.lat * Math.PI) / 180)));
  const north = center.lat + latDelta;
  const south = center.lat - latDelta;
  const west = center.lon - lonDelta;
  const east = center.lon + lonDelta;
  const mercNorth = mercatorY(north);
  const mercSouth = mercatorY(south);
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const image = context.createImageData(size, size);
  const pixels = image.data;
  const maxDistanceM = radiusKm * 1000;

  for (let py = 0; py < size; py += 1) {
    const merc = mercNorth + ((mercSouth - mercNorth) * py) / (size - 1);
    const lat = ((2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * 180) / Math.PI;
    const northM = (lat - center.lat) * 110540;
    for (let px = 0; px < size; px += 1) {
      const lon = west + ((east - west) * px) / (size - 1);
      const eastM = (lon - center.lon) * 111320 * cosLat;
      const distanceM = Math.hypot(northM, eastM);
      const offset = (py * size + px) * 4;
      if (distanceM > maxDistanceM) continue;
      const azimuth = ((Math.atan2(eastM, northM) * 180) / Math.PI + 360) % 360;
      const ray = Math.min(result.rays - 1, Math.floor((azimuth / 360) * result.rays));
      const sample = Math.min(result.samples - 1, Math.max(0, Math.floor(distanceM / result.stepM) - 1));
      const status = result.statuses[ray * result.samples + sample];
      if (status === CLEAR) {
        pixels[offset] = 46;
        pixels[offset + 1] = 160;
        pixels[offset + 2] = 67;
        pixels[offset + 3] = 140;
      } else if (status === PARTIAL) {
        pixels[offset] = 224;
        pixels[offset + 1] = 145;
        pixels[offset + 2] = 30;
        pixels[offset + 3] = 150;
      } else if (status === 3) {
        pixels[offset] = 120;
        pixels[offset + 1] = 130;
        pixels[offset + 2] = 126;
        pixels[offset + 3] = 45;
      }
    }
  }

  context.putImageData(image, 0, 0);
  clearCoverageOverlay();
  state.coverageOverlay = L.imageOverlay(canvas.toDataURL("image/png"), [[south, west], [north, east]], {
    opacity: 1,
    interactive: false,
    className: "coverage-overlay",
  }).addTo(map);
  const area = result.visibleAreaKm2 + result.partialAreaKm2;
  elements.coverageSummary.textContent = t("coverage.summary", {
    ground: Number.isFinite(result.centerGroundM) ? formatNumber(Math.round(result.centerGroundM)) : "—",
    distance: formatDecimal(result.maxDistanceKm, 1),
    area: formatNumber(Math.round(area)),
  });
  setCoverageStatus(t("coverage.done", { tiles: result.tiles }));
}

async function computeCoverage() {
  if (!state.coverageCenter) return;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    setCoverageStatus(t("coverage.unsupported"));
    return;
  }
  const settings = coverageSettings();
  elements.coverageAntenna.value = String(settings.antenna);
  elements.coverageRadius.value = String(settings.radius);
  elements.coverageFrequency.value = String(settings.frequency);
  clearCoverageOverlay();
  setCoverageStatus(t("coverage.loading", { loaded: 0, total: "?" }));
  elements.coverageSummary.textContent = "";
  cancelCoverageCompute();
  const computeId = state.coverageComputeId;
  const worker = new Worker(new URL("./coverage-worker.js", import.meta.url), { type: "module" });
  state.coverageWorker = worker;
  worker.onmessage = (event) => {
    if (computeId !== state.coverageComputeId) return;
    const data = event.data || {};
    if (data.type === "progress") {
      setCoverageStatus(t("coverage.loading", { loaded: data.loaded, total: data.total }));
      return;
    }
    if (data.type === "compute") {
      setCoverageStatus(t("coverage.computing"));
      return;
    }
    if (data.type === "error") {
      setCoverageStatus(t("coverage.failed"));
      worker.terminate();
      if (state.coverageWorker === worker) state.coverageWorker = null;
      return;
    }
    if (data.type === "done") {
      renderCoverage({ ...data, center: state.coverageCenter, radiusKm: settings.radius });
      worker.terminate();
      if (state.coverageWorker === worker) state.coverageWorker = null;
    }
  };
  worker.onerror = () => {
    if (computeId !== state.coverageComputeId) return;
    setCoverageStatus(t("coverage.failed"));
    worker.terminate();
    if (state.coverageWorker === worker) state.coverageWorker = null;
  };
  worker.postMessage({
    center: state.coverageCenter,
    radiusKm: settings.radius,
    antennaM: settings.antenna,
    frequencyMHz: settings.frequency,
    azimuthSteps: 720,
    samplesPerRay: 300,
  });
}

function handleCoverageClick(latlng) {
  state.coverageCenter = { lat: latlng.lat, lon: latlng.lng };
  if (!state.coverageMarker) {
    state.coverageMarker = L.circleMarker([latlng.lat, latlng.lng], {
      radius: 7,
      color: "#1f6fb2",
      weight: 3,
      fillColor: "#ffffff",
      fillOpacity: 1,
      interactive: false,
      pane: "markerPane",
    }).addTo(map);
  } else {
    state.coverageMarker.setLatLng([latlng.lat, latlng.lng]);
  }
  if (!elements.coverageDialog.open) elements.coverageDialog.show();
  void computeCoverage();
}

const scheduleCoverage = () => {
  if (!state.coverageCenter) return;
  clearTimeout(coverageTimer);
  coverageTimer = setTimeout(() => void computeCoverage(), 350);
};

function setLosMode(on) {
  if (on && state.coverageMode) setCoverageMode(false);
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
  if (state.losMode) {
    elements.losSummary.textContent = "";
    elements.losChart.replaceChildren();
    elements.losHover.textContent = "";
    setLosStatus(t("los.firstHint"));
    elements.losDialog.show();
  }
}

elements.losToggle.addEventListener("click", () => setLosMode(!state.losMode));
elements.coverageToggle.addEventListener("click", () => {
  if (state.coverageMode) setCoverageMode(false);
  else {
    setCoverageMode(true);
    setCoverageStatus(t("coverage.hint"));
  }
});
elements.observersToggle.addEventListener("change", () => void setObserversVisible(elements.observersToggle.checked));
elements.coverageClose.addEventListener("click", () => elements.coverageDialog.close());
elements.coverageDialog.addEventListener("close", () => {
  if (state.coverageMode) setCoverageMode(false);
});
elements.coverageRecompute.addEventListener("click", () => void computeCoverage());
for (const input of [elements.coverageAntenna, elements.coverageRadius, elements.coverageFrequency]) {
  input.addEventListener("input", scheduleCoverage);
}
state.losRecomputeButton.addEventListener("click", () => void computeLos());
elements.losClose.addEventListener("click", () => elements.losDialog.close());
elements.losDialog.addEventListener("close", clearLosCursor);
elements.losChart.addEventListener("mousemove", handleLosChartHover);
elements.losChart.addEventListener("mouseleave", clearLosCursor);
elements.losShare.addEventListener("click", () => void shareLosLink());
const refreshLosInputs = () => {
  if (state.losSamples && state.losEndpoints) recomputeLos();
  else renderLosBudget();
};
elements.losFrequency.addEventListener("input", refreshLosInputs);
for (const input of [
  elements.losAntennaA,
  elements.losAntennaB,
  elements.losTxPower,
  elements.losGainA,
  elements.losGainB,
  elements.losLossA,
  elements.losLossB,
  elements.losSensitivity,
  elements.losRequiredMargin,
]) {
  input.addEventListener("input", refreshLosInputs);
}
bindLosPicker(0);
bindLosPicker(1);
document.addEventListener("click", (event) => {
  if (event.target.closest(".los-picker")) return;
  hideLosResults();
});
updateLosActions();

elements.packetRateCard.addEventListener("click", openPacketHistory);
elements.packetRateCard.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openPacketHistory();
});
elements.packetHistoryClose.addEventListener("click", () => elements.packetHistoryDialog.close());
for (const button of elements.packetHistoryWindows) {
  button.addEventListener("click", () => void loadPacketHistory(Number(button.dataset.hours)));
}
elements.packetRateCard.setAttribute("aria-label", t("packetHistory.openAria"));
elements.packetRateCard.title = t("packetHistory.openTitle");
document.querySelector("#packet-history-title").textContent = t("packetHistory.title");
elements.packetHistoryClose.setAttribute("aria-label", t("packetHistory.close"));
document.querySelector("#packet-history-windows").setAttribute("aria-label", t("packetHistory.period"));
const packetHistoryWindowLabels = {
  24: t("packetHistory.window24"),
  168: t("packetHistory.window7d"),
  720: t("packetHistory.window30d"),
  8760: t("packetHistory.window1y"),
};
for (const button of elements.packetHistoryWindows) {
  button.textContent = packetHistoryWindowLabels[Number(button.dataset.hours)] || packetHistoryWindowLabels[24];
}
document.querySelector("#packet-history-dialog .los-note").textContent = t("packetHistory.note");

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (elements.coverageDialog.open) elements.coverageDialog.close();
  else if (state.coverageMode) setCoverageMode(false);
  else if (elements.losDialog.open) elements.losDialog.close();
  else if (state.losMode) setLosMode(false);
  else if (elements.packetHistoryDialog.open) elements.packetHistoryDialog.close();
  else if (state.packetFocus) exitPacketFocus();
  else if (state.neighborFocusKey) clearNeighborFocus();
  else if (state.archiveNodeFilterKey) clearArchiveNodeFilter();
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
elements.photosOnlyToggle.addEventListener("change", () => {
  void setPhotosOnly(elements.photosOnlyToggle.checked);
});
elements.healthOnlyToggle.addEventListener("change", () => {
  state.healthOnly = elements.healthOnlyToggle.checked;
  elements.healthStatusBlock.hidden = !state.healthOnly;
  applyNodeFilterRouteVisibility();
  refreshNodeState();
});
elements.healthValuesToggle.checked = state.showHealthValues;
elements.healthValueMode.value = state.healthValueMode;
elements.healthValueModeWrap.hidden = !state.showHealthValues;
elements.healthValuesToggle.addEventListener("change", () => {
  state.showHealthValues = elements.healthValuesToggle.checked;
  elements.healthValueModeWrap.hidden = !state.showHealthValues;
  localStorage.setItem("meshcoreShowHealthValues", String(state.showHealthValues));
  scheduleNodeLabels();
});
elements.healthValueMode.addEventListener("change", () => {
  state.healthValueMode = elements.healthValueMode.value === "voltage" ? "voltage" : "temperature";
  localStorage.setItem("meshcoreHealthValueMode", state.healthValueMode);
  scheduleNodeLabels();
});
elements.healthStatusSelect.addEventListener("change", () => {
  const next = elements.healthStatusSelect.value;
  state.healthStatus = HEALTH_STATUS_FILTERS.includes(next) ? next : "all";
  refreshNodeState();
});
elements.inactiveOnlyToggle.addEventListener("change", () => {
  state.inactiveOnly = elements.inactiveOnlyToggle.checked;
  refreshNodeState();
});
elements.hideRoutesToggle.addEventListener("change", () => {
  setRoutesHidden(elements.hideRoutesToggle.checked);
});
map.on("moveend zoomend resize", scheduleNodeLabels);
map.on("moveend zoomend resize", scheduleViewportRender);
map.on("moveend zoomend", () => scheduleSnrLabels(150));

const hud = document.querySelector("#hud");
const hudToggle = document.querySelector("#hud-toggle");
const activityToggle = document.querySelector("#activity-toggle");
const activityPanel = document.querySelector(".activity-panel");
const ACTIVITY_SIZE_KEY = "meshcoreActivitySize";

function activitySizeLimits() {
  return {
    fullWidth: window.matchMedia("(max-width: 430px)").matches,
    maxHeight: Math.max(200, Math.min(680, window.innerHeight - 90)),
    maxWidth: Math.max(280, Math.min(620, window.innerWidth - 32)),
    minHeight: 150,
    minWidth: 240,
  };
}

function storedActivitySize() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVITY_SIZE_KEY) || "null");
    if (!parsed || !Number.isFinite(Number(parsed.width)) || !Number.isFinite(Number(parsed.height))) return null;
    return { h: Number(parsed.height), w: Number(parsed.width) };
  } catch {
    return null;
  }
}

function saveActivitySize(width, height) {
  try {
    localStorage.setItem(ACTIVITY_SIZE_KEY, JSON.stringify({
      height: Math.round(height),
      width: Math.round(width),
    }));
  } catch {}
}

function applyActivitySize(size, { persist = false } = {}) {
  const limits = activitySizeLimits();
  const clamped = clampActivitySize(size, limits);
  activityPanel.classList.add("resized");
  activityPanel.style.width = limits.fullWidth ? "" : `${clamped.width}px`;
  activityPanel.style.height = `${clamped.height}px`;
  if (persist) saveActivitySize(clamped.width, clamped.height);
}

function resetActivitySize() {
  activityPanel.classList.remove("resized");
  activityPanel.style.width = "";
  activityPanel.style.height = "";
  try {
    localStorage.removeItem(ACTIVITY_SIZE_KEY);
  } catch {}
}

const initialActivitySize = storedActivitySize();
if (initialActivitySize) applyActivitySize(initialActivitySize);

let activityDrag = null;

function moveActivityResize(event) {
  if (!activityDrag) return;
  const fullWidth = window.matchMedia("(max-width: 430px)").matches;
  applyActivitySize({
    h: activityDrag.h + (activityDrag.y - event.clientY),
    w: fullWidth ? activityDrag.w : activityDrag.w + (activityDrag.x - event.clientX),
  });
}

function endActivityResize() {
  if (!activityDrag) return;
  const rect = activityPanel.getBoundingClientRect();
  const limits = activitySizeLimits();
  const previous = storedActivitySize();
  const width = limits.fullWidth ? (previous?.w ?? 340) : rect.width;
  activityDrag = null;
  document.body.classList.remove("resizing-activity");
  window.removeEventListener("pointermove", moveActivityResize);
  window.removeEventListener("pointerup", endActivityResize);
  window.removeEventListener("pointercancel", endActivityResize);
  saveActivitySize(width, rect.height);
}

elements.activityResize.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = activityPanel.getBoundingClientRect();
  activityDrag = { h: rect.height, w: rect.width, x: event.clientX, y: event.clientY };
  document.body.classList.add("resizing-activity");
  try {
    elements.activityResize.setPointerCapture(event.pointerId);
  } catch {}
  window.addEventListener("pointermove", moveActivityResize);
  window.addEventListener("pointerup", endActivityResize);
  window.addEventListener("pointercancel", endActivityResize);
});

elements.activityResize.addEventListener("dblclick", (event) => {
  event.preventDefault();
  resetActivitySize();
});

elements.activityResize.addEventListener("keydown", (event) => {
  if (event.key === "Home") {
    event.preventDefault();
    resetActivitySize();
    return;
  }
  const rect = activityPanel.getBoundingClientRect();
  const step = event.shiftKey ? 48 : 16;
  let height = rect.height;
  let width = rect.width;
  if (event.key === "ArrowLeft") width += step;
  else if (event.key === "ArrowRight") width -= step;
  else if (event.key === "ArrowUp") height += step;
  else if (event.key === "ArrowDown") height -= step;
  else return;
  event.preventDefault();
  applyActivitySize({ h: height, w: width }, { persist: true });
});

window.addEventListener("resize", () => {
  if (!activityPanel.classList.contains("resized")) return;
  const size = storedActivitySize();
  const rect = activityPanel.getBoundingClientRect();
  applyActivitySize(size || { h: rect.height, w: rect.width });
});

elements.activityResize.setAttribute("aria-label", t("activity.resize"));
elements.activityResize.title = t("activity.resizeHint");


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

function setActivityVisible(show) {
  activityPanel.hidden = !show;
  activityToggle.textContent = show ? t("activity.hide") : t("activity.show");
  activityToggle.setAttribute("aria-pressed", String(show));
  if (show) {
    feedState.autoPaused = false;
    flushFeed(true);
  }
}

elements.activityClose.setAttribute("aria-label", t("activity.close"));
activityToggle.addEventListener("click", () => {
  setActivityVisible(activityPanel.hidden);
});
elements.activityClose.addEventListener("click", () => {
  setActivityVisible(false);
});

const statsPanel = createStatsController({
  elements,
  getJson,
  loadObservers,
  loadStats,
  observerHealth,
  onRevealNode: (node) => {
    const entry = state.nodeMarkerByKey.get(String(node.public_key || "").toUpperCase());
    if (!entry) return;
    revealNodeMarker(entry);
    map.flyTo(entry.marker.getLatLng(), 11, { duration: 0.7 });
    openNodeEntry(entry);
  },
  state,
});
statsPanel.bind();
elements.statsToggle.addEventListener("click", () => {
  if (!elements.statsPanel.hidden) void loadNetworkTrend();
});

function shortNodePrefix(node) {
  const size = Math.max(Number(node.multi_byte_max_hash_size) || 0, Number(node.hash_size) || 0) || 2;
  return String(node.public_key || "").slice(0, size * 2).toUpperCase();
}

function revealSearchNode(node) {
  if (!validCoords(node.lat, node.lon)) {
    openNodeDetail(node);
    return;
  }
  const entry = state.nodeMarkerByKey.get(String(node.public_key || "").toUpperCase());
  map.flyTo([node.lat, node.lon], Math.max(map.getZoom(), 11), { duration: 0.7 });
  if (entry) revealNodeMarker(entry);
  setTimeout(() => {
    if (entry) openNodeEntry(entry);
  }, 350);
}

async function revealSearchObserver(observer) {
  if (!state.showObservers) await setObserversVisible(true);
  const position = observerPosition(observer);
  if (!position) return;
  map.flyTo([position.lat, position.lon], Math.max(map.getZoom(), 11), { duration: 0.7 });
  L.popup({ className: "observer-popup", maxWidth: 300, minWidth: 220, autoPan: true })
    .setLatLng([position.lat, position.lon])
    .setContent(observerPopupHtml(observer, position))
    .openOn(map);
}

async function revealSearchPacket(hash) {
  const occurrences = routeStore.packetOccurrences(String(hash || "").toUpperCase(), state, nowMs());
  if (occurrences.length) {
    showPacketOnMap(occurrences);
    await openPacketDetail(occurrences[0]);
    return;
  }
  await openPacketByHash(hash, { showOnMap: true });
}

const searchController = createSearchController({
  elements,
  ensureData: (refresh) => {
    if (!state.observersLoadedAt && !state.observersLoading) {
      void loadObservers().then(refresh);
    }
    if (elements.nodeSearch.value.trim().length >= 2 && !feedState.channelsLoadedAt && !feedState.channelsLoading
      && Date.now() - feedState.channelsFailedAt > 60_000) {
      void fetchChannelMessages().then((messages) => {
        if (messages) refresh();
      });
    }
  },
  feedState,
  getJson,
  observerHealth,
  onRevealNode: revealSearchNode,
  onRevealObserver: revealSearchObserver,
  onRevealPacket: revealSearchPacket,
  routeStore,
  shortNodePrefix,
  state,
  typeLabels: TYPE_LABELS,
});
searchController.bind();

document.addEventListener("click", (event) => {
  const badge = event.target instanceof Element ? event.target.closest(".node-health-badge") : null;
  if (badge) {
    event.preventDefault();
    event.stopPropagation();
    revealNodeHealthTrend(badge, badge.dataset.healthNodeKey);
    return;
  }
  const trend = event.target instanceof Element ? event.target.closest(".node-trend-button") : null;
  if (!trend) return;
  event.preventDefault();
  event.stopPropagation();
  revealNodeHealthTrend(trend, trend.dataset.healthNodeKey);
}, true);

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest(".node-neighbors-map") : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  const node = state.nodeByKey.get(String(target.dataset.nodeKey || "").toUpperCase());
  if (!node) return;
  if (isMobileSheet()) closeMobileSheet();
  else map.closePopup();
  showNodeNeighborsOnMap(node);
}, true);

createExportController({
  state,
  elements,
  routeStore,
  nowMs,
  observerPosition,
  observerHealth,
  shortNodePrefix,
  nodeIsActive,
  nodeActiveMs: NODE_ACTIVE_MS,
  loadObservers,
});


elements.commentsClose.addEventListener("click", () => elements.commentsDialog.close());
elements.commentsCancel.addEventListener("click", () => elements.commentsDialog.close());
elements.commentsDialog.addEventListener("click", (event) => {
  if (event.target === elements.commentsDialog) elements.commentsDialog.close();
});
elements.commentsDialog.addEventListener("close", () => {
  state.commentsTarget = null;
  state.commentsSaving = false;
  setCommentsStatus("");
});
elements.commentsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.commentsSaving) return;
  const target = state.commentsTarget;
  if (!target) return;
  const text = elements.commentsText.value.trim();
  if (text.length < 2) {
    setCommentsStatus(t("comments.tooShort"), true);
    return;
  }
  if (text.length > 500) {
    setCommentsStatus(t("comments.tooLong"), true);
    return;
  }
  state.commentsSaving = true;
  elements.commentsSubmit.disabled = true;
  setCommentsStatus(t("comments.sending"));
  try {
    const response = await fetch(appPath("/api/comments"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: target.key,
        text,
        author: elements.commentsName.value.trim(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setCommentsStatus(data.error || t("comments.failed"), true);
      return;
    }
    elements.commentsForm.reset();
    setCommentsStatus(t("comments.published"));
    await loadComments();
  } catch (error) {
    setCommentsStatus(t("comments.failed"), true);
    console.error("Komentář se nepodařilo odeslat", error);
  } finally {
    state.commentsSaving = false;
    elements.commentsSubmit.disabled = false;
  }
});

elements.nodeInfoClose.addEventListener("click", () => elements.nodeInfoDialog.close());
elements.nodeInfoCancel.addEventListener("click", () => elements.nodeInfoDialog.close());
elements.nodeInfoDialog.addEventListener("click", (event) => {
  if (event.target === elements.nodeInfoDialog) elements.nodeInfoDialog.close();
});
elements.nodeInfoDialog.addEventListener("close", () => {
  state.nodeInfoTarget = null;
  setNodeInfoStatus("");
});
elements.nodeInfoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.nodeInfoSaving) return;
  const target = state.nodeInfoTarget;
  if (!target) return;
  const text = elements.nodeInfoText.value.trim();
  if (text.length < 5) {
    setNodeInfoStatus(t("nodeInfo.tooShort"), true);
    return;
  }
  if (text.length > 1000) {
    setNodeInfoStatus(t("nodeInfo.tooLong"), true);
    return;
  }
  const password = elements.nodeInfoPassword.value;
  if (password && (password.length < 6 || password.length > 128)) {
    setNodeInfoStatus(t("nodeInfo.passwordTooShort"), true);
    return;
  }
  state.nodeInfoSaving = true;
  elements.nodeInfoSubmit.disabled = true;
  setNodeInfoStatus(t("nodeInfo.saving"));
  try {
    const data = await postJson("/api/node-info", {
      author: elements.nodeInfoAuthor.value.trim(),
      key: target.key,
      password,
      text,
      token: nodeInfoTokens.get(target.key),
    });
    if (data.manageToken) nodeInfoTokens.remember(target.key, data.manageToken);
    if (data.status === "pending") {
      setNodeInfoStatus(t("nodeInfo.pending"));
    } else {
      const info = data.info || null;
      state.nodeInfoCache.set(target.key, { at: Date.now(), info });
      for (const section of document.querySelectorAll(`.node-user-info[data-node-key="${target.key}"]`)) {
        renderNodeInfoSection(section, info);
      }
      setNodeInfoStatus(t("nodeInfo.saved"));
    }
    setTimeout(() => {
      if (elements.nodeInfoDialog.open) elements.nodeInfoDialog.close();
    }, 1_500);
  } catch (error) {
    setNodeInfoStatus(error.message || t("nodeInfo.failed"), true);
  } finally {
    state.nodeInfoSaving = false;
    elements.nodeInfoSubmit.disabled = false;
  }
});

elements.mobileSheetClose.addEventListener("click", closeMobileSheet);
elements.mobileSheet.addEventListener("click", (event) => {
  if (event.target === elements.mobileSheet) closeMobileSheet();
});
elements.mobileSheet.addEventListener("close", () => elements.mobileSheetContent.replaceChildren());
mobileSheetQuery.addEventListener("change", (event) => {
  if (!event.matches) closeMobileSheet();
});

elements.nodeDetailPage.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeNodeDetail();
});
elements.nodeDetailPage.addEventListener("click", (event) => {
  if (event.target === elements.nodeDetailPage) closeNodeDetail();
});
window.addEventListener("popstate", () => {
  if (!nodeDetailPathKey()) closeNodeDetail({ fromHistory: true });
});

elements.qrClose.addEventListener("click", () => elements.qrDialog.close());
elements.qrDialog.addEventListener("click", (event) => {
  if (event.target === elements.qrDialog) elements.qrDialog.close();
});

createFeedbackController({ elements, getJson, postJson, formatNodeDate });

document.addEventListener("visibilitychange", updateRouteAnimation);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkServerBuild();
});
window.addEventListener("online", () => {
  void checkServerBuild();
});

const initialWindow = parseRouteWindowParam(INITIAL_PARAMS.get("window"));
if (initialWindow != null && initialWindow !== 0) void setRouteWindow(initialWindow);
if (INITIAL_PARAMS.get("photos") === "1") {
  void loadPhotoNodes().then(() => refreshNodeState()).catch(() => {});
}
if (INITIAL_PARAMS.get("observers") === "1") {
  void setObserversVisible(true).catch(() => {});
}
const initialLosLink = parseLosLink();

async function start() {
  console.info(`Route animation mode: ${state.animationMode}`);
  void checkServerBuild();
  restoreRouteCache();
  connectPacketStream();
  const snapshotPromise = getJson("/api/recent?seconds=30").catch((error) => {
    console.error("Snapshot posledních paketů se nepodařilo načíst", error);
    return null;
  });
  const nodesPromise = loadNodes();
  void loadPhotoNodes();
  void loadObservers();
  void loadStats();
  setInterval(() => loadBaseData().catch((error) => console.error("Obnova dat selhala", error)), BASE_DATA_REFRESH_MS);
  setInterval(() => loadObservers(true), OBSERVER_REFRESH_MS);
  setInterval(checkServerBuild, BUILD_CHECK_MS);
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
  const snapshot = await snapshotPromise;
  await releasePendingPackets(snapshot?.packets || []);
  void loadRouteHistory();
  if (!nodesLoaded) setConnection(false, t("connection.nodesFailed"));
  if (initialLosLink) initSharedLos(initialLosLink);
  if (INITIAL_PARAMS.get("gallery") === "1") {
    const galleryNode = String(INITIAL_PARAMS.get("galleryNode") || "").toLowerCase();
    photoGallery.open(/^[0-9a-f]{64}$/.test(galleryNode) ? { nodeKey: galleryNode } : {});
  }
  if (INITIAL_PACKET_HASH) void openPacketByHash(INITIAL_PACKET_HASH);
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
