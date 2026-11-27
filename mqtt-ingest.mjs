import mqtt from "mqtt";
import WebSocket from "ws";
import { MeshCorePacketDecoder } from "@michaelhart/meshcore-decoder";
import { decodedPacketHashBytes, decodedPacketPath } from "./backend-utils.mjs";
import { decodeCzHealth } from "./cz-health.mjs";

export function parseMqttPacket(topic, message) {
  const source = JSON.parse(message.toString("utf8"));
  if (source.type !== "PACKET" || !source.raw) return null;
  const topicParts = topic.split("/");
  let decoded;
  try {
    decoded = MeshCorePacketDecoder.decode(source.raw);
  } catch {
    return null;
  }

  const payloadType = decoded.payloadType ?? 0;
  const routeType = decoded.routeType ?? 0;
  const payloadDecoded = decoded?.payload?.decoded ?? decoded?.payload ?? {};
  const appData = payloadDecoded?.appData ?? payloadDecoded?.appdata ?? {};
  const path = decodedPacketPath(decoded).map((hop) => String(hop).toUpperCase());
  const advertData = payloadType === 4 ? {
    pubKey: (payloadDecoded.publicKey || payloadDecoded.publickey || "").toLowerCase(),
    lat: appData.location?.latitude ?? appData.location?.lat ?? null,
    lon: appData.location?.longitude ?? appData.location?.lon ?? null,
    name: appData.name || null,
    type: "ADVERT",
  } : {};
  const senderPubkey = advertData.pubKey
    || decoded?.payload?.senderPubkey
    || payloadDecoded?.senderPubkey
    || payloadDecoded?.sender
    || null;

  return {
    decoded_json: JSON.stringify(payloadType === 4 ? advertData : payloadType === 9 ? payloadDecoded : advertData),
    first_seen: new Date().toISOString(),
    hash: String(source.hash || decoded.messageHash || "").toLowerCase(),
    latest: new Date().toISOString(),
    observer_count: 1,
    observer_iata: topicParts[1] || "",
    observer_id: topicParts[2] || "",
    observer_name: source.origin || "",
    origin_id: senderPubkey || "",
    path_hash_bytes: decodedPacketHashBytes(decoded),
    path_json: JSON.stringify(path),
    payload_type: payloadType,
    raw_hex: source.raw,
    route_type: routeType,
    rssi: Number(source.RSSI),
    snr: Number(source.SNR),
  };
}
export function createMqttIngest({
  broadcast,
  broadcastStatus,
  getEventLoopDelay = null,
  healthStore,
  healthEnabled = true,
  packetStore,
  recentPackets,
  toStoreRow,
  onPacket = null,
}) {
  const url = process.env.MQTT_URL;
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;
  const enabled = Boolean(url && username && password);
  const keepaliveS = Math.min(300, Math.max(10, Number(process.env.MQTT_KEEPALIVE || 30)));
  const requestedFamily = Number(process.env.MQTT_IP_FAMILY ?? 4);
  const socketFamily = requestedFamily === 6 ? 6 : requestedFamily === 4 ? 4 : 0;
  const reconnectMs = Math.max(1_000, Number(process.env.MQTT_RECONNECT_MS || 3_000));
  const reconnectMaxMs = Math.max(reconnectMs, Number(process.env.MQTT_RECONNECT_MAX_MS || 60_000));
  const stableMs = 30_000;
  const jitter = 0.2;

  let client = null;
  let connected = false;
  let connectedSince = 0;
  let lastPacketAt = 0;
  let reconnectDelay = reconnectMs;
  let reconnectTimer = null;
  let reconnects = 0;



  function ingestHealth(rawHex, observedAt, packetHash = null) {
    if (!healthEnabled || !rawHex) return null;
    const health = decodeCzHealth(rawHex, Number(observedAt) || Date.now());
    if (!health) return null;
    try {
      healthStore.record(health, { packetHash, rawHex });
    } catch (error) {
      console.error(`CzHealth store failed: ${error.message}`);
    }
    return health;
  }

  function backfillHealth() {
    if (!healthEnabled) return;
    const rows = packetStore.queryPayloadType(6, 20_000);
    const seen = new Set();
    let decoded = 0;
    for (const row of rows) {
      if (!row.raw_hex || seen.has(row.raw_hex)) continue;
      seen.add(row.raw_hex);
      const observedAt = Number(row.observed_at) || Date.now();
      if (ingestHealth(row.raw_hex, observedAt, row.hash)) decoded += 1;
    }
    console.log(`CzHealth backfill: ${decoded} unique packets`);
  }

  function scheduleReconnect(reason = "") {
    if (reconnectTimer) return;
    reconnects += 1;
    const factor = 1 - jitter + Math.random() * jitter * 2;
    const delay = Math.round(reconnectDelay * factor);
    const lag = getEventLoopDelay?.();
    const diagnostic = lag ? `; event loop max ~${lag.windowMs / 1000} s: ${lag.recentMaxMs} ms` : "";
    console.log(`MQTT reconnect in ${delay} ms (${reason || "connection closed"}, total ${reconnects})${diagnostic}`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      client.reconnect();
    }, delay);
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs);
  }

  function start() {
    if (!enabled) {
      console.warn("MQTT is disabled: configure MQTT_URL, MQTT_USERNAME and MQTT_PASSWORD");
      return;
    }
    let connectedAt = 0;
    client = mqtt.connect(url, {
      clean: true,
      clientId: `meshcore-map-${Math.random().toString(16).slice(2)}`,
      connectTimeout: 10_000,
      createWebsocket: (wsUrl, protocols) => {
        const socket = new WebSocket(wsUrl, protocols, socketFamily ? { family: socketFamily } : {});
        socket.on("open", () => {
          const peer = socket._socket?.remoteAddress || "unknown";
          console.log(`MQTT websocket open (IPv${socketFamily || "auto"}, peer ${peer})`);
        });
        socket.on("close", (code, reason) => {
          const text = reason?.length ? `, reason ${reason.toString()}` : "";
          console.warn(`MQTT websocket closed: code ${code}${text}`);
        });
        socket.on("error", (error) => console.warn(`MQTT websocket error: ${error.message}`));
        return socket;
      },
      keepalive: keepaliveS,
      password,
      protocolVersion: 4,
      reconnectPeriod: 0,
      username,
    });
    client.on("connect", () => {
      console.log(`MQTT connected after ${connectedAt ? `${Math.round((Date.now() - connectedAt) / 1000)} s` : "initial connect"}`);
      connectedAt = Date.now();
      connectedSince = connectedAt;
      reconnectDelay = reconnectMs;
      connected = true;
      const topic = process.env.MQTT_TOPIC || "meshcore/+/+/packets";
      client.subscribe(topic, { qos: 0 }, (error) => {
        if (error) console.error(`MQTT subscribe failed: ${error.message}`);
        else console.log(`MQTT subscribed to ${topic}`);
      });
      broadcastStatus();
    });
    client.on("close", (disconnectPacket) => {
      const sessionSec = connectedAt ? Math.round((Date.now() - connectedAt) / 1000) : null;
      const reason = disconnectPacket?.reasonCode != null
        ? `broker reason ${disconnectPacket.reasonCode}${disconnectPacket.properties?.reasonString ? `: ${disconnectPacket.properties.reasonString}` : ""}`
        : sessionSec == null ? "before connect" : `session ${sessionSec} s`;
      connected = false;
      connectedSince = 0;
      if (connectedAt && Date.now() - connectedAt >= stableMs) reconnectDelay = reconnectMs;
      connectedAt = 0;
      broadcastStatus();
      scheduleReconnect(reason);
    });

    let lastConnectedAt = 0;
    client.on("offline", () => console.warn("MQTT offline"));
    client.on("reconnect", () => console.log("MQTT reconnecting"));
    client.on("end", () => console.warn("MQTT connection ended"));
    let lastErrorLog = 0;
    let lastErrorMessage = "";
    client.on("error", (error) => {
      const now = Date.now();
      if (error.message !== lastErrorMessage || now - lastErrorLog > 5 * 60 * 1000) {
        console.error(`MQTT error: ${error.message}`);
        lastErrorMessage = error.message;
        lastErrorLog = now;
      }
    });
    client.on("message", (topic, message) => {
      try {
        const packet = parseMqttPacket(topic, message);
        if (!packet?.hash) return;
        lastPacketAt = Date.now();
        if (Date.now() - lastConnectedAt > 3 * 60_000) {
          lastConnectedAt = Date.now();
          console.log("MQTT packet stream active");
        }
        recentPackets.add(packet);
        ingestHealth(packet.raw_hex, lastPacketAt, packet.hash);
        const stored = toStoreRow(packet, lastPacketAt);
        if (stored) packetStore.record([stored]);
        if (onPacket) onPacket(packet);
        else broadcast("packet", packet);
      } catch (error) {
        console.error(`Invalid MQTT packet on ${topic}: ${error.message}`);
      }
    });

    setInterval(() => {
      if (Date.now() - lastPacketAt > 2 * 60_000) {
        console.warn(`MQTT no packet for ${Math.round((Date.now() - lastPacketAt) / 1000)} s (connected: ${connected})`);
      }
    }, 60_000).unref();
  }

  function stop() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    client?.end(true);
  }

  return {
    backfillHealth,
    enabled,
    getState: () => ({
      connected,
      connectedSince,
      lastPacketAt,
      reconnects,
    }),
    ingestHealth,
    start,
    stop,
  };
}
