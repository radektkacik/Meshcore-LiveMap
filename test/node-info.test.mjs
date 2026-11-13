import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNodeInfoStore } from "../node-info.mjs";

test("node info publishes the first text and requires approval for changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "a".repeat(64);
  try {
    const first = store.submit({
      author: "Petr",
      nodeKey: key,
      password: "tajne123",
      text: "Hardware: RAK v2\nBaterie: 10 Ah\nPanel: 20 W",
    }, 1000);
    assert.equal(first.status, "published");
    assert.equal(first.info.nodeKey, key);
    assert.match(first.info.text, /RAK v2/);
    assert.equal(first.info.author, "Petr");
    assert.match(first.manageToken, /^[A-Za-z0-9_-]{32,}$/);
    assert.equal(store.count(), 1);
    assert.equal(store.pendingCount(), 0);

    const wrong = store.submit({
      author: "Jana",
      nodeKey: key,
      password: "spatne",
      text: "Anténa: 5 dBi",
    }, 2000);
    assert.equal(wrong.error, "bad_password");
    assert.equal(store.pendingCount(), 0);

    const proposal = store.submit({
      author: "Jana",
      nodeKey: key,
      text: "Anténa: 5 dBi",
    }, 2000);
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.info.author, "Jana");
    assert.match(proposal.info.currentText, /RAK v2/);
    assert.equal(store.get(key).text, "Hardware: RAK v2\nBaterie: 10 Ah\nPanel: 20 W");
    assert.equal(store.pendingCount(), 1);
    assert.equal(store.listPending(10).length, 1);

    const approved = store.approve(key, 3000);
    assert.equal(approved.text, "Anténa: 5 dBi");
    assert.equal(approved.createdAt, 1000);
    assert.equal(approved.updatedAt, 3000);
    assert.equal(store.pendingCount(), 0);
    assert.equal(store.get(key).text, "Anténa: 5 dBi");

    const ownerEdit = store.submit({
      author: "Petr",
      nodeKey: key,
      password: "tajne123",
      text: "Anténa: 7 dBi",
    }, 4000);
    assert.equal(ownerEdit.status, "published");
    assert.equal(store.get(key).text, "Anténa: 7 dBi");
    assert.equal(store.pendingCount(), 0);

    assert.equal(store.remove(key), true);
    assert.equal(store.get(key), null);
    assert.equal(store.pendingCount(), 0);
    assert.equal(store.count(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info can import text with an external source and preserve protection", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "f".repeat(64);
  try {
    store.submit({ nodeKey: key, password: "tajne123", text: "Původní text" }, 1000);
    store.submit({ nodeKey: key, text: "Čekající návrh" }, 2000);
    const imported = store.importText(key, {
      author: "meshcore.cz",
      sourceTitle: "rip5.meshcore.cz",
      sourceUrl: "https://meshcore.cz/doku.php?id=repeatery:rip5",
      text: "Importovaný text z wiki",
    }, 4000);
    assert.equal(imported.text, "Importovaný text z wiki");
    assert.equal(imported.sourceTitle, "rip5.meshcore.cz");
    assert.equal(imported.sourceUrl, "https://meshcore.cz/doku.php?id=repeatery:rip5");
    assert.equal(imported.author, "meshcore.cz");
    assert.equal(imported.protected, true);
    assert.equal(imported.createdAt, 1000);
    assert.equal(store.pendingCount(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info can reject a pending change and keeps the published text", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "b".repeat(64);
  try {
    store.submit({ nodeKey: key, password: "tajne123", text: "Původní text" }, 1000);
    store.submit({ nodeKey: key, text: "Navrhovaná změna" }, 2000);
    assert.equal(store.reject(key), true);
    assert.equal(store.get(key).text, "Původní text");
    assert.equal(store.pendingCount(), 0);
    assert.equal(store.getPending(key), null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("admin can edit published node info and clears a pending change", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "e".repeat(64);
  try {
    store.submit({ nodeKey: key, password: "tajne123", text: "Původní text" }, 1000);
    store.submit({ nodeKey: key, text: "Čekající návrh" }, 2000);
    assert.equal(store.pendingCount(), 1);
    const updated = store.adminUpdate(key, { author: "Admin", text: "Text od admina" }, 3000);
    assert.equal(updated.text, "Text od admina");
    assert.equal(updated.author, "Admin");
    assert.equal(updated.protected, true);
    assert.equal(store.pendingCount(), 0);
    assert.equal(store.get(key).text, "Text od admina");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info can be left without a password and still requires approval for changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "d".repeat(64);
  try {
    const first = store.submit({ nodeKey: key, text: "Bez hesla" }, 1000);
    assert.equal(first.status, "published");
    assert.equal(first.info.protected, false);
    const change = store.submit({ nodeKey: key, text: "Změna bez hesla" }, 2000);
    assert.equal(change.status, "pending");
    assert.equal(store.get(key).text, "Bez hesla");
    const approved = store.approve(key, 3000);
    assert.equal(approved.text, "Změna bez hesla");
    assert.equal(approved.protected, false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info owner token publishes and non-owner proposals wait for approval", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const key = "3".repeat(64);
  try {
    const first = store.submit({ nodeKey: key, text: "Původní text" }, 1000);
    assert.equal(first.status, "published");
    assert.match(first.manageToken, /^[A-Za-z0-9_-]{32,}$/);

    const ownerEdit = store.submit({ nodeKey: key, text: "Text majitele", token: first.manageToken }, 2000);
    assert.equal(ownerEdit.status, "published");
    assert.equal(store.get(key).text, "Text majitele");
    assert.equal(store.pendingCount(), 0);

    const proposal = store.submit({ nodeKey: key, text: "Návrh cizího" }, 3000);
    assert.equal(proposal.status, "pending");
    assert.equal(store.get(key).text, "Text majitele");
    const approved = store.approve(key, 4000);
    assert.equal(approved.text, "Návrh cizího");

    const afterApproval = store.submit({ nodeKey: key, text: "Další text majitele", token: first.manageToken }, 5000);
    assert.equal(afterApproval.status, "published");
    assert.equal(store.get(key).text, "Další text majitele");
    assert.equal(store.pendingCount(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info owner can delete with token or password", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  const tokenKey = "4".repeat(64);
  const passwordKey = "5".repeat(64);
  try {
    const first = store.submit({ nodeKey: tokenKey, text: "Token info" }, 1000);
    assert.equal(store.removeOwned(tokenKey, { token: "wrong" }).error, "forbidden");
    assert.equal(store.removeOwned(tokenKey, { token: first.manageToken }).removed, true);
    assert.equal(store.get(tokenKey), null);

    store.submit({ nodeKey: passwordKey, password: "tajne123", text: "Password info" }, 1000);
    assert.equal(store.removeOwned(passwordKey, { password: "spatne" }).error, "forbidden");
    assert.equal(store.removeOwned(passwordKey, { password: "tajne123" }).removed, true);
    assert.equal(store.get(passwordKey), null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("node info rejects invalid node keys and empty text", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-node-info-"));
  const store = createNodeInfoStore(join(directory, "node-info.sqlite"));
  try {
    assert.equal(store.submit({ nodeKey: "short", password: "tajne123", text: "test" }), null);
    assert.equal(store.submit({ nodeKey: "c".repeat(64), password: "tajne123", text: "   " }), null);
    assert.equal(store.submit({ nodeKey: "c".repeat(64), password: "123", text: "krátké heslo" }).error, "invalid_password");
    assert.equal(store.count(), 0);
    assert.equal(store.pendingCount(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
