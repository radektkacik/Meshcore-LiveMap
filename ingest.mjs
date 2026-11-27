import { createPacketStore } from "./packet-store.mjs";
import { createCzHealthStore } from "./cz-health-store.mjs";
import { createCzHealthHubStore } from "./czhealth-hub-store.mjs";
import { createMqttIngest } from "./mqtt-ingest.mjs";
import { packetToStoreRow } from "./packet-row.mjs";
import { join } from "node:path";

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
  broadcastStatus: () => child({ type: "status", state: mqttIngest.getState(), enabled: mqttIngest.enabled }),
  onPacket: (packet) => child({ type: "packet", packet: { ...packet, resolved_path: packet.resolved_path || [] } }),
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
