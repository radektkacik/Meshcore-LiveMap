import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function passwordMatches(password, stored) {
  const [scheme, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(String(password || ""), salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 128;
}

function mapRow(row) {
  if (!row) return null;
  return {
    author: row.author || "",
    createdAt: row.created_at,
    nodeKey: row.node_key,
    protected: Boolean(row.edit_password_hash),
    text: row.text || "",
    updatedAt: row.updated_at,
  };
}

function mapPendingRow(row) {
  if (!row) return null;
  return {
    author: row.author || "",
    createdAt: row.created_at,
    currentText: row.current_text || "",
    currentUpdatedAt: row.current_updated_at ?? null,
    nodeKey: row.node_key,
    text: row.text || "",
  };
}

export function createNodeInfoStore(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_info (
      node_key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      author TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      edit_password_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS node_info_updated ON node_info (updated_at DESC);
    CREATE TABLE IF NOT EXISTS node_info_pending (
      node_key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      author TEXT,
      ip_hash TEXT,
      edit_password_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS node_info_pending_created ON node_info_pending (created_at DESC);
  `);

  try {
    db.exec("ALTER TABLE node_info ADD COLUMN edit_password_hash TEXT");
  } catch {
    // Column already exists.
  }

  try {
    db.exec("ALTER TABLE node_info_pending ADD COLUMN edit_password_hash TEXT");
  } catch {
    // Column already exists.
  }

  const selectOne = db.prepare("SELECT * FROM node_info WHERE node_key = ?");
  const selectAll = db.prepare("SELECT * FROM node_info ORDER BY updated_at DESC LIMIT ?");
  const countRows = db.prepare("SELECT COUNT(*) AS total FROM node_info");
  const upsertRow = db.prepare(`
    INSERT INTO node_info (node_key, text, author, created_at, updated_at, edit_password_hash)
    VALUES (@node_key, @text, @author, @created_at, @updated_at, @edit_password_hash)
    ON CONFLICT(node_key) DO UPDATE SET
      text = excluded.text,
      author = excluded.author,
      updated_at = excluded.updated_at,
      edit_password_hash = excluded.edit_password_hash
  `);
  const deleteRow = db.prepare("DELETE FROM node_info WHERE node_key = ?");
  const selectPendingOne = db.prepare(`
    SELECT p.*, n.text AS current_text, n.updated_at AS current_updated_at
    FROM node_info_pending p
    LEFT JOIN node_info n ON n.node_key = p.node_key
    WHERE p.node_key = ?
  `);
  const selectPendingAll = db.prepare(`
    SELECT p.*, n.text AS current_text, n.updated_at AS current_updated_at
    FROM node_info_pending p
    LEFT JOIN node_info n ON n.node_key = p.node_key
    ORDER BY p.created_at DESC
    LIMIT ?
  `);
  const countPendingRows = db.prepare("SELECT COUNT(*) AS total FROM node_info_pending");
  const upsertPending = db.prepare(`
    INSERT INTO node_info_pending (node_key, text, author, ip_hash, edit_password_hash, created_at)
    VALUES (@node_key, @text, @author, @ip_hash, @edit_password_hash, @created_at)
    ON CONFLICT(node_key) DO UPDATE SET
      text = excluded.text,
      author = excluded.author,
      ip_hash = excluded.ip_hash,
      edit_password_hash = excluded.edit_password_hash,
      created_at = excluded.created_at
  `);
  const deletePending = db.prepare("DELETE FROM node_info_pending WHERE node_key = ?");

  function validEntry(entry) {
    const nodeKey = String(entry?.nodeKey || "").toLowerCase();
    const text = String(entry?.text || "").trim();
    const author = String(entry?.author || "").trim().slice(0, 60);
    if (!/^[0-9a-f]{64}$/.test(nodeKey) || !text) return null;
    return { author, nodeKey, text };
  }

  function publish(entry, now = Date.now(), passwordHash = null) {
    const value = validEntry(entry);
    if (!value) return null;
    upsertRow.run({
      author: value.author,
      created_at: now,
      edit_password_hash: passwordHash,
      node_key: value.nodeKey,
      text: value.text,
      updated_at: now,
    });
    return mapRow(selectOne.get(value.nodeKey));
  }

  return {
    approve: (nodeKey, now = Date.now()) => {
      const key = String(nodeKey || "").toLowerCase();
      const pending = selectPendingOne.get(key);
      if (!pending) return null;
      const current = selectOne.get(key);
      const info = db.transaction(() => {
        const published = publish({
          author: pending.author,
          nodeKey: key,
          text: pending.text,
        }, now, pending.edit_password_hash || current?.edit_password_hash || null);
        deletePending.run(key);
        return published;
      })();
      return info;
    },
    close: () => db.close(),
    count: () => countRows.get().total,
    get: (nodeKey) => mapRow(selectOne.get(String(nodeKey || "").toLowerCase())),
    getPending: (nodeKey) => mapPendingRow(selectPendingOne.get(String(nodeKey || "").toLowerCase())),
    list: (limit = 300) => selectAll.all(Math.min(Math.max(1, Number(limit) || 300), 1000)).map(mapRow),
    listPending: (limit = 300) => selectPendingAll.all(Math.min(Math.max(1, Number(limit) || 300), 1000)).map(mapPendingRow),
    pendingCount: () => countPendingRows.get().total,
    reject: (nodeKey) => deletePending.run(String(nodeKey || "").toLowerCase()).changes > 0,
    remove: (nodeKey) => {
      const key = String(nodeKey || "").toLowerCase();
      return db.transaction(() => {
        const removed = deleteRow.run(key).changes > 0;
        deletePending.run(key);
        return removed;
      })();
    },
    submit: (entry, now = Date.now()) => {
      const value = validEntry(entry);
      if (!value) return null;
      const password = String(entry?.password || "");
      if (password && !validPassword(password)) return { error: "invalid_password" };
      const current = selectOne.get(value.nodeKey);
      if (!current) {
        return {
          info: publish(value, now, password ? hashPassword(password) : null),
          status: "published",
        };
      }
      if (!current.edit_password_hash) {
        upsertPending.run({
          author: value.author,
          created_at: now,
          edit_password_hash: password ? hashPassword(password) : null,
          ip_hash: String(entry?.ipHash || "").slice(0, 32),
          node_key: value.nodeKey,
          text: value.text,
        });
        return { info: mapPendingRow(selectPendingOne.get(value.nodeKey)), status: "pending" };
      }
      if (!passwordMatches(password, current.edit_password_hash)) {
        return { error: "bad_password" };
      }
      upsertPending.run({
        author: value.author,
        created_at: now,
        edit_password_hash: null,
        ip_hash: String(entry?.ipHash || "").slice(0, 32),
        node_key: value.nodeKey,
        text: value.text,
      });
      return { info: mapPendingRow(selectPendingOne.get(value.nodeKey)), status: "pending" };
    },
  };
}
