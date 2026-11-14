// Map engine: MapLibre GL with the small slice of a Leaflet-like API the app uses (layer groups,
// polylines, circle markers, HTML markers, popups, tooltips, image overlays).
//
// Vector layers (polylines, circle markers, circles) are not DOM/canvas objects of their own: they are
// features in a few GeoJSON sources drawn by MapLibre, rebuilt at most once per frame. HTML markers are
// MapLibre markers. Overlay sources/layers survive base map switches (they are re-added to every style).
//
// Zoom levels: the app keeps classic 256px-tile zoom levels (URL params, thresholds); MapLibre's zoom is
// based on 512px tiles, one lower at the same scale. All conversions happen here.
import { Map as MapLibreMap, Marker as MapLibreMarker, NavigationControl, Popup as MapLibrePopup, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);

const toMapZoom = (zoom) => zoom - 1;
const fromMapZoom = (zoom) => zoom + 1;

const EARTH_RADIUS_M = 6371000;
// how far (in pixels) from a line or circle a click/hover still hits it
const HIT_TOLERANCE_PX = 6;

const PREFIX = "ov-";
const LINE_SOURCE = `${PREFIX}lines`;
const POINT_SOURCE = `${PREFIX}points`;
const FILL_SOURCE = `${PREFIX}fills`;
const FILL_LAYER = `${PREFIX}fill`;
// solid lines; dashed ones get a layer per dash pattern (MapLibre's dashes can't be data driven)
const SOLID_LINE_LAYER = `${PREFIX}line`;
const CIRCLE_LAYERS = { overlayPane: `${PREFIX}circle`, markerPane: `${PREFIX}circle-marker` };

// ---------------------------------------------------------------------------------------------------
// Geometry helpers

export class LatLng {
  constructor(lat, lng) {
    this.lat = Number(lat);
    this.lng = Number(lng);
  }

  equals(other) {
    const latlng = toLatLng(other);
    return Boolean(latlng) && latlng.lat === this.lat && latlng.lng === this.lng;
  }

  toArray() {
    return [this.lng, this.lat];
  }
}

export function toLatLng(value) {
  if (value == null) return null;
  if (value instanceof LatLng) return value;
  if (Array.isArray(value)) return new LatLng(value[0], value[1]);
  if (typeof value === "object" && "lat" in value) return new LatLng(value.lat, value.lng ?? value.lon);
  return null;
}

export class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  distanceTo(other) {
    return Math.hypot(other.x - this.x, other.y - this.y);
  }
}

export class LatLngBounds {
  constructor(points = []) {
    this._south = Infinity;
    this._west = Infinity;
    this._north = -Infinity;
    this._east = -Infinity;
    const list = Array.isArray(points) && points.length && !Array.isArray(points[0]) && typeof points[0] !== "object"
      ? [points]
      : (Array.isArray(points) ? points : [points]);
    for (const point of list) this.extend(point);
  }

  extend(value) {
    if (value instanceof LatLngBounds) {
      if (!value.isValid()) return this;
      this.extend([value._south, value._west]);
      return this.extend([value._north, value._east]);
    }
    const latlng = toLatLng(value);
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return this;
    this._south = Math.min(this._south, latlng.lat);
    this._north = Math.max(this._north, latlng.lat);
    this._west = Math.min(this._west, latlng.lng);
    this._east = Math.max(this._east, latlng.lng);
    return this;
  }

  isValid() {
    return this._south <= this._north && this._west <= this._east;
  }

  getSouth() { return this._south; }
  getNorth() { return this._north; }
  getWest() { return this._west; }
  getEast() { return this._east; }

  getCenter() {
    return new LatLng((this._south + this._north) / 2, (this._west + this._east) / 2);
  }

  pad(ratio) {
    const dLat = (this._north - this._south) * ratio;
    const dLng = (this._east - this._west) * ratio;
    return new LatLngBounds([[this._south - dLat, this._west - dLng], [this._north + dLat, this._east + dLng]]);
  }

  contains(value) {
    if (value instanceof LatLngBounds) {
      return value._south >= this._south && value._north <= this._north
        && value._west >= this._west && value._east <= this._east;
    }
    const latlng = toLatLng(value);
    return Boolean(latlng)
      && latlng.lat >= this._south && latlng.lat <= this._north
      && latlng.lng >= this._west && latlng.lng <= this._east;
  }

  intersects(other) {
    return other._south <= this._north && other._north >= this._south
      && other._west <= this._east && other._east >= this._west;
  }

  toLngLatBounds() {
    return [[this._west, this._south], [this._east, this._north]];
  }
}

export const latLng = (lat, lng) => toLatLng(lng === undefined ? lat : [lat, lng]);
export const latLngBounds = (points) => (points instanceof LatLngBounds ? points : new LatLngBounds(points));
export const point = (x, y) => new Point(x, y);

