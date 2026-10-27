import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

function mapRow(row) {
  if (!row) return null;
  return {
    author: row.author || "",
    createdAt: row.created_at,
    nodeKey: row.node_key,
    text: row.text || "",
    updatedAt: row.updated_at,
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
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS node_info_updated ON node_info (updated_at DESC);
  `);

  const selectOne = db.prepare("SELECT * FROM node_info WHERE node_key = ?");
  const selectAll = db.prepare("SELECT * FROM node_info ORDER BY updated_at DESC LIMIT ?");
  const countRows = db.prepare("SELECT COUNT(*) AS total FROM node_info");
  const upsertRow = db.prepare(`
    INSERT INTO node_info (node_key, text, author, created_at, updated_at)
    VALUES (@node_key, @text, @author, @created_at, @updated_at)
    ON CONFLICT(node_key) DO UPDATE SET
      text = excluded.text,
      author = excluded.author,
      updated_at = excluded.updated_at
  `);
  const deleteRow = db.prepare("DELETE FROM node_info WHERE node_key = ?");

  return {
    close: () => db.close(),
    count: () => countRows.get().total,
    get: (nodeKey) => mapRow(selectOne.get(String(nodeKey || "").toLowerCase())),
    list: (limit = 300) => selectAll.all(Math.min(Math.max(1, Number(limit) || 300), 1000)).map(mapRow),
    remove: (nodeKey) => deleteRow.run(String(nodeKey || "").toLowerCase()).changes > 0,
    upsert: (entry, now = Date.now()) => {
      const nodeKey = String(entry?.nodeKey || "").toLowerCase();
      const text = String(entry?.text || "").trim();
      const author = String(entry?.author || "").trim().slice(0, 60);
      if (!/^[0-9a-f]{64}$/.test(nodeKey) || !text) return null;
      upsertRow.run({
        author,
        created_at: now,
        node_key: nodeKey,
        text,
        updated_at: now,
      });
      return mapRow(selectOne.get(nodeKey));
    },
  };
}
