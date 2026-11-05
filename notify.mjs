export function createTelegramNotifier({
  apiBase = "https://api.telegram.org",
  chatId = "",
  fetchImpl = fetch,
  timeoutMs = 5000,
  token = "",
} = {}) {
  const enabled = Boolean(token && chatId);
  const hasToken = Boolean(token);

  async function call(method, payload, { requireEnabled = true } = {}) {
    if (!hasToken || (requireEnabled && !enabled)) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(text, { replyMarkup = null, silent = false } = {}) {
    if (!enabled || !String(text || "").trim()) return false;
    const payload = {
      chat_id: chatId,
      disable_notification: Boolean(silent),
      disable_web_page_preview: true,
      text,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return call("sendMessage", payload);
  }

  async function answerCallbackQuery(callbackQueryId, { showAlert = false, text = "" } = {}) {
    if (!enabled || !callbackQueryId) return false;
    const payload = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    if (showAlert) payload.show_alert = true;
    return call("answerCallbackQuery", payload);
  }

  async function editMessageText(chatIdValue, messageId, text, { replyMarkup = null } = {}) {
    if (!enabled || !messageId || !String(text || "").trim()) return false;
    const payload = {
      chat_id: chatIdValue || chatId,
      message_id: messageId,
      text,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return call("editMessageText", payload);
  }

  async function setWebhook(url, { allowedUpdates = ["callback_query"], secretToken = "" } = {}) {
    if (!hasToken || !String(url || "").trim()) return false;
    const payload = { url: String(url) };
    if (secretToken) payload.secret_token = secretToken;
    if (Array.isArray(allowedUpdates) && allowedUpdates.length) payload.allowed_updates = allowedUpdates;
    return call("setWebhook", payload, { requireEnabled: false });
  }

  async function deleteWebhook({ dropPendingUpdates = false } = {}) {
    return call("deleteWebhook", { drop_pending_updates: Boolean(dropPendingUpdates) }, { requireEnabled: false });
  }

  return {
    answerCallbackQuery,
    deleteWebhook,
    editMessageText,
    enabled,
    send,
    setWebhook,
  };
}