// great circle distance in metres
export function distance(a, b) {
  const from = toLatLng(a);
  const to = toLatLng(b);
  const rad = Math.PI / 180;
  const sinLat = Math.sin(((to.lat - from.lat) * rad) / 2);
  const sinLng = Math.sin(((to.lng - from.lng) * rad) / 2);
  const h = sinLat * sinLat + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------------------------------
// DOM event helpers

export const DomEvent = {
  // stops a map/layer event from reaching the map's own handlers
  stopPropagation(event) {
    if (!event) return;
    event._stopped = true;
    if (event.originalEvent) event.originalEvent._stopped = true;
  },
  // clicks inside the element don't reach the map
  disableClickPropagation(element) {
    for (const type of ["click", "dblclick", "mousedown", "pointerdown", "touchstart"]) {
      element.addEventListener(type, (event) => event.stopPropagation());
    }
  },
  // scrolling inside the element doesn't zoom the map
  disableScrollPropagation(element) {
    element.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  },
};

// ---------------------------------------------------------------------------------------------------
// Events

class Evented {
  on(types, handler, context) {
    this._handlers ??= new Map();
    for (const type of String(types).split(/\s+/).filter(Boolean)) {
      if (!this._handlers.has(type)) this._handlers.set(type, []);
      this._handlers.get(type).push({ handler, context });
    }
    return this;
  }

  off(types, handler) {
    for (const type of String(types).split(/\s+/).filter(Boolean)) {
      const list = this._handlers?.get(type);
      if (!list) continue;
      this._handlers.set(type, handler ? list.filter((entry) => entry.handler !== handler) : []);
    }
    return this;
  }

  listens(type) {
    return Boolean(this._handlers?.get(type)?.length);
  }

  fire(type, data = {}) {
    const list = this._handlers?.get(type);
    if (!list?.length) return this;
    const event = Object.assign(data, { type, target: data.target ?? this });
    for (const { handler, context } of [...list]) handler.call(context ?? this, event);
    return this;
  }
}

// ---------------------------------------------------------------------------------------------------
// Popups and tooltips

function resolveContent(content, layer) {
  return typeof content === "function" ? content(layer) : content;
}

function contentNode(content) {
  if (content instanceof Node) return content;
  const div = document.createElement("div");
  div.innerHTML = content == null ? "" : String(content);
  return div;
}

export class Popup extends Evented {
  constructor(options = {}) {
    super();
    this.options = { closeButton: true, autoPan: true, offset: 8, ...options };
    this._latlng = null;
    this._content = null;
    this._popup = null;
    this._map = null;
  }

  setLatLng(latlng) {
    this._latlng = toLatLng(latlng);
    this._popup?.setLngLat(this._latlng.toArray());
    return this;
  }

  getLatLng() {
    return this._latlng;
  }

  setContent(content) {
    this._content = content;
    if (this._popup) this._popup.setDOMContent(this._wrapContent());
    return this;
  }

  getElement() {
    return this._popup?.getElement() ?? null;
  }

  isOpen() {
    return Boolean(this._popup);
  }

  openOn(map) {
    map._openPopup(this);
    return this;
  }

  close() {
    this._map?._closePopup(this);
    return this;
  }

  _wrapContent() {
    const wrapper = document.createElement("div");
    wrapper.className = "map-popup-content";
    if (this.options.minWidth) wrapper.style.minWidth = `${this.options.minWidth}px`;
    wrapper.append(contentNode(this._content));
    return wrapper;
  }

  _show(map) {
    this._map = map;
    const { className, closeButton, maxWidth, offset } = this.options;
    this._popup = new MapLibrePopup({
      anchor: "bottom",
      className: ["map-popup", className].filter(Boolean).join(" "),
      closeButton,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: false,
      maxWidth: `${maxWidth || 300}px`,
      offset,
    })
      .setLngLat(this._latlng.toArray())
      .setDOMContent(this._wrapContent())
      .addTo(map._map);
    this._popup.on("close", () => {
      if (!this._popup) return;
      this._popup = null;
      map._popupClosed(this);
    });
    if (this.options.autoPan) requestAnimationFrame(() => this._autoPan());
  }

  _hide() {
    const popup = this._popup;
    this._popup = null;
    popup?.remove();
  }

  _autoPan() {
    const element = this.getElement();
    if (!element || !this._map) return;
    const container = this._map.getContainer().getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const topLeft = this.options.autoPanPaddingTopLeft ?? this.options.autoPanPadding ?? new Point(8, 8);
    const bottomRight = this.options.autoPanPaddingBottomRight ?? this.options.autoPanPadding ?? new Point(8, 8);
    let dx = 0;
    let dy = 0;
    if (rect.right + bottomRight.x > container.right) dx = rect.right + bottomRight.x - container.right;
    if (rect.left - dx - topLeft.x < container.left) dx = rect.left - topLeft.x - container.left;
    if (rect.bottom + bottomRight.y > container.bottom) dy = rect.bottom + bottomRight.y - container.bottom;
    if (rect.top - dy - topLeft.y < container.top) dy = rect.top - topLeft.y - container.top;
    if (dx || dy) this._map._map.panBy([dx, dy]);
  }
}

class Tooltip {
  constructor(content, options = {}) {
    this.content = content;
    this.options = options;
    this._element = null;
  }

  getElement() {
    return this._element;
  }

  _open(map, layer, mousePoint) {
    if (!this._element) {
      this._element = document.createElement("div");
      map.getContainer().append(this._element);
    }
    const direction = this.options.direction === "top" ? "top" : "right";
    this._element.className = ["map-tooltip", `map-tooltip-${direction}`, this.options.className].filter(Boolean).join(" ");
    this._element.innerHTML = String(resolveContent(this.content, layer) ?? "");
    this._direction = direction;
    this._update(map, layer, mousePoint);
  }

  _update(map, layer, mousePoint) {
    if (!this._element) return;
    let anchor;
    if (this.options.sticky && mousePoint) anchor = mousePoint;
    else anchor = layer._tooltipAnchor(map, this._direction) ?? mousePoint;
    if (!anchor) return;
    this._element.style.left = `${anchor.x}px`;
    this._element.style.top = `${anchor.y}px`;
  }

  _close() {
    this._element?.remove();
    this._element = null;
  }
}

// ---------------------------------------------------------------------------------------------------
// Layers

let nextLayerId = 1;

class Layer extends Evented {
  constructor(options = {}) {
    super();
    this.options = { interactive: true, ...options };
    this._id = nextLayerId++;
    this._map = null;
    this._parents = new Set();
  }

  // adds the layer to a map or a layer group
  addTo(target) {
    target.addLayer(this);
    return this;
  }

  remove() {
    if (this._map) this._map.removeLayer(this);
    for (const parent of [...this._parents]) parent.removeLayer(this);
    return this;
  }

  getElement() {
    return null;
  }

  // tooltips

  bindTooltip(content, options = {}) {
    this.unbindTooltip();
    this._tooltip = new Tooltip(content, options);
    return this;
  }

  unbindTooltip() {
    if (this._tooltip && this._map) this._map._hideTooltip(this);
    this._tooltip = null;
    return this;
  }

  setTooltipContent(content) {
    if (this._tooltip) this._tooltip.content = content;
    return this;
  }

  getTooltip() {
    return this._tooltip ?? null;
  }

  // popups

  bindPopup(content, options = {}) {
    this._popupContent = content;
    this._popupOptions = options;
    return this;
  }

  // a click opens the bound popup (unless the layer handles clicks itself: see openOnClick)
  _openPopupOnClick(event) {
    if (!this._popupContent || this._popupOptions?.openOnClick === false || this.isPopupOpen()) return;
    this.openPopup(this._popupLatLng(event.latlng));
  }

  openPopup(latlng) {
    if (!this._popupContent || !this._map) return this;
    const popup = new Popup(this._popupOptions);
    popup._source = this;
    popup.setLatLng(latlng ?? this._popupLatLng()).setContent(resolveContent(this._popupContent, this));
    this._popup = popup;
    this._map._openPopup(popup);
    return this;
  }

  closePopup() {
    if (this._popup) this._popup.close();
    return this;
  }

  isPopupOpen() {
    return Boolean(this._popup?.isOpen());
  }

  getPopup() {
    return this._popup ?? null;
  }

  _popupLatLng(fallback) {
    return this.getLatLng?.() ?? fallback;
  }

  _tooltipAnchor() {
    return null;
  }

  _onAdd() {}

  _onRemove() {}
}

export class LayerGroup extends Layer {
  constructor(layers = []) {
    super();
    this._layers = new Set();
    for (const layer of layers) this.addLayer(layer);
  }

  addLayer(layer) {
    this._layers.add(layer);
    layer._parents.add(this);
    if (this._map) this._map.addLayer(layer);
    return this;
  }

  removeLayer(layer) {
    if (!this._layers.has(layer)) return this;
    this._layers.delete(layer);
    layer._parents.delete(this);
    if (this._map && layer._map) this._map.removeLayer(layer);
    return this;
  }

  hasLayer(layer) {
    return this._layers.has(layer);
  }

  clearLayers() {
    for (const layer of [...this._layers]) this.removeLayer(layer);
    return this;
  }

  getLayers() {
    return [...this._layers];
  }

  eachLayer(callback) {
    for (const layer of [...this._layers]) callback(layer);
    return this;
  }

  _onAdd(map) {
    for (const layer of this._layers) map.addLayer(layer);
  }

  _onRemove(map) {
    for (const layer of this._layers) if (layer._map) map.removeLayer(layer);
  }
}

// Lines, circle markers and circles: features in the shared GeoJSON sources

const PATH_DEFAULTS = {
  color: "#3388ff",
  weight: 3,
  opacity: 1,
  fill: false,
  fillColor: null,
  fillOpacity: 0.2,
  dashArray: null,
  // dashed lines with this option move with Map#setDashOffset (route animation)
  animateDash: false,
  pane: "overlayPane",
};

let sortFront = 0;
let sortBack = 0;

class Path extends Layer {
  constructor(options) {
    super({ ...PATH_DEFAULTS, ...options });
    this._sort = 0;
  }

  setStyle(style) {
    Object.assign(this.options, style);
    this._changed();
    return this;
  }

  bringToFront() {
    this._sort = ++sortFront;
    this._changed();
    return this;
  }

  bringToBack() {
    this._sort = --sortBack;
    this._changed();
    return this;
  }

  _changed() {
    this._map?._vectors.changed(this);
  }

  _onAdd(map) {
    map._vectors.add(this);
  }

  _onRemove(map) {
    map._vectors.remove(this);
  }

  _baseProperties() {
    const { color, opacity, weight } = this.options;
    return { lid: this._id, color, opacity, weight, sort: this._sort, interactive: this.options.interactive !== false };
  }
}

export class Polyline extends Path {
  constructor(latlngs, options) {
    super(options);
    this._latlngs = latlngs.map(toLatLng);
  }

  getLatLngs() {
    return this._latlngs;
  }

  setLatLngs(latlngs) {
    this._latlngs = latlngs.map(toLatLng);
    this._changed();
    return this;
  }

  getBounds() {
    return new LatLngBounds(this._latlngs);
  }

  _features() {
    if (this._latlngs.length < 2) return [];
    return [{
      kind: "line",
      dash: dashKey(this.options),
      geometry: { type: "LineString", coordinates: this._latlngs.map((latlng) => latlng.toArray()) },
      properties: this._baseProperties(),
    }];
  }
}

export class CircleMarker extends Path {
  constructor(latlng, options) {
    super({ radius: 10, fill: true, ...options });
    this._latlng = toLatLng(latlng);
  }

  getLatLng() {
    return this._latlng;
  }

  setLatLng(latlng) {
    this._latlng = toLatLng(latlng);
    this._changed();
    if (this._popup?.isOpen()) this._popup.setLatLng(this._latlng);
    return this;
  }

  setRadius(radius) {
    return this.setStyle({ radius });
  }

  _features() {
    const { radius, fillColor, fillOpacity, color, fill } = this.options;
    return [{
      kind: "point",
      geometry: { type: "Point", coordinates: this._latlng.toArray() },
      properties: {
        ...this._baseProperties(),
        pane: this.options.pane === "markerPane" ? "markerPane" : "overlayPane",
        radius,
        fillColor: fillColor ?? color,
        fillOpacity: fill === false ? 0 : fillOpacity,
      },
    }];
  }

  _tooltipAnchor(map, direction) {
    const center = map.latLngToContainerPoint(this._latlng);
    const radius = Number(this.options.radius) || 0;
    return direction === "top" ? new Point(center.x, center.y - radius) : new Point(center.x + radius, center.y);
  }

  _popupLatLng() {
    return this._latlng;
  }
}

// a circle with its radius in metres
export class Circle extends CircleMarker {
  _ring() {
    const steps = 72;
    const { lat, lng } = this._latlng;
    const radius = Number(this.options.radius) || 0;
    const angular = radius / EARTH_RADIUS_M;
    const rad = Math.PI / 180;
    const lat1 = lat * rad;
    const ring = [];
    for (let step = 0; step <= steps; step += 1) {
      const bearing = (step / steps) * 2 * Math.PI;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
      const lng2 = lng * rad + Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
      ring.push([lng2 / rad, lat2 / rad]);
    }
    return ring;
  }

  _features() {
    const ring = this._ring();
    const base = this._baseProperties();
    const { fillColor, fillOpacity, color, fill } = this.options;
    return [
      {
        kind: "fill",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { ...base, fillColor: fillColor ?? color, fillOpacity: fill === false ? 0 : fillOpacity },
      },
      { kind: "line", dash: dashKey(this.options), geometry: { type: "LineString", coordinates: ring }, properties: base },
    ];
  }

  _tooltipAnchor(map) {
    return map.latLngToContainerPoint(this._latlng);
  }
}

function parseDash(dashArray) {
  if (!dashArray) return null;
  const values = String(dashArray).split(/[\s,]+/).map(Number).filter((value) => Number.isFinite(value) && value >= 0);
  return values.length >= 2 ? values : null;
}

// dashed lines are grouped by pattern and width (the pattern is in line widths in MapLibre)
function dashKey(options) {
  const dash = parseDash(options.dashArray);
  if (!dash) return null;
  return `${dash.join("_")}-w${options.weight}${options.animateDash ? "-a" : ""}`;
}

// The dash pattern (pixels) started `offset` pixels into it (like a canvas' lineDashOffset), in line widths
function shiftedDash(dash, weight, offset) {
  const pattern = dash.length % 2 ? [...dash, ...dash] : dash;
  const total = pattern.reduce((sum, value) => sum + value, 0);
  const shift = total > 0 ? ((offset % total) + total) % total : 0;
  if (!shift) return pattern.map((value) => value / weight);
  // the entry the shift falls into is split: its rest starts the pattern, the skipped part goes last
  let position = 0;
  let index = 0;
  while (position + pattern[index] <= shift) {
    position += pattern[index];
    index += 1;
  }
  const head = [position + pattern[index] - shift, ...pattern.slice(index + 1)];
  const tail = [...pattern.slice(0, index), shift - position];
  // dashes and gaps alternate, starting with a dash: a gap's rest follows an empty dash
  const result = index % 2 ? [0, ...head, ...tail] : [...head, ...tail];
  if (result.length % 2) result.push(0);
  return result.map((value) => value / weight);
}

// The vector layers on a map, as GeoJSON features rebuilt (at most once per frame) when they change
class VectorStore {
  constructor(map) {
    this._mapView = map;
    this._layers = new Map();
    this._dashLayers = new Map();
    this._dashOffset = 0;
    this._frame = null;
    this._data = { [LINE_SOURCE]: emptyCollection(), [POINT_SOURCE]: emptyCollection(), [FILL_SOURCE]: emptyCollection() };
  }

  add(layer) {
    this._layers.set(layer._id, layer);
    this._schedule();
  }

  remove(layer) {
    if (this._layers.delete(layer._id)) this._schedule();
  }

  changed(layer) {
    if (this._layers.has(layer._id)) this._schedule();
  }

  get(id) {
    return this._layers.get(Number(id)) ?? null;
  }

  _schedule() {
    if (this._frame != null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.flush();
    });
  }

  flush() {
    const lines = [];
    const points = [];
    const fills = [];
    const usedDash = new Map();
    for (const layer of this._layers.values()) {
      for (const feature of layer._features()) {
        const geojson = { type: "Feature", geometry: feature.geometry, properties: feature.properties };
        if (feature.kind === "line") {
          geojson.properties.dash = feature.dash ?? "";
          if (feature.dash) {
            usedDash.set(feature.dash, { dash: parseDash(layer.options.dashArray), weight: layer.options.weight, animated: Boolean(layer.options.animateDash) });
          }
          lines.push(geojson);
        } else if (feature.kind === "point") {
          points.push(geojson);
        } else {
          fills.push(geojson);
        }
      }
    }
    this._data = {
      [LINE_SOURCE]: { type: "FeatureCollection", features: lines },
      [POINT_SOURCE]: { type: "FeatureCollection", features: points },
      [FILL_SOURCE]: { type: "FeatureCollection", features: fills },
    };
    for (const [key, spec] of usedDash) if (!this._dashLayers.has(key)) this._dashLayers.set(key, spec);
    // while a base map loads, its style gets the data when it's ready (MapView#_withOverlays)
    const map = this._mapView._map;
    for (const [id, data] of Object.entries(this._data)) map.getSource(id)?.setData(data);
    for (const [key, spec] of this._dashLayers) {
      const id = dashLayerId(key);
      if (!map.getLayer(id) && map.getLayer(CIRCLE_LAYERS.overlayPane)) map.addLayer(this._dashLayerSpec(key, spec), CIRCLE_LAYERS.overlayPane);
    }
  }

  setDashOffset(offset) {
    this._dashOffset = offset;
    const map = this._mapView._map;
    for (const [key, spec] of this._dashLayers) {
      if (!spec.animated) continue;
      const id = dashLayerId(key);
      if (map.getLayer(id)) map.setPaintProperty(id, "line-dasharray", shiftedDash(spec.dash, spec.weight, offset));
    }
  }

  layerIds() {
    return [FILL_LAYER, SOLID_LINE_LAYER, ...[...this._dashLayers.keys()].map(dashLayerId), CIRCLE_LAYERS.overlayPane, CIRCLE_LAYERS.markerPane];
  }

  // sources and layers to put on top of a base map style
  styleSources() {
    return Object.fromEntries(Object.entries(this._data).map(([id, data]) => [id, { type: "geojson", data }]));
  }

  styleLayers() {
    const linePaint = {
      "line-color": ["get", "color"],
      "line-opacity": ["get", "opacity"],
      "line-width": ["get", "weight"],
    };
    const lineLayout = { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "sort"] };
    const circle = (id, pane) => ({
      id,
      type: "circle",
      source: POINT_SOURCE,
      filter: ["==", ["get", "pane"], pane],
      layout: { "circle-sort-key": ["get", "sort"] },
      paint: {
        // Leaflet-style radius: to the middle of the outline
        "circle-radius": ["max", 0, ["-", ["get", "radius"], ["/", ["get", "weight"], 2]]],
        "circle-color": ["get", "fillColor"],
        "circle-opacity": ["get", "fillOpacity"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-opacity": ["get", "opacity"],
        "circle-stroke-width": ["get", "weight"],
        "circle-pitch-alignment": "map",
      },
    });
    return [
      {
        id: FILL_LAYER,
        type: "fill",
        source: FILL_SOURCE,
        paint: { "fill-color": ["get", "fillColor"], "fill-opacity": ["get", "fillOpacity"] },
      },
      { id: SOLID_LINE_LAYER, type: "line", source: LINE_SOURCE, filter: ["==", ["get", "dash"], ""], layout: lineLayout, paint: linePaint },
      ...[...this._dashLayers].map(([key, spec]) => this._dashLayerSpec(key, spec)),
      circle(CIRCLE_LAYERS.overlayPane, "overlayPane"),
      circle(CIRCLE_LAYERS.markerPane, "markerPane"),
    ];
  }

  _dashLayerSpec(key, spec) {
    return {
      id: dashLayerId(key),
      type: "line",
      source: LINE_SOURCE,
      filter: ["==", ["get", "dash"], key],
      layout: { "line-cap": "butt", "line-join": "round", "line-sort-key": ["get", "sort"] },
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": ["get", "opacity"],
        "line-width": ["get", "weight"],
        "line-dasharray": shiftedDash(spec.dash, spec.weight, spec.animated ? this._dashOffset : 0),
      },
    };
  }
}

