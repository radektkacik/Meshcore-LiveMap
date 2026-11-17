import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSecurityEvents } from "../security-events.mjs";

test("security events are appended as JSON lines", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-sec-"));
  const logPath = join(directory, "security.log");
  try {
    const security = createSecurityEvents({ logPath, notify: null });
    security.record({ category: "foreign-write", ip: "1.2.3.4", method: "POST", path: "/api/feedback" });
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.category, "foreign-write");
    assert.equal(entry.ip, "1.2.3.4");
    assert.ok(Number.isFinite(entry.at));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("security alerts fire once per window and on burst threshold", () => {
  let clock = 1_000;
  const messages = [];
  const security = createSecurityEvents({
    logPath: null,
    notify: (message) => messages.push(message),
    windowMs: 100,
    burstThreshold: 3,
    now: () => clock,
  });
  security.record({ category: "foreign-write", ip: "1.2.3.4" });
  security.record({ category: "foreign-write", ip: "5.6.7.8" });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /První výskyt/);
  security.record({ category: "foreign-write", ip: "9.9.9.9" });
  security.record({ category: "foreign-write", ip: "9.9.9.9" });
  assert.equal(messages.length, 2);
  assert.match(messages[1], /Hustý útok/);
  security.record({ category: "foreign-write", ip: "9.9.9.9" });
  assert.equal(messages.length, 2, "no more alerts within the same window");
  clock += 200;
  security.record({ category: "foreign-write", ip: "9.9.9.9" });
  assert.equal(messages.length, 3, "window resets after it expires");
});

test("other categories alert independently", () => {
  const messages = [];
  const security = createSecurityEvents({ logPath: null, notify: (message) => messages.push(message) });
  security.record({ category: "admin-login-failed", ip: "1.1.1.1" });
  security.record({ category: "telegram-webhook-401", ip: "2.2.2.2" });
  assert.equal(messages.length, 2);
  assert.match(messages[0], /administrace/);
  assert.match(messages[1], /Telegram/);
});
