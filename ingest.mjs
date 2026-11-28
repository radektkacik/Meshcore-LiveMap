import { createPacketStore } from "./packet-store.mjs";
import { createCzHealthStore } from "./cz-health-store.mjs";
import { createCzHealthHubStore } from "./czhealth-hub-store.mjs";
import { createCollectors } from "./collectors.mjs";
import { createMqttIngest } from "./mqtt-ingest.mjs";
import { startEventLoopMonitor } from "./monitor.mjs";
import { packetToStoreRow } from "./packet-row.mjs";
import { join } from "node:path";

const eventLoopMonitor = process.env.EVENT_LOOP_DIAGNOSTICS === "1" ? startEventLoopMonitor() : null;

const healthDbPath = process.env.CZ_HEALTH_DB_PATH || join(process.cwd(), "data", "cz-health.sqlite");
const hubHealth = process.env.CZ_HEALTH_SOURCE === "hub";
const healthRetention = Math.max(90 * 86_400_000, Number(process.env.CZ_HEALTH_RETENTION_MS || 366 * 86_400_000));
const healthStore = hubHealth
  ? createCzHealthHubStore(process.env.CZ_HEALTH_HUB_DB_PATH || join(process.cwd(), "data", "czhealth-hub.sqlite"), { retentionMs: healthRetention })
  : createCzHealthStore(healthDbPath, { retentionMs: healthRetention });
const packetStore = createPacketStore(process.env.PACKET_DB_PATH || join(process.cwd(), "data", "packets.sqlite"), {
  retentionMs: Math.max(1, Number(process.env.PACKET_RETENTION_MS || 7 * 24 * 60 * 60 * 1000)),
  maxRows: Math.max(1, Number(process.env.PACKET_MAX_ROWS || 500_000)),
});

const child = (message) => {
  if (!process.connected) return;
  process.send(message);
};

const mqttIngest = createMqttIngest({
  broadcast: (event, packet) => {
    if (event === "packet") child({ type: "packet", packet });
  },
  broadcastStatus: () => child({
    type: "status",
    state: { ...mqttIngest.getState(), ...(eventLoopMonitor ? { eventLoop: eventLoopMonitor.snapshot() } : {}) },
    enabled: mqttIngest.enabled,
  }),
  onPacket: (packet) => child({ type: "packet", packet: { ...packet, resolved_path: packet.resolved_path || [] } }),
  getEventLoopDelay: eventLoopMonitor ? () => eventLoopMonitor.snapshot() : null,
  healthStore,
  healthEnabled: !hubHealth,
  packetStore,
  recentPackets: { add: () => {} },
  toStoreRow: packetToStoreRow,
});

process.on("SIGTERM", () => {
  mqttIngest.stop();
  packetStore.close();
  healthStore.close();
  setTimeout(() => process.exit(0), 100).unref();
});

mqttIngest.start();
mqttIngest.backfillHealth();

if (process.env.MQTT_INGEST_MODE === "child") {
  const packetCollectors = createCollectors({
    collectMetrics: false,
    metricsCollectionMs: 0,
    metricsStore: null,
    mqttIngest,
    packetCollectionMs: Math.max(30_000, Number(process.env.PACKET_COLLECT_MS || 5 * 60_000)),
    packetStore,
    statsCollectMs: 0,
    statsTimeoutMs: 5_000,
    storeNodesCache: () => {},
    storeStatsCache: () => {},
    toStoreRow: packetToStoreRow,
    upstream: process.env.CORESCOPE_URL || "https://analyzer.meshcore.cz",
    upstreamTimeoutMs: Math.max(1, Number(process.env.UPSTREAM_TIMEOUT_MS || 15_000)),
  });
  packetCollectors.start();
}