const dashLayerId = (key) => `${PREFIX}line-dash-${key}`;

function emptyCollection() {
  return { type: "FeatureCollection", features: [] };
}

// HTML markers

export function divIcon(options = {}) {
  return { className: "", html: "", iconSize: [12, 12], ...options };
}

export class Marker extends Layer {
  constructor(latlng, options = {}) {
    super({ draggable: false, ...options });
    this._latlng = toLatLng(latlng);
    this._element = document.createElement("div");
    this._marker = null;
    this._applyIcon(this.options.icon ?? divIcon());
    this._element.addEventListener("click", (event) => this._domClick(event));
    this._element.addEventListener("mouseenter", (event) => this._map?._showTooltip(this, this._map._eventPoint(event)));
    this._element.addEventListener("mousemove", (event) => {
      if (this._tooltip?.options.sticky) this._map?._showTooltip(this, this._map._eventPoint(event));
    });
    this._element.addEventListener("mouseleave", () => this._map?._hideTooltip(this));
  }

  getElement() {
    return this._element;
  }

  getLatLng() {
    return this._latlng;
  }

  setLatLng(latlng) {
    this._latlng = toLatLng(latlng);
    this._marker?.setLngLat(this._latlng.toArray());
    if (this._popup?.isOpen()) this._popup.setLatLng(this._latlng);
    return this;
  }

