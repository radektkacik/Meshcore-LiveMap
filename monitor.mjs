import { statfsSync } from "node:fs";
import { connect as connectTls } from "node:tls";

export function createMonitor({
  getLastPacketAt,
  getMqttState,
  notify,
}) {
  const enabled = process.env.MONITOR_ALERTS === "1";
  const intervalMs = Math.max(60_000, Number(process.env.MONITOR_INTERVAL_MS || 300_000));
  const repeatMs = Math.max(60_000, Number(process.env.MONITOR_REPEAT_MS || 3_600_000));
  const diskPercent = Math.min(99, Math.max(1, Number(process.env.MONITOR_DISK_PERCENT || 90)));
  const packetAgeSec = Math.max(60, Number(process.env.MONITOR_PACKET_AGE_SEC || 600));
  const timeoutMs = Math.max(5_000, Number(process.env.MONITOR_TIMEOUT_MS || 30_000));
  const failureThreshold = Math.max(1, Number(process.env.MONITOR_FAILURES || 2));
  const urls = String(process.env.MONITOR_URLS || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  let alertKey = "";
  let alertedAt = 0;
  let failureStreak = 0;

  function diskUsage() {
    try {
      const stats = statfsSync(process.cwd());
      const total = stats.blocks * stats.bsize;
      const free = stats.bavail * stats.bsize;
      return {
        free,
        total,
        usedPercent: total ? ((total - free) / total) * 100 : 0,
      };
    } catch {
      return null;
    }
  }

  function certificateDays(host) {
    return new Promise((resolve) => {
      let settled = false;
      const socket = connectTls({ host, port: 443, rejectUnauthorized: false, servername: host });
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(8_000, () => finish(null));
      socket.once("secureConnect", () => {
        const certificate = socket.getPeerCertificate();
        const expires = Date.parse(certificate?.valid_to || "");
        finish(Number.isFinite(expires) ? Math.floor((expires - Date.now()) / 86_400_000) : null);
      });
      socket.once("error", () => finish(null));
    });
  }

  async function check() {
    if (!enabled) return;
    const issues = [];
    const mqtt = getMqttState();
    const lastPacketAt = getLastPacketAt();
    if (mqtt.enabled && !mqtt.connected) {
      issues.push("MQTT je odpojené");
    } else if (mqtt.enabled && lastPacketAt && Date.now() - lastPacketAt > packetAgeSec * 1000) {
      issues.push(`z MQTT nepřišel paket ${Math.round((Date.now() - lastPacketAt) / 60_000)} min`);
    }
    const disk = diskUsage();
    if (disk && disk.usedPercent >= diskPercent) {
      issues.push(`disk je zaplněný z ${disk.usedPercent.toFixed(0)} % (volné ${(disk.free / 1e9).toFixed(1)} GB)`);
    }
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "meshcore-monitor/1" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) issues.push(`${url} vrací HTTP ${response.status}`);
        else if (data.status && data.status !== "ok") issues.push(`${url} hlásí ${data.status}`);
      } catch {
        issues.push(`${url} není dostupné`);
      }
    }
    const hosts = [...new Set(urls
      .filter((value) => value.startsWith("https://"))
      .map((value) => {
        try {
          return new URL(value).hostname;
        } catch {
          return null;
        }
      })
      .filter(Boolean))];
    for (const host of hosts) {
      const days = await certificateDays(host);
      if (days != null && days < 14) issues.push(`TLS certifikát ${host} vyprší za ${days} dní`);
    }
    if (!issues.length) {
      failureStreak = 0;
      if (alertKey) notify("✅ Monitoring: všechny kontroly jsou v pořádku.");
      alertKey = "";
      alertedAt = 0;
      return;
    }
    failureStreak += 1;
    if (failureStreak < failureThreshold) return;
    const key = issues.join("|");
    if (key === alertKey && Date.now() - alertedAt < repeatMs) return;
    alertKey = key;
    alertedAt = Date.now();
    notify(`⚠️ Monitoring\n${issues.map((issue) => `• ${issue}`).join("\n")}`);
  }

  function start() {
    if (!enabled) return;
    setTimeout(() => { void check(); }, 15_000).unref();
    setInterval(() => { void check(); }, intervalMs).unref();
  }

  return { check, start };
}
