import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_LOG_BYTES = 2 * 1024 * 1024;

const CATEGORY_LABELS = {
  "foreign-write": "Pokus o zápis z cizí domény",
  "foreign-live-read": "Pokus o čtení živých dat z cizí domény",
  "method-probe": "Neobvyklá metoda na živém endpointu",
  "rate-limit": "Překročen rate limit",
  "sse-ip-limit": "Příliš mnoho SSE streamů z jedné IP",
  "admin-login-failed": "Chybné heslo do administrace",
  "telegram-webhook-401": "Neplatný Telegram webhook secret",
};

function formatAlert(prefix, category, entry, count) {
  const label = CATEGORY_LABELS[category] || category;
  const lines = [
    `🛡️ Bezpečnost: ${prefix} · ${label}`,
    `Kategorie: ${category}`,
    `IP: ${entry.ip || "?"}`,
  ];
  if (entry.method || entry.path) lines.push(`Požadavek: ${entry.method || "?"} ${entry.path || "?"}`);
  if (entry.origin) lines.push(`Origin: ${entry.origin}`);
  if (entry.host) lines.push(`Host: ${entry.host}`);
  lines.push(`Čas: ${new Date(entry.at || Date.now()).toLocaleString("cs-CZ")}`);
  lines.push(`Počet v okně: ${count}`);
  return lines.join("\n");
}

export function createSecurityEvents({
  logPath = "data/security-events.log",
  notify = null,
  windowMs = 10 * 60 * 1000,
  burstThreshold = 8,
  now = Date.now,
} = {}) {
  const windows = new Map();
  if (logPath) {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
    } catch {}
  }

  function appendLine(line) {
    if (!logPath) return;
    try {
      if (existsSync(logPath) && statSync(logPath).size > MAX_LOG_BYTES) {
        renameSync(logPath, `${logPath}.1`);
      }
      appendFileSync(logPath, `${line}\n`);
    } catch {}
  }

  function record(event = {}) {
    const at = now();
    const entry = { at, ...event };
    appendLine(JSON.stringify(entry));
    const category = String(event.category || "unknown");
    let window = windows.get(category);
    if (!window || at - window.startedAt > windowMs) {
      window = { startedAt: at, count: 0, alerted: false, burstAlerted: false };
      windows.set(category, window);
    }
    window.count += 1;
    if (typeof notify !== "function") return;
    if (!window.alerted) {
      window.alerted = true;
      notify(formatAlert("První výskyt", category, entry, window.count));
      return;
    }
    if (!window.burstAlerted && window.count >= burstThreshold) {
      window.burstAlerted = true;
      notify(formatAlert("Hustý útok", category, entry, window.count));
    }
  }

  return { record };
}