  setIcon(icon) {
    this._applyIcon(icon);
    return this;
  }

  _applyIcon(icon) {
    const element = this._element;
    const interactive = this.options.interactive !== false;
    element.className = ["map-marker", icon.className, interactive ? "map-interactive" : "", this.options.draggable ? "map-draggable" : ""]
      .filter(Boolean)
      .join(" ");
    if (icon.html instanceof Node) element.replaceChildren(icon.html);
    else element.innerHTML = icon.html ?? "";
    const size = icon.iconSize;
    element.style.width = size ? `${size[0]}px` : "";
    element.style.height = size ? `${size[1]}px` : "";
    const anchor = icon.iconAnchor ?? (size ? [size[0] / 2, size[1] / 2] : [0, 0]);
    // positioned by its top left corner: the anchor is set with margins (like Leaflet, so a label can be
    // nudged by changing them)
    element.style.marginLeft = `${-anchor[0]}px`;
    element.style.marginTop = `${-anchor[1]}px`;
    element.style.zIndex = this.options.zIndexOffset ? String(this.options.zIndexOffset) : "";
    this._icon = icon;
  }

  _domClick(event) {
    if (this.options.interactive === false || !this._map) return;
    // marker clicks never reach the map's own click handlers
    event._stopped = true;
    const latlng = this._latlng;
    const layerEvent = { latlng, originalEvent: event, containerPoint: this._map._eventPoint(event) };
    this.fire("click", layerEvent);
    this._openPopupOnClick(layerEvent);
  }

