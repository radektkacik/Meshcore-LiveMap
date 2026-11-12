import { escapeHtml } from "../html.mjs";
import { formatNumber, formatPercent, roleLabel, t } from "./i18n.js";
import { rankNodesByMetric, resolveStatsField } from "./node-model.js";

const STATS_ROLES = new Set(["repeater", "room", "sensor"]);

export function createStatsController({
  elements,
  getJson,
  loadObservers,
  loadStats,
  observerHealth,
  onRevealNode,
  state,
}) {
  let count = 10;
  let metric = "usefulness";
  let networkStats = null;
  let windowValue = "24h";

  function formatValue(field, value) {
    return field.endsWith("_score") ? formatPercent(value) : formatNumber(value);
  }

  function renderNetworkSummary() {
    if (!networkStats) {
      elements.networkSummary.replaceChildren();
      return;
    }
    const online = state.observers.filter((observer) => observerHealth(observer) === "online").length;
    const stale = state.observers.filter((observer) => observerHealth(observer) === "stale").length;
    const offline = state.observers.length - online - stale;
    const counts = networkStats.counts || {};
    elements.networkSummary.innerHTML = `
      <div class="network-grid">
        <div><span>${t("network.nodes")}</span><strong>${formatNumber(Number(networkStats.totalNodes || 0))}</strong></div>
        <div><span>${t("network.observers")}</span><strong>${formatNumber(state.observers.length)}</strong></div>
        <div><span>${t("network.packetsHour")}</span><strong>${formatNumber(Number(networkStats.packetsLastHour || 0))}</strong></div>
        <div><span>${t("network.packets24h")}</span><strong>${formatNumber(Number(networkStats.packetsLast24h || 0))}</strong></div>
      </div>
      <div class="network-observer-line">
        <span class="online"><b>${online}</b> ${t("network.online")}</span>
        <span class="stale"><b>${stale}</b> ${t("network.stale")}</span>
        <span class="offline"><b>${offline}</b> ${t("network.offline")}</span>
        <span>${t("network.roles", {
          repeaters: formatNumber(Number(counts.repeaters || 0)),
          rooms: formatNumber(Number(counts.rooms || 0)),
          companions: formatNumber(Number(counts.companions || 0)),
        })}</span>
      </div>
    `;
  }

  function renderStats() {
    if (elements.statsPanel.hidden) return;
    const field = resolveStatsField(metric, windowValue);
    if (!field) {
      const empty = document.createElement("li");
      empty.className = "stats-empty";
      empty.textContent = t("stats.emptyCombination");
      elements.statsList.replaceChildren(empty);
      return;
    }
    const ranked = rankNodesByMetric([...state.nodeByKey.values()], field, count, STATS_ROLES);
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
        <span class="stats-value">${escapeHtml(formatValue(field, value))}</span>
      `;
      button.addEventListener("click", () => onRevealNode(node));
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

  function bind() {
    elements.statsToggle.addEventListener("click", () => {
      const show = elements.statsPanel.hidden;
      elements.statsPanel.hidden = !show;
      elements.statsToggle.textContent = show ? t("stats.hide") : t("stats.show");
      elements.statsToggle.setAttribute("aria-pressed", String(show));
      if (show) {
        renderNetworkSummary();
        renderStats();
        void loadStats();
        void loadObservers().then(() => renderNetworkSummary());
        void loadVisitStats();
      }
    });

    elements.statsClose.addEventListener("click", () => {
      elements.statsPanel.hidden = true;
      elements.statsToggle.textContent = t("stats.show");
      elements.statsToggle.setAttribute("aria-pressed", "false");
    });

    elements.statsMetric.addEventListener("change", () => {
      metric = elements.statsMetric.value;
      renderStats();
    });

    elements.statsWindow.addEventListener("change", () => {
      windowValue = elements.statsWindow.value;
      renderStats();
    });

    for (const button of elements.statsCounts.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        count = Number(button.dataset.count);
        for (const other of elements.statsCounts.querySelectorAll("button")) {
          other.classList.toggle("active", other === button);
        }
        renderStats();
      });
    }
  }

  return {
    bind,
    renderNetworkSummary,
    renderStats,
    setNetworkStats(data) {
      networkStats = data;
      if (!elements.statsPanel.hidden) renderNetworkSummary();
    },
  };
}
