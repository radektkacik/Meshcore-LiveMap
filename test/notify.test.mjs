import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramNotifier } from "../notify.mjs";

test("telegram notifier is disabled without token or chat id", async () => {
  let called = false;
  const notifier = createTelegramNotifier({
    chatId: "",
    fetchImpl: async () => {
      called = true;
      return { ok: true };
    },
    token: "secret",
  });
  assert.equal(notifier.enabled, false);
  assert.equal(await notifier.send("test"), false);
  assert.equal(called, false);
});

test("telegram notifier posts a message to the bot API", async () => {
  let request;
  const notifier = createTelegramNotifier({
    chatId: "12345",
    fetchImpl: async (url, options) => {
      request = { options, url };
      return { ok: true };
    },
    token: "bot-token",
  });
  assert.equal(notifier.enabled, true);
  assert.equal(await notifier.send("Nová fotka"), true);
  assert.match(request.url, /\/botbot-token\/sendMessage$/);
  assert.equal(request.options.method, "POST");
  const body = JSON.parse(request.options.body);
  assert.equal(body.chat_id, "12345");
  assert.equal(body.text, "Nová fotka");
  assert.equal(body.disable_notification, false);
  assert.equal(body.disable_web_page_preview, true);
});

test("telegram notifier reports delivery failure", async () => {
  const notifier = createTelegramNotifier({
    chatId: "1",
    fetchImpl: async () => ({ ok: false, status: 500 }),
    token: "t",
  });
  assert.equal(await notifier.send("x"), false);
});

test("telegram notifier sends inline approval buttons", async () => {
  let request;
  const notifier = createTelegramNotifier({
    chatId: "12345",
    fetchImpl: async (url, options) => {
      request = { options, url };
      return { ok: true };
    },
    token: "bot-token",
  });
  const replyMarkup = {
    inline_keyboard: [[{ callback_data: "pa:photo-id.signature", text: "Schválit" }]],
  };
  assert.equal(await notifier.send("Nová fotka", { replyMarkup }), true);
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.reply_markup, replyMarkup);
});

test("telegram notifier answers callbacks and edits moderation messages", async () => {
  const requests = [];
  const notifier = createTelegramNotifier({
    chatId: "12345",
    fetchImpl: async (url, options) => {
      requests.push({ body: JSON.parse(options.body), url });
      return { ok: true };
    },
    token: "bot-token",
  });
  assert.equal(await notifier.answerCallbackQuery("callback-1", { text: "Schváleno" }), true);
  assert.equal(await notifier.editMessageText("12345", 99, "Hotovo"), true);
  assert.match(requests[0].url, /\/answerCallbackQuery$/);
  assert.deepEqual(requests[0].body, { callback_query_id: "callback-1", text: "Schváleno" });
  assert.match(requests[1].url, /\/editMessageText$/);
  assert.deepEqual(requests[1].body, {
    chat_id: "12345",
    message_id: 99,
    text: "Hotovo",
  });
});

test("telegram notifier registers webhook with secret token", async () => {
  let request;
  const notifier = createTelegramNotifier({
    chatId: "",
    fetchImpl: async (url, options) => {
      request = { options, url };
      return { ok: true };
    },
    token: "bot-token",
  });
  assert.equal(await notifier.setWebhook("https://mapa.test/api/telegram/webhook", {
    secretToken: "webhook-secret",
  }), true);
  assert.match(request.url, /\/setWebhook$/);
  assert.deepEqual(JSON.parse(request.options.body), {
    allowed_updates: ["callback_query"],
    secret_token: "webhook-secret",
    url: "https://mapa.test/api/telegram/webhook",
  });
});