  _onAdd(map) {
    this._marker = new MapLibreMarker({
      element: this._element,
      anchor: "top-left",
      draggable: Boolean(this.options.draggable),
    })
      .setLngLat(this._latlng.toArray())
      .addTo(map._map);
    if (this.options.draggable) {
      this._marker.on("dragstart", () => {
        map._hideTooltip(this);
        this.fire("dragstart");
      });
      this._marker.on("drag", () => {
        const { lng, lat } = this._marker.getLngLat();
        this._latlng = new LatLng(lat, lng);
        this.fire("drag");
      });
      this._marker.on("dragend", () => {
        const { lng, lat } = this._marker.getLngLat();
        this._latlng = new LatLng(lat, lng);
        this.fire("dragend");
      });
    }
  }

  _onRemove(map) {
    map._hideTooltip(this);
    this._marker?.remove();
    this._marker = null;
  }

  _tooltipAnchor(map, direction) {
    const container = map.getContainer().getBoundingClientRect();
    const rect = this._element.getBoundingClientRect();
    if (!rect.width && !rect.height) return map.latLngToContainerPoint(this._latlng);
    return direction === "top"
      ? new Point(rect.left + rect.width / 2 - container.left, rect.top - container.top)
      : new Point(rect.right - container.left, rect.top + rect.height / 2 - container.top);
  }

