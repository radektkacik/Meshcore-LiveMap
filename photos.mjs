import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { openSqliteStore } from "./sqlite-store.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DIMENSION = 8192;
export const PHOTO_STATUSES = ["pending", "approved", "hidden"];

export class PhotoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PhotoError";
    this.code = code;
  }
}

function validSize(width, height) {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0
    && width <= MAX_DIMENSION && height <= MAX_DIMENSION;
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return validSize(width, height) ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(buffer) {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30
    && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

export function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return validSize(width, height) ? { mime: "image/png", ext: "png", width, height } : null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const size = jpegSize(buffer);
    return size ? { mime: "image/jpeg", ext: "jpg", ...size } : null;
  }
  if (buffer.length >= 30
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP") {
    const size = webpSize(buffer);
    return size ? { mime: "image/webp", ext: "webp", ...size } : null;
  }
  return null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    author: row.author || "",
    bytes: row.bytes,
    caption: row.caption || "",
    createdAt: row.created_at,
    file: row.file,
    height: row.height,
    id: row.id,
    mime: row.mime,
    nodeKey: row.node_key,
    reviewedAt: row.reviewed_at,
    status: row.status,
    width: row.width,
  };
}

export function createPhotoStore(rootDir, {
  maxBytes = 5 * 1024 * 1024,
  maxDimension = 2400,
  maxPerNode = 8,
  maxReports = 10_000,
  maxRows = 10_000,
  maxTotalBytes = 2 * 1024 * 1024 * 1024,
} = {}) {
  const filesDir = join(rootDir, "files");
  mkdirSync(filesDir, { recursive: true });
  const db = openSqliteStore(join(rootDir, "photos.sqlite"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      node_key TEXT NOT NULL,
      file TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      caption TEXT,
      author TEXT,
      ip_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS photos_node ON photos (node_key, status, created_at);
    CREATE INDEX IF NOT EXISTS photos_status ON photos (status, created_at);
    CREATE TABLE IF NOT EXISTS photo_covers (
      node_key TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS photo_covers_photo ON photo_covers (photo_id);
    CREATE TABLE IF NOT EXISTS photo_cover_requests (
      node_key TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photo_reports (
      id TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      message TEXT,
      contact TEXT,
      ip_hash TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS photo_reports_photo ON photo_reports (photo_id, status);
    CREATE INDEX IF NOT EXISTS photo_reports_status ON photo_reports (status, created_at);
  `);

  const insert = db.prepare(`
    INSERT INTO photos (
      id, node_key, file, mime, bytes, width, height, caption, author, ip_hash, status, created_at
    ) VALUES (
      @id, @node_key, @file, @mime, @bytes, @width, @height, @caption, @author, @ip_hash, @status, @created_at
    )
  `);
  const selectById = db.prepare("SELECT * FROM photos WHERE id = ?");
  const selectCover = db.prepare("SELECT photo_id FROM photo_covers WHERE node_key = ?");
  const selectLatestApproved = db.prepare(`
    SELECT id FROM photos WHERE node_key = ? AND status = 'approved'
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `);
  const selectApproved = db.prepare(`
    SELECT * FROM photos WHERE node_key = ? AND status = 'approved'
    ORDER BY created_at DESC LIMIT ?
  `);
  const selectApprovedNodeCounts = db.prepare(`
    SELECT p.node_key, COUNT(*) AS total,
      COALESCE(
        (
          SELECT c.photo_id FROM photo_covers c
          JOIN photos cp ON cp.id = c.photo_id
          WHERE c.node_key = p.node_key AND cp.status = 'approved'
          LIMIT 1
        ),
        (
          SELECT p2.id FROM photos p2
          WHERE p2.node_key = p.node_key AND p2.status = 'approved'
          ORDER BY p2.created_at DESC, p2.rowid DESC
          LIMIT 1
        )
      ) AS cover_id
    FROM photos p
    WHERE p.status = 'approved'
    GROUP BY p.node_key
    ORDER BY total DESC, p.node_key ASC
    LIMIT ?
  `);
  const selectByStatus = db.prepare(`
    SELECT * FROM photos WHERE status = ? ORDER BY created_at DESC LIMIT ?
  `);
  const selectAll = db.prepare("SELECT * FROM photos ORDER BY created_at DESC LIMIT ?");
  const countNode = db.prepare(`
    SELECT COUNT(*) AS total FROM photos WHERE node_key = ? AND status IN ('pending', 'approved')
  `);
  const countRows = db.prepare("SELECT COUNT(*) AS total FROM photos");
  const sumBytes = db.prepare("SELECT COALESCE(SUM(bytes), 0) AS total FROM photos");
  const countPending = db.prepare("SELECT COUNT(*) AS total FROM photos WHERE status = 'pending'");
  const updateStatus = db.prepare("UPDATE photos SET status = ?, reviewed_at = ? WHERE id = ?");
  const deleteRow = db.prepare("DELETE FROM photos WHERE id = ?");
  const upsertCover = db.prepare(`
    INSERT INTO photo_covers (node_key, photo_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(node_key) DO UPDATE SET photo_id = excluded.photo_id, updated_at = excluded.updated_at
  `);
  const deleteCoverByPhoto = db.prepare("DELETE FROM photo_covers WHERE photo_id = ?");
  const upsertCoverRequest = db.prepare(`
    INSERT INTO photo_cover_requests (node_key, photo_id, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(node_key) DO UPDATE SET photo_id = excluded.photo_id, created_at = excluded.created_at
  `);
  const selectCoverRequestByPhoto = db.prepare("SELECT node_key, photo_id FROM photo_cover_requests WHERE photo_id = ?");
  const deleteCoverRequestByNode = db.prepare("DELETE FROM photo_cover_requests WHERE node_key = ?");
  const deleteCoverRequestByPhoto = db.prepare("DELETE FROM photo_cover_requests WHERE photo_id = ?");
  const insertReport = db.prepare(`
    INSERT INTO photo_reports (id, photo_id, reason, message, contact, ip_hash, status, created_at)
    VALUES (@id, @photo_id, @reason, @message, @contact, @ip_hash, 'open', @created_at)
  `);
  const selectReports = db.prepare(`
    SELECT r.id, r.photo_id, r.reason, r.message, r.contact, r.status, r.created_at, r.resolved_at,
      p.caption, p.node_key, p.status AS photo_status
    FROM photo_reports r
    LEFT JOIN photos p ON p.id = r.photo_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `);
  const countOpenReports = db.prepare("SELECT COUNT(*) AS total FROM photo_reports WHERE status = 'open'");
  const resolveReport = db.prepare("UPDATE photo_reports SET status = 'resolved', resolved_at = ? WHERE id = ?");
  const resolvePhotoReports = db.prepare(`
    UPDATE photo_reports SET status = 'resolved', resolved_at = ? WHERE photo_id = ? AND status = 'open'
  `);
  const countReports = db.prepare("SELECT COUNT(*) AS total FROM photo_reports");
  const pruneReports = db.prepare(`
    DELETE FROM photo_reports WHERE id IN (
      SELECT id FROM photo_reports WHERE status = 'resolved' ORDER BY created_at ASC LIMIT ?
    )
  `);

  function absolutePath(row) {
    const relative = normalize(String(row?.file || ""));
    const absolute = join(filesDir, relative);
    if (!absolute.startsWith(filesDir + sep)) return null;
    return absolute;
  }

  function get(id) {
    return mapRow(selectById.get(String(id || "")));
  }

  function applyCover(nodeKey, photoId, now = Date.now()) {
    upsertCover.run(nodeKey, photoId, now);
    deleteCoverRequestByNode.run(nodeKey);
  }

  return {
    close: () => db.close(),
    create(entry) {
      const buffer = entry?.buffer;
      const nodeKey = String(entry?.nodeKey || "").toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(nodeKey)) throw new PhotoError("invalid_key", "Neplatný klíč nodu.");
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new PhotoError("invalid_image", "Fotka chybí.");
      }
      if (buffer.length > maxBytes) throw new PhotoError("too_large", "Fotka je příliš velká.");
      const image = detectImage(buffer);
      if (!image) throw new PhotoError("invalid_image", "Nepodporovaný formát fotky.");
      if (image.width > maxDimension || image.height > maxDimension) {
        throw new PhotoError("too_large_dimensions", `Fotka má příliš velké rozlišení (max. ${maxDimension} px).`);
      }
      if (countRows.get().total >= maxRows) throw new PhotoError("store_full", "Úložiště fotek je plné.");
      if (sumBytes.get().total + buffer.length > maxTotalBytes) {
        throw new PhotoError("store_full", "Úložiště fotek je plné.");
      }
      if (countNode.get(nodeKey).total >= maxPerNode) {
        throw new PhotoError("node_limit", "Tento nod už má maximální počet fotek.");
      }
      // Keep the current effective cover when a new photo is added.
      if (!selectCover.get(nodeKey)) {
        const latest = selectLatestApproved.get(nodeKey);
        if (latest) upsertCover.run(nodeKey, latest.id, Date.now());
      }
      const id = randomUUID();
      const status = PHOTO_STATUSES.includes(entry?.status) ? entry.status : "pending";
      const file = join(nodeKey.slice(0, 2), nodeKey, `${id}.${image.ext}`);
      const absolute = absolutePath({ file });
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, buffer, { mode: 0o600 });
      insert.run({
        author: String(entry.author || "").slice(0, 60),
        bytes: buffer.length,
        caption: String(entry.caption || "").slice(0, 240),
        created_at: Date.now(),
        file,
        height: image.height,
        id,
        ip_hash: String(entry.ipHash || "").slice(0, 32),
        mime: image.mime,
        node_key: nodeKey,
        status,
        width: image.width,
      });
      if (status === "approved" && !selectCover.get(nodeKey)) {
        upsertCover.run(nodeKey, id, Date.now());
      }
      return get(id);
    },
    createReport(entry) {
      const photoId = String(entry?.photoId || "").toLowerCase();
      if (!/^[0-9a-f-]{36}$/.test(photoId)) throw new PhotoError("invalid_photo", "Neplatná fotka.");
      if (!selectById.get(photoId)) return null;
      const id = randomUUID();
      insertReport.run({
        contact: String(entry.contact || "").slice(0, 200),
        created_at: Date.now(),
        id,
        ip_hash: String(entry.ipHash || "").slice(0, 32),
        message: String(entry.message || "").slice(0, 500),
        photo_id: photoId,
        reason: String(entry.reason || "other").slice(0, 40),
      });
      const overflow = countReports.get().total - maxReports;
      if (overflow > 0) pruneReports.run(overflow);
      return id;
    },
    filePath: (id) => absolutePath(selectById.get(String(id || ""))),
    get,
    listAdmin(status = "all", limit = 200) {
      const safeLimit = Math.min(Math.max(1, Number(limit) || 200), 500);
      const rows = PHOTO_STATUSES.includes(status)
        ? selectByStatus.all(status, safeLimit)
        : selectAll.all(safeLimit);
      return rows.map(mapRow);
    },
    listApproved(nodeKey, limit = 12) {
      const key = String(nodeKey || "").toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) return [];
      return selectApproved.all(key, Math.min(Math.max(1, Number(limit) || 12), 30)).map(mapRow);
    },
    listApprovedNodeCounts(limit = 5000) {
      return selectApprovedNodeCounts.all(Math.min(Math.max(1, Number(limit) || 5000), 10_000)).map((row) => ({
        count: row.total,
        coverId: row.cover_id || null,
        nodeKey: row.node_key,
      }));
    },
    listReports(status = "open", limit = 200) {
      const safeLimit = Math.min(Math.max(1, Number(limit) || 200), 500);
      return selectReports.all(status === "resolved" ? "resolved" : "open", safeLimit).map((row) => ({
        contact: row.contact || "",
        createdAt: row.created_at,
        id: row.id,
        message: row.message || "",
        photo: row.photo_status ? {
          caption: row.caption || "",
          id: row.photo_id,
          nodeKey: row.node_key,
          status: row.photo_status,
        } : null,
        photoId: row.photo_id,
        reason: row.reason,
        resolvedAt: row.resolved_at,
        status: row.status,
      }));
    },
    openReportCount: () => countOpenReports.get().total,
    remove(id) {
      const row = selectById.get(String(id || ""));
      if (!row) return false;
      deleteCoverByPhoto.run(String(id));
      deleteCoverRequestByPhoto.run(String(id));
      deleteRow.run(String(id));
      resolvePhotoReports.run(Date.now(), String(id));
      const absolute = absolutePath(row);
      if (absolute) rmSync(absolute, { force: true });
      return true;
    },
    resolvePhotoReports: (photoId) => resolvePhotoReports.run(Date.now(), String(photoId || "")).changes,
    resolveReport: (id) => resolveReport.run(Date.now(), String(id || "")).changes > 0,
    requestCover(id) {
      const row = selectById.get(String(id || ""));
      if (!row) return false;
      if (row.status === "approved") {
        applyCover(row.node_key, row.id);
        return true;
      }
      if (row.status !== "pending") return false;
      upsertCoverRequest.run(row.node_key, row.id, Date.now());
      return true;
    },
    setCover(id) {
      const row = selectById.get(String(id || ""));
      if (!row || row.status !== "approved") return false;
      applyCover(row.node_key, row.id);
      return true;
    },
    setStatus(id, status) {
      if (!PHOTO_STATUSES.includes(status)) return false;
      const row = selectById.get(String(id || ""));
      if (!row) return false;
      const hadCover = Boolean(selectCover.get(row.node_key));
      const latestBefore = selectLatestApproved.get(row.node_key);
      const changed = updateStatus.run(status, Date.now(), String(id || "")).changes > 0;
      if (!changed) return false;
      if (status === "approved") {
        const request = selectCoverRequestByPhoto.get(String(id || ""));
        if (request) applyCover(request.node_key, request.photo_id);
        else if (!hadCover) {
          if (latestBefore) applyCover(row.node_key, latestBefore.id);
          else applyCover(row.node_key, row.id);
        }
      } else {
        deleteCoverByPhoto.run(String(id || ""));
        deleteCoverRequestByPhoto.run(String(id || ""));
      }
      return true;
    },
    stats: () => ({
      bytes: sumBytes.get().total,
      pending: countPending.get().total,
      reports: countOpenReports.get().total,
      total: countRows.get().total,
    }),
  };
}
