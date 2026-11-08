export function createCollectors({
  metricsCollectionMs,
  metricsStore,
  mqttIngest,
  packetCollectionMs,
  packetStore,
  statsCollectMs,
  statsTimeoutMs,
  storeNodesCache,
  storeStatsCache,
  toStoreRow,
  upstream,
  upstreamTimeoutMs,
}) {
  let metricsActive = false;
  let packetsActive = false;
  let statsActive = false;

  async function collectNodeMetrics() {
    if (metricsActive) return;
    metricsActive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    timeout.unref();
    try {
      const response = await fetch(`${upstream}/api/nodes?limit=2000`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`CoreScope returned HTTP ${response.status}`);
      const data = await response.json();
      storeNodesCache(data);
      const recorded = metricsStore.recordNodes(Array.isArray(data.nodes) ? data.nodes : []);
      console.log(`Node metrics updated: ${recorded} hourly samples`);
    } catch (error) {
      console.error(`Node metrics update failed: ${error.message}`);
    } finally {
      clearTimeout(timeout);
      metricsActive = false;
    }
  }

  async function collectStats() {
    if (statsActive) return;
    statsActive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), statsTimeoutMs);
    timeout.unref();
    try {
      const response = await fetch(`${upstream}/api/stats`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`CoreScope returned HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const data = JSON.parse(body.toString("utf8"));
      metricsStore.recordStats(data);
      storeStatsCache(body, response.headers.get("content-type"));
    } catch (error) {
      console.error(`Stats collection failed: ${error.message}`);
    } finally {
      clearTimeout(timeout);
      statsActive = false;
    }
  }

  function mergeStoreRows(resolvedPackets, scopedPackets, now) {
    const rows = new Map();
    for (const packet of resolvedPackets) {
      const row = toStoreRow(packet, now);
      if (row) rows.set(`${row.hash}:${row.observer_id}`, row);
    }
    for (const packet of scopedPackets) {
      const scope = packet.scope_name;
      if (!scope) continue;
      const key = `${String(packet.hash || "")}:${String(packet.observer_id || "")}`;
      const existing = rows.get(key);
      if (existing) {
        existing.scope_name = scope;
        continue;
      }
      const row = toStoreRow(packet, now);
      if (row) {
        row.scope_name = scope;
        rows.set(key, row);
      }
    }
    return [...rows.values()];
  }

  async function collectPackets() {
    if (packetsActive) return;
    packetsActive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    timeout.unref();
    try {
      const headers = { Accept: "application/json" };
      const scopeSince = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      const [resolvedResponse, scopedResponse] = await Promise.all([
        fetch(`${upstream}/api/packets?limit=2000`, { headers, signal: controller.signal }),
        fetch(`${upstream}/api/packets?limit=4000&since=${encodeURIComponent(scopeSince)}`, { headers, signal: controller.signal }),
      ]);
      if (!resolvedResponse.ok) throw new Error(`CoreScope returned HTTP ${resolvedResponse.status}`);
      const resolvedData = await resolvedResponse.json();
      const scopedData = scopedResponse.ok ? await scopedResponse.json() : { packets: [] };
      const now = Date.now();
      const rows = mergeStoreRows(
        Array.isArray(resolvedData.packets) ? resolvedData.packets : [],
        Array.isArray(scopedData.packets) ? scopedData.packets : [],
        now,
      );
      for (const row of rows) {
        if (Number(row.payload_type) !== 6) continue;
        const observedAt = Number(row.observed_at)
          || Date.parse(row.timestamp || row.first_seen || "")
          || now;
        mqttIngest.ingestHealth(row.raw_hex, observedAt, row.hash);
      }
      const stored = packetStore.record(rows);
      packetStore.prune(now);
      console.log(`Packet routes updated: ${stored} stored, ${packetStore.count()} total`);
    } catch (error) {
      console.error(`Packet route update failed: ${error.message}`);
    } finally {
      clearTimeout(timeout);
      packetsActive = false;
    }
  }

  function start() {
    void collectNodeMetrics();
    setInterval(collectNodeMetrics, metricsCollectionMs).unref();

    if (statsCollectMs > 0) {
      void collectStats();
      setInterval(collectStats, statsCollectMs).unref();
    }

    void collectPackets();
    setInterval(collectPackets, packetCollectionMs).unref();
  }

  return {
    collectNodeMetrics,
    collectPackets,
    refreshStatsCache: collectStats,
    start,
  };
}