  _popupLatLng() {
    return this._latlng;
  }
}

// an image stretched over bounds, below the vector layers
export class ImageOverlay extends Layer {
  constructor(url, bounds, options = {}) {
    super({ opacity: 1, interactive: false, ...options });
    this._url = url;
    this._bounds = latLngBounds(bounds);
  }

  getBounds() {
    return this._bounds;
  }

  _onAdd(map) {
    map._addImageOverlay(this);
  }

  _onRemove(map) {
    map._removeImageOverlay(this);
  }

  _sourceSpec() {
    const b = this._bounds;
    return {
      type: "image",
      url: this._url,
      coordinates: [[b.getWest(), b.getNorth()], [b.getEast(), b.getNorth()], [b.getEast(), b.getSouth()], [b.getWest(), b.getSouth()]],
    };
  }

  _layerSpec() {
    return {
      id: `${PREFIX}image-${this._id}`,
      type: "raster",
      source: `${PREFIX}image-${this._id}`,
      paint: { "raster-opacity": this.options.opacity, "raster-fade-duration": 0 },
    };
  }
}

// ---------------------------------------------------------------------------------------------------
// Map

export class MapView extends Evented {
  constructor(container, options = {}) {
    super();
    const center = toLatLng(options.center ?? [0, 0]);
    this._map = new MapLibreMap({
      container,
      style: { version: 8, sources: {}, layers: [] },
      center: center.toArray(),
      zoom: toMapZoom(options.zoom ?? 2),
      minZoom: options.minZoom == null ? undefined : toMapZoom(options.minZoom),
      maxZoom: options.maxZoom == null ? undefined : toMapZoom(options.maxZoom),
      // the map stays north-up, like a classic slippy map
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      rollEnabled: false,
      fadeDuration: options.fadeAnimation === false ? 0 : 300,
      attributionControl: { compact: false },
    });
    this._map.touchZoomRotate.disableRotation();
    this._map.keyboard.disableRotation();
    this._container = this._map.getContainer();
    this._vectors = new VectorStore(this);
    this._images = new Map();
    this._popup = null;
    this._hovered = null;
    this._cursor = "";
    this._baseStyle = null;
    this._animate = options.zoomAnimation !== false;

    // clicks and hover on vector layers are found by hit testing the rendered features
    this._map.on("click", (event) => this._handleClick(event));
    this._map.on("mousemove", (event) => this._handleMouseMove(event));
    this._map.on("mouseout", (event) => {
      this._setHovered(null);
      this.fire("mouseout", this._wrapEvent(event));
    });
    this._map.on("move", () => this._updateTooltips());
    for (const type of ["moveend", "zoomend", "movestart", "zoomstart", "resize", "load"]) {
      this._map.on(type, () => this.fire(type));
    }
    this._map.on("style.load", () => this._vectors.flush());
    this._map.on("error", ({ error }) => {
      // Mapterhorn has no terrain tiles over open sea (OpenTopoMap's relief and contours ask anyway)
      if (/\b404\b.*tiles\.mapterhorn\.com/.test(String(error?.message ?? error))) return;
      console.error(error);
    });
  }

