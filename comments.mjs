import { randomUUID } from "node:crypto";
import { openSqliteStore } from "./sqlite-store.mjs";

const MAX_AUTHOR = 60;
const MAX_TEXT = 500;
const MIN_TEXT = 2;

function validKey(value) {
  return /^[0-9a-f]{64}$/.test(String(value || "").toLowerCase());
}

function mapRow(row) {
  return {
    author: row.author || "",
    createdAt: row.created_at,
    id: row.id,
    nodeKey: row.node_key,
    text: row.text || "",
  };
}

export function createCommentStore(dbPath) {
  const db = openSqliteStore(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_comments (
      id TEXT PRIMARY KEY,
      node_key TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      ip_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS node_comments_node ON node_comments (node_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS node_comments_time ON node_comments (created_at DESC);
  `);

  const insert = db.prepare(`
    INSERT INTO node_comments (id, node_key, author, text, ip_hash, created_at)
    VALUES (@id, @node_key, @author, @text, @ip_hash, @created_at)
  `);
  const selectOne = db.prepare("SELECT * FROM node_comments WHERE id = ?");
  const selectForNode = db.prepare(`
    SELECT * FROM node_comments WHERE node_key = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const selectAll = db.prepare("SELECT * FROM node_comments ORDER BY created_at DESC, id DESC LIMIT ?");
  const countRows = db.prepare("SELECT COUNT(*) AS total FROM node_comments");
  const countSince = db.prepare("SELECT COUNT(*) AS total FROM node_comments WHERE created_at >= ?");
  const countNodeRows = db.prepare("SELECT COUNT(*) AS total FROM node_comments WHERE node_key = ?");
  const deleteRow = db.prepare("DELETE FROM node_comments WHERE id = ?");
  const pruneOverflow = db.prepare(`
    DELETE FROM node_comments WHERE id NOT IN (
      SELECT id FROM node_comments ORDER BY created_at DESC, id DESC LIMIT ?
    )
  `);

  return {
    close: () => db.close(),
    count: () => countRows.get().total,
    countForNode(nodeKey) {
      const key = String(nodeKey || "").toLowerCase();
      if (!validKey(key)) return 0;
      return countNodeRows.get(key).total;
    },
    countSince: (since) => countSince.get(Number(since) || 0).total,
    create(entry, now = Date.now()) {
      const nodeKey = String(entry?.nodeKey || "").toLowerCase();
      const text = String(entry?.text || "").trim();
      const author = String(entry?.author || "").trim().slice(0, MAX_AUTHOR);
      if (!validKey(nodeKey) || text.length < MIN_TEXT || text.length > MAX_TEXT) return null;
      const id = randomUUID();
      insert.run({
        author,
        created_at: now,
        id,
        ip_hash: String(entry?.ipHash || "").slice(0, 32),
        node_key: nodeKey,
        text,
      });
      return mapRow(selectOne.get(id));
    },
    list(nodeKey, limit = 100) {
      const key = String(nodeKey || "").toLowerCase();
      if (!validKey(key)) return [];
      return selectForNode.all(key, Math.min(Math.max(1, Number(limit) || 100), 200)).map(mapRow);
    },
    listAdmin(limit = 300) {
      return selectAll.all(Math.min(Math.max(1, Number(limit) || 300), 500)).map(mapRow);
    },
    pruneTo(maxRows) {
      return pruneOverflow.run(Math.max(1, Number(maxRows) || 5000)).changes;
    },
    remove(id) {
      return deleteRow.run(String(id || "")).changes > 0;
    },
  };
}
