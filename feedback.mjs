import { openSqliteStore } from "./sqlite-store.mjs";

export function createFeedbackStore(dbPath) {
  const db = openSqliteStore(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      category TEXT,
      message TEXT NOT NULL,
      contact TEXT,
      ip_hash TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS feedback_time ON feedback (created_at);
  `);

  const columns = new Set(db.prepare("PRAGMA table_info(feedback)").all().map((column) => column.name));
  if (!columns.has("name")) db.exec("ALTER TABLE feedback ADD COLUMN name TEXT");
  if (!columns.has("is_public")) db.exec("ALTER TABLE feedback ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0");
  if (!columns.has("hidden")) db.exec("ALTER TABLE feedback ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");

  const insert = db.prepare(`
    INSERT INTO feedback (created_at, category, message, contact, name, is_public, ip_hash, user_agent)
    VALUES (@created_at, @category, @message, @contact, @name, @is_public, @ip_hash, @user_agent)
  `);
  const listRecent = db.prepare(`
    SELECT id, created_at, category, message, contact, name, is_public, hidden, ip_hash, user_agent
    FROM feedback ORDER BY id DESC LIMIT ?
  `);
  const listPublic = db.prepare(`
    SELECT id, created_at, category, message, name
    FROM feedback WHERE is_public = 1 AND hidden = 0
    ORDER BY id DESC LIMIT ?
  `);
  const countRows = db.prepare("SELECT COUNT(*) AS total FROM feedback");
  const countSinceStmt = db.prepare("SELECT COUNT(*) AS total FROM feedback WHERE created_at >= ?");
  const pruneOverflow = db.prepare(`
    DELETE FROM feedback WHERE id NOT IN (
      SELECT id FROM feedback ORDER BY id DESC LIMIT ?
    )
  `);
  const setHiddenStmt = db.prepare("UPDATE feedback SET hidden = ? WHERE id = ?");

  return {
    close: () => db.close(),
    count: () => countRows.get().total,
    countSince: (since) => countSinceStmt.get(since).total,
    list: (limit = 100) => listRecent.all(Math.min(Math.max(1, limit), 500)),
    listPublic: (limit = 50) => listPublic.all(Math.min(Math.max(1, limit), 200)),
    pruneTo: (maxRows) => pruneOverflow.run(Math.max(1, maxRows)).changes,
    record: (entry, now = Date.now()) => {
      const info = insert.run({
        created_at: now,
        category: entry.category || "",
        message: entry.message,
        contact: entry.contact || "",
        name: entry.name || "",
        is_public: entry.isPublic ? 1 : 0,
        ip_hash: entry.ipHash || "",
        user_agent: entry.userAgent || "",
      });
      return info.lastInsertRowid;
    },
    setHidden: (id, hidden) => setHiddenStmt.run(hidden ? 1 : 0, Number(id)).changes,
  };
}