  // controls

  addZoomControl(position = "bottom-left") {
    this._map.addControl(new NavigationControl({ showCompass: false, visualizePitch: false }), position);
    return this;
  }

  // base map: a style (object or URL) or a promise of one; overlays are kept
  setBaseStyle(style) {
    const token = Symbol("style");
    this._baseStyle = token;
    Promise.resolve(style)
      .then((resolved) => {
        if (this._baseStyle !== token) return;
        this._map.setStyle(resolved, {
          diff: false,
          transformStyle: (_previous, next) => this._withOverlays(next),
        });
      })
      .catch((error) => console.error("Podklad mapy se nepodařilo načíst", error));
  }

  _withOverlays(style) {
    const sources = { ...style.sources, ...this._vectors.styleSources() };
    const imageLayers = [];
    for (const overlay of this._images.values()) {
      sources[overlay._layerSpec().source] = overlay._sourceSpec();
      imageLayers.push(overlay._layerSpec());
    }
    return { ...style, sources, layers: [...style.layers, ...imageLayers, ...this._vectors.styleLayers()] };
  }

  // layers

  addLayer(layer) {
    if (layer._map === this) return this;
    layer._map = this;
    layer._onAdd(this);
    return this;
  }

  removeLayer(layer) {
    if (layer._map !== this) return this;
    if (this._hovered === layer) this._setHovered(null);
    if (layer._popup?.isOpen()) layer._popup.close();
    layer._onRemove(this);
    layer._map = null;
    return this;
  }

  hasLayer(layer) {
    return layer?._map === this;
  }

  _addImageOverlay(overlay) {
    this._images.set(overlay._id, overlay);
    const layer = overlay._layerSpec();
    if (!this._map.getSource(layer.source) && this._map.getLayer(FILL_LAYER)) {
      this._map.addSource(layer.source, overlay._sourceSpec());
      this._map.addLayer(layer, FILL_LAYER);
    }
  }

  _removeImageOverlay(overlay) {
    this._images.delete(overlay._id);
    const layer = overlay._layerSpec();
    if (this._map.getLayer(layer.id)) this._map.removeLayer(layer.id);
    if (this._map.getSource(layer.source)) this._map.removeSource(layer.source);
  }

  // starts the animated dashed lines' dash pattern `offset` pixels into it (like a canvas' lineDashOffset)
  setDashOffset(offset) {
    this._vectors.setDashOffset(offset);
  }

  // view

  getZoom() {
    return fromMapZoom(this._map.getZoom());
  }

  getCenter() {
    const { lat, lng } = this._map.getCenter();
    return new LatLng(lat, lng);
  }

  getBounds() {
    const bounds = this._map.getBounds();
    return new LatLngBounds([[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]]);
  }

  getSize() {
    return new Point(this._container.clientWidth, this._container.clientHeight);
  }

  getContainer() {
    return this._container;
  }

  // the mouse cursor over the map (hovering a clickable layer still shows a pointer)
  setCursor(cursor) {
    this._cursor = cursor || "";
    this._map.getCanvas().style.cursor = this._hovered ? "pointer" : this._cursor;
  }

  setView(latlng, zoom) {
    this._map.jumpTo({ center: toLatLng(latlng).toArray(), zoom: toMapZoom(zoom ?? this.getZoom()) });
    return this;
  }

  flyTo(latlng, zoom, options = {}) {
    const target = { center: toLatLng(latlng).toArray(), zoom: toMapZoom(zoom ?? this.getZoom()) };
    if (!this._animate) this._map.jumpTo(target);
    else this._map.flyTo({ ...target, duration: (options.duration ?? 1) * 1000, essential: false });
    return this;
  }

  fitBounds(bounds, options = {}) {
    const box = latLngBounds(bounds);
    if (!box.isValid()) return this;
    const [x, y] = options.padding ?? [0, 0];
    this._map.fitBounds(box.toLngLatBounds(), {
      padding: { top: y, bottom: y, left: x, right: x },
      maxZoom: options.maxZoom == null ? undefined : toMapZoom(options.maxZoom),
      animate: this._animate,
      duration: 600,
    });
    return this;
  }

