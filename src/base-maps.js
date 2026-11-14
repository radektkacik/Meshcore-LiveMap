// Base maps (MapLibre styles). Each entry builds its style for the current theme: an object, a style URL
// or a promise of one. The vector maps have their own dark versions, the OSM raster map is inverted.
import { getOpenTopoMapStyle } from "./opentopomap.js";

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

function rasterStyle(id, source, paint = {}) {
  return {
    version: 8,
    sources: { [id]: { type: "raster", tileSize: 256, ...source } },
    layers: [{ id, type: "raster", source: id, paint }],
  };
}

// the classic openstreetmap.org map; in the dark theme its colours are inverted (keeping their hues)
function osmStandard(dark) {
  const darkPaint = { "raster-brightness-min": 0.9, "raster-brightness-max": 0.08, "raster-hue-rotate": 180, "raster-contrast": -0.05 };
  return rasterStyle("osm", {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    maxzoom: 19,
    attribution: OSM_ATTRIBUTION,
  }, dark ? darkPaint : {});
}

export const BASE_MAPS = {
  osm: { label: "OSM", themed: true, style: osmStandard },
  // OpenStreetMap data as vector tiles (OpenFreeMap)
  vector: {
    label: "OSM Vector",
    themed: true,
    style: (dark) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "liberty"}`,
  },
  // OpenStreetMap data as vector tiles (VersaTiles)
  versatiles: {
    label: "VersaTiles",
    themed: true,
    style: (dark) => `https://tiles.versatiles.org/assets/styles/${dark ? "colorful-dark" : "colorful"}/style.json`,
  },
  // topographic: contour lines, hillshade and elevation colours; Europe only
  topo: { label: "OpenTopoMap", themed: false, style: getOpenTopoMapStyle },
  sat: {
    label: "Satellite",
    themed: false,
    style: () => rasterStyle("satellite", {
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      // highest tile zoom provided, the map overzooms past it
      maxzoom: 18,
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    }),
  },
};

export const DEFAULT_BASE_MAP = "osm";
// base map keys stored by earlier versions (Leaflet): the inverted OSM map was a map of its own
export const LEGACY_BASE_MAPS = { dark: "osm" };
