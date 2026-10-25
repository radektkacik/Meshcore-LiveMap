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
  assert.equal(body.disable_notification, true);
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