  latLngToContainerPoint(latlng) {
    const { x, y } = this._map.project(toLatLng(latlng).toArray());
    return new Point(x, y);
  }

  containerPointToLatLng(containerPoint) {
    const { lng, lat } = this._map.unproject([containerPoint.x, containerPoint.y]);
    return new LatLng(lat, lng);
  }

  distance(a, b) {
    return distance(a, b);
  }

  // popups

  closePopup() {
    if (this._popup) this._closePopup(this._popup);
    return this;
  }

  _openPopup(popup) {
    if (this._popup && this._popup !== popup) this._closePopup(this._popup);
    this._popup = popup;
    // the layer's tooltip would cover its popup
    if (popup._source) this._hideTooltip(popup._source);
    popup._show(this);
    popup._source?.fire("popupopen", { popup });
    this.fire("popupopen", { popup });
  }

  _closePopup(popup) {
    popup._hide();
    this._popupClosed(popup);
  }

  _popupClosed(popup) {
    if (this._popup !== popup) return;
    this._popup = null;
    popup._source?.fire("popupclose", { popup });
    this.fire("popupclose", { popup });
  }

  // tooltips

  _showTooltip(layer, mousePoint) {
    if (!layer._tooltip || this._container.classList.contains("los-dragging")) return;
    if (this._tooltipLayer && this._tooltipLayer !== layer) this._hideTooltip(this._tooltipLayer);
    const opening = this._tooltipLayer !== layer;
    this._tooltipLayer = layer;
    this._tooltipMouse = mousePoint;
    if (opening) {
      layer._tooltip._open(this, layer, mousePoint);
      layer.fire("tooltipopen", { tooltip: layer._tooltip });
    } else {
      layer._tooltip._update(this, layer, mousePoint);
    }
  }

  _hideTooltip(layer) {
    if (this._tooltipLayer !== layer) return;
    layer._tooltip?._close();
    this._tooltipLayer = null;
  }

  _updateTooltips() {
    const layer = this._tooltipLayer;
    if (layer?._tooltip && !layer._tooltip.options.sticky) layer._tooltip._update(this, layer, this._tooltipMouse);
  }

  // events

  _eventPoint(event) {
    const rect = this._container.getBoundingClientRect();
    return new Point(event.clientX - rect.left, event.clientY - rect.top);
  }

  _wrapEvent(event) {
    return {
      latlng: event.lngLat ? new LatLng(event.lngLat.lat, event.lngLat.lng) : null,
      containerPoint: event.point ? new Point(event.point.x, event.point.y) : null,
      originalEvent: event.originalEvent,
    };
  }

  // the topmost interactive vector layer at a point
  _vectorAt(screenPoint) {
    if (this._container.classList.contains("los-dragging")) return null;
    const layers = this._vectors.layerIds().filter((id) => this._map.getLayer(id));
    if (!layers.length) return null;
    const t = HIT_TOLERANCE_PX;
    const features = this._map.queryRenderedFeatures(
      [[screenPoint.x - t, screenPoint.y - t], [screenPoint.x + t, screenPoint.y + t]],
      { layers },
    );
    for (const feature of features) {
      if (!feature.properties?.interactive) continue;
      const layer = this._vectors.get(feature.properties.lid);
      if (layer?._map === this) return layer;
    }
    return null;
  }

  _handleClick(event) {
    const original = event.originalEvent;
    // clicks on HTML markers are handled by the marker
    if (original?._stopped) return;
    const wrapped = this._wrapEvent(event);
    const layer = this._vectorAt(event.point);
    // a click on the map closes the open popup before its handlers run (so they can open another)
    this.closePopup();
    if (layer) {
      const layerEvent = { ...wrapped, target: layer };
      layer.fire("click", layerEvent);
      layer._openPopupOnClick(layerEvent);
      if (layerEvent._stopped || original?._stopped) return;
    }
    this.fire("click", wrapped);
  }

  _handleMouseMove(event) {
    const wrapped = this._wrapEvent(event);
    const target = event.originalEvent?.target;
    const overMarker = target instanceof Element && Boolean(target.closest(".map-marker"));
    const layer = overMarker ? null : this._vectorAt(event.point);
    this._setHovered(layer, wrapped.containerPoint);
    this.fire("mousemove", wrapped);
  }

  _setHovered(layer, mousePoint) {
    const previous = this._hovered;
    if (previous && previous !== layer) {
      this._hideTooltip(previous);
      previous.fire("mouseout");
    }
    this._hovered = layer;
    if (layer) {
      if (previous !== layer) layer.fire("mouseover");
      this._showTooltip(layer, mousePoint);
    }
    this._map.getCanvas().style.cursor = layer ? "pointer" : this._cursor;
  }
}

// ---------------------------------------------------------------------------------------------------
// Factories (Leaflet-style)

export const map = (container, options) => new MapView(container, options);
export const layerGroup = (layers) => new LayerGroup(layers);
export const polyline = (latlngs, options) => new Polyline(latlngs, options);
export const circleMarker = (latlng, options) => new CircleMarker(latlng, options);
export const circle = (latlng, options) => new Circle(latlng, options);
export const marker = (latlng, options) => new Marker(latlng, options);
export const imageOverlay = (url, bounds, options) => new ImageOverlay(url, bounds, options);
export const popup = (options) => new Popup(options);
