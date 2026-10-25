export function createTelegramNotifier({
  apiBase = "https://api.telegram.org",
  chatId = "",
  fetchImpl = fetch,
  timeoutMs = 5000,
  token = "",
} = {}) {
  const enabled = Boolean(token && chatId);

  async function send(text, { silent = false } = {}) {
    if (!enabled || !String(text || "").trim()) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${apiBase}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          disable_notification: Boolean(silent),
          disable_web_page_preview: true,
          text,
        }),
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  }

  return { enabled, send };
}
