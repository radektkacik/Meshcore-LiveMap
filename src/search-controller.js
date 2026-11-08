import { escapeHtml } from "../html.mjs";
import { formatDateTimeShort, roleLabel, t } from "./i18n.js";
import { parseNodeQuery, validCoords } from "./node-model.js";
import { searchEntities } from "./search-model.js";

const SEARCH_LIMIT_PER_TYPE = 4;

export function createSearchController({
  elements,
  ensureData,
  feedState,
  getJson,
  observerHealth,
  onRevealNode,
  onRevealObserver,
  onRevealPacket,
  routeStore,
  shortNodePrefix,
  state,
  typeLabels,
}) {
  let activeIndex = -1;
  let remotePrefix = "";
  let remoteRequestId = 0;
  let remoteResults = [];
  let remoteTimer = null;

  function searchPacketCandidates() {
    const byHash = new Map();
    const add = (route) => {
      const hash = String(route.packetHash || "").toUpperCase();
      if (!hash) return;
      const previous = byHash.get(hash);
      if (!previous || (route.timestamp || 0) > (previous.timestamp || 0)) byHash.set(hash, route);
    };
    for (const route of routeStore.history) add(route);
    for (const route of routeStore.liveByVersion.values()) add(route);
    return [...byHash.values()];
  }

  function resultTitle(kind, item) {
    if (kind === "node") return item.name || t("common.unknownNode");
    if (kind === "observer") return item.name || t("packet.unknownObserver");
    if (kind === "packet") return `#${String(item.hash || "").toUpperCase()}`;
    const text = String(item.text || "");
    return `${item.channel} · ${text.length > 54 ? `${text.slice(0, 54)}…` : text}`;
  }

  function formatTime(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? formatDateTimeShort(timestamp) : "";
  }

  function resultMeta(kind, item) {
    if (kind === "node") {
      return [
        roleLabel(item.role),
        shortNodePrefix(item),
        validCoords(item.lat, item.lon) ? null : t("node.noLocation"),
      ].filter(Boolean).join(" · ");
    }
    if (kind === "observer") return [item.iata, t(`network.${observerHealth(item)}`)].filter(Boolean).join(" · ");
    if (kind === "packet") return [item.typeLabel, formatTime(item.timestamp)].filter(Boolean).join(" · ");
    return [item.sender, formatTime(item.timestamp)].filter(Boolean).join(" · ");
  }

  function resultButtons() {
    return [...elements.searchResults.querySelectorAll("button")];
  }

  function highlightResult(index) {
    const buttons = resultButtons();
    if (!buttons.length) return;
    activeIndex = (index + buttons.length) % buttons.length;
    buttons.forEach((button, position) => button.classList.toggle("active", position === activeIndex));
    buttons[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function hideResults() {
    elements.searchResults.hidden = true;
    elements.nodeSearch.setAttribute("aria-expanded", "false");
  }

  function selectResult(kind, item) {
    hideResults();
    activeIndex = -1;
    if (kind === "node") elements.nodeSearch.value = item.name || "";
    elements.nodeSearch.blur();
    if (kind === "node") onRevealNode(item);
    else if (kind === "observer") void onRevealObserver(item);
    else if (kind === "packet") void onRevealPacket(item.hash);
    else if (kind === "channel") void onRevealPacket(item.hash);
  }

  function render() {
    activeIndex = -1;
    const parsed = parseNodeQuery(elements.nodeSearch.value);
    const packets = searchPacketCandidates();
    if (remotePrefix && parsed.hexQuery === remotePrefix) packets.push(...remoteResults);
    const result = searchEntities({
      channels: feedState.channelMessages,
      limit: SEARCH_LIMIT_PER_TYPE,
      nodes: [...state.nodeByKey.values()],
      observers: state.observers,
      packets,
      query: elements.nodeSearch.value,
    });
    const groups = [
      ["node", t("search.nodes"), result.nodes],
      ["observer", t("search.observers"), result.observers],
      ["packet", t("search.packets"), result.packets],
      ["channel", t("search.channels"), result.channels],
    ].filter(([, , items]) => items.length);

    elements.searchResults.replaceChildren();
    elements.nodeSearch.setAttribute("aria-expanded", String(groups.length > 0));
    if (!groups.length) {
      elements.searchResults.hidden = true;
      return;
    }

    for (const [kind, label, items] of groups) {
      const heading = document.createElement("li");
      heading.className = "search-group-title";
      heading.textContent = label;
      elements.searchResults.appendChild(heading);
      for (const item of items) {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.innerHTML = `<strong>${escapeHtml(resultTitle(kind, item))}</strong><small>${escapeHtml(resultMeta(kind, item))}</small>`;
        button.addEventListener("click", () => selectResult(kind, item));
        row.appendChild(button);
        elements.searchResults.appendChild(row);
      }
    }
    elements.searchResults.hidden = false;
  }

  function refreshIfActive() {
    if (elements.nodeSearch.value.trim().length >= 2) render();
  }

  function scheduleRemote() {
    if (remoteTimer) clearTimeout(remoteTimer);
    const { hexQuery } = parseNodeQuery(elements.nodeSearch.value);
    if (!hexQuery || hexQuery.length < 2) {
      remotePrefix = "";
      remoteResults = [];
      return;
    }
    remoteTimer = setTimeout(() => {
      void loadRemote(hexQuery);
    }, 180);
  }

  async function loadRemote(prefix) {
    const requestId = ++remoteRequestId;
    try {
      const data = await getJson(`/api/search?hash=${encodeURIComponent(prefix)}`);
      if (requestId !== remoteRequestId) return;
      remotePrefix = prefix;
      remoteResults = (data.hashes || []).map((row) => ({
        hash: String(row.hash || "").toUpperCase(),
        timestamp: Number(row.observed_at) || 0,
        typeLabel: typeLabels[Number(row.payload_type)] || "?",
      }));
      if (parseNodeQuery(elements.nodeSearch.value).hexQuery === prefix) render();
    } catch (error) {
      console.error("Hledání paketů se nepodařilo", error);
    }
  }

  function ensureSearchData() {
    ensureData(refreshIfActive);
  }

  function bind() {
    elements.nodeSearch.addEventListener("input", () => {
      ensureSearchData();
      scheduleRemote();
      render();
    });
    elements.nodeSearch.addEventListener("focus", () => {
      ensureSearchData();
      scheduleRemote();
      if (elements.nodeSearch.value.trim()) render();
    });
    elements.nodeSearch.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideResults();
        elements.nodeSearch.blur();
        return;
      }
      const buttons = resultButtons();
      if (!buttons.length) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        highlightResult(activeIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlightResult(activeIndex - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        buttons[activeIndex >= 0 ? activeIndex : 0].click();
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".node-search")) hideResults();
    });
  }

  return { bind, refresh: refreshIfActive };
}
