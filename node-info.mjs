import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { openSqliteStore } from "./sqlite-store.mjs";

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

function hashOwnerToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function ownerTokenMatches(token, stored) {
  if (!token || !stored) return false;
  const expected = Buffer.from(stored, "hex");
  const actual = Buffer.from(hashOwnerToken(token), "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function mapRow(row) {
  if (!row) return null;
  return {
    author: row.author || "",
    createdAt: row.created_at,
    nodeKey: row.node_key,
    protected: Boolean(row.edit_password_hash),
    sourceTitle: row.source_title || "",
    sourceUrl: row.source_url || "",
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
  const db = openSqliteStore(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_info (
      node_key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      author TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      edit_password_hash TEXT,
      owner_token_hash TEXT,
      source_url TEXT,
      source_title TEXT
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
    db.exec("ALTER TABLE node_info ADD COLUMN owner_token_hash TEXT");
  } catch {
    // Column already exists.
  }
  try {
    db.exec("ALTER TABLE node_info ADD COLUMN source_url TEXT");
  } catch {
    // Column already exists.
  }
  try {
    db.exec("ALTER TABLE node_info ADD COLUMN source_title TEXT");
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
    INSERT INTO node_info (node_key, text, author, created_at, updated_at, edit_password_hash, owner_token_hash, source_url, source_title)
    VALUES (@node_key, @text, @author, @created_at, @updated_at, @edit_password_hash, @owner_token_hash, @source_url, @source_title)
    ON CONFLICT(node_key) DO UPDATE SET
      text = excluded.text,
      author = excluded.author,
      updated_at = excluded.updated_at,
      edit_password_hash = excluded.edit_password_hash,
      owner_token_hash = excluded.owner_token_hash,
      source_url = excluded.source_url,
      source_title = excluded.source_title
  `);
  const deleteRow = db.prepare("DELETE FROM node_info WHERE node_key = ?");
  const updatePublished = db.prepare(`
    UPDATE node_info
    SET text = @text, author = @author, updated_at = @updated_at
    WHERE node_key = @node_key
  `);
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
    const sourceUrl = String(entry?.sourceUrl || "").trim().slice(0, 500);
    const sourceTitle = String(entry?.sourceTitle || "").trim().slice(0, 200);
    if (!/^[0-9a-f]{64}$/.test(nodeKey) || !text) return null;
    return { author, nodeKey, sourceTitle, sourceUrl, text };
  }

  function publish(entry, now = Date.now(), passwordHash = null, ownerTokenHash = null) {
    const value = validEntry(entry);
    if (!value) return null;
    upsertRow.run({
      author: value.author,
      created_at: now,
      edit_password_hash: passwordHash,
      node_key: value.nodeKey,
      owner_token_hash: ownerTokenHash,
      source_title: value.sourceTitle,
      source_url: value.sourceUrl,
      text: value.text,
      updated_at: now,
    });
    return mapRow(selectOne.get(value.nodeKey));
  }

  return {
    adminUpdate: (nodeKey, entry, now = Date.now()) => {
      const value = validEntry({ author: entry?.author, nodeKey, text: entry?.text });
      if (!value) return null;
      const current = selectOne.get(value.nodeKey);
      if (!current) return null;
      const info = db.transaction(() => {
        updatePublished.run({
          author: value.author,
          node_key: value.nodeKey,
          text: value.text,
          updated_at: now,
        });
        deletePending.run(value.nodeKey);
        return mapRow(selectOne.get(value.nodeKey));
      })();
      return info;
    },
    importText: (nodeKey, entry, now = Date.now()) => {
      const value = validEntry({ ...entry, nodeKey });
      if (!value) return null;
      const current = selectOne.get(value.nodeKey);
      const info = db.transaction(() => {
        upsertRow.run({
          author: value.author,
          created_at: current?.created_at || now,
          edit_password_hash: current?.edit_password_hash || null,
          node_key: value.nodeKey,
          owner_token_hash: current?.owner_token_hash || null,
          source_title: value.sourceTitle,
          source_url: value.sourceUrl,
          text: value.text,
          updated_at: now,
        });
        deletePending.run(value.nodeKey);
        return mapRow(selectOne.get(value.nodeKey));
      })();
      return info;
    },
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
        }, now, current?.edit_password_hash || null, current?.owner_token_hash || null);
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
    removeOwned: (nodeKey, { token = "", password = "" } = {}) => {
      const key = String(nodeKey || "").toLowerCase();
      const current = selectOne.get(key);
      if (!current) return { error: "not_found" };
      const tokenValid = ownerTokenMatches(String(token || ""), current.owner_token_hash);
      const passwordValid = Boolean(password && current.edit_password_hash && passwordMatches(password, current.edit_password_hash));
      if (!tokenValid && !passwordValid) return { error: "forbidden" };
      const removed = db.transaction(() => {
        const changes = deleteRow.run(key).changes > 0;
        deletePending.run(key);
        return changes;
      })();
      return { removed };
    },
    submit: (entry, now = Date.now()) => {
      const value = validEntry(entry);
      if (!value) return null;
      const password = String(entry?.password || "");
      if (password && !validPassword(password)) return { error: "invalid_password" };
      const token = String(entry?.token || "");
      const current = selectOne.get(value.nodeKey);
      if (!current) {
        const manageToken = randomBytes(32).toString("base64url");
        return {
          info: publish(value, now, password ? hashPassword(password) : null, hashOwnerToken(manageToken)),
          manageToken,
          status: "published",
        };
      }
      const tokenValid = ownerTokenMatches(token, current.owner_token_hash);
      let passwordValid = false;
      if (password && current.edit_password_hash) {
        if (passwordMatches(password, current.edit_password_hash)) passwordValid = true;
        else if (!tokenValid) return { error: "bad_password" };
      }
      if (tokenValid || passwordValid) {
        let manageToken = null;
        let ownerTokenHash = current.owner_token_hash || null;
        if (!ownerTokenHash) {
          manageToken = randomBytes(32).toString("base64url");
          ownerTokenHash = hashOwnerToken(manageToken);
        }
        const passwordHash = current.edit_password_hash || (password ? hashPassword(password) : null);
        const info = db.transaction(() => {
          const published = publish(value, now, passwordHash, ownerTokenHash);
          deletePending.run(value.nodeKey);
          return published;
        })();
        return { info, manageToken, status: "published" };
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
