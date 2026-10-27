import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPhotoStore, detectImage, PhotoError } from "../photos.mjs";

function pngBuffer(width = 640, height = 480) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegBuffer(width = 800, height = 600) {
  const buffer = Buffer.alloc(32, 0);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 0x08;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

function webpBuffer(width = 1024, height = 768) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

test("detectImage recognises PNG, JPEG and WebP dimensions", () => {
  assert.deepEqual(detectImage(pngBuffer(640, 480)), { mime: "image/png", ext: "png", width: 640, height: 480 });
  assert.deepEqual(detectImage(jpegBuffer(800, 600)), { mime: "image/jpeg", ext: "jpg", width: 800, height: 600 });
  assert.deepEqual(detectImage(webpBuffer(1024, 768)), { mime: "image/webp", ext: "webp", width: 1024, height: 768 });
  assert.equal(detectImage(Buffer.from("not an image")), null);
  assert.equal(detectImage(Buffer.alloc(0)), null);
});

test("photo store creates a pending photo, hides it until approval and serves the file", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-photos-"));
  const store = createPhotoStore(directory);
  const nodeKey = "a".repeat(64);
  try {
    const photo = store.create({
      buffer: pngBuffer(),
      caption: "Anténa",
      author: "Petr",
      ipHash: "abc",
      nodeKey,
    });
    assert.equal(photo.status, "pending");
    assert.equal(photo.caption, "Anténa");
    assert.equal(photo.width, 640);
    assert.deepEqual(store.listApproved(nodeKey), []);
    assert.equal(store.stats().pending, 1);

    assert.equal(store.setStatus(photo.id, "approved"), true);
    const approved = store.listApproved(nodeKey);
    assert.equal(approved.length, 1);
    assert.equal(approved[0].id, photo.id);
    assert.ok(existsSync(store.filePath(photo.id)));

    store.setStatus(photo.id, "hidden");
    assert.deepEqual(store.listApproved(nodeKey), []);
    assert.equal(store.listAdmin("hidden").length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("photo store can publish a photo immediately when auto-approval is enabled", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-photos-"));
  const store = createPhotoStore(directory);
  const nodeKey = "f".repeat(64);
  try {
    const photo = store.create({ buffer: pngBuffer(), nodeKey, status: "approved" });
    assert.equal(photo.status, "approved");
    assert.deepEqual(store.listApproved(nodeKey).map((item) => item.id), [photo.id]);
    assert.equal(store.stats().pending, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("photo store rejects invalid input and enforces the per-node limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-photos-"));
  const store = createPhotoStore(directory, { maxPerNode: 1 });
  const nodeKey = "b".repeat(64);
  try {
    assert.throws(
      () => store.create({ buffer: Buffer.from("nope"), nodeKey }),
      (error) => error instanceof PhotoError && error.code === "invalid_image",
    );
    assert.throws(
      () => store.create({ buffer: pngBuffer(), nodeKey: "short" }),
      (error) => error instanceof PhotoError && error.code === "invalid_key",
    );
    store.create({ buffer: pngBuffer(), nodeKey });
    assert.throws(
      () => store.create({ buffer: pngBuffer(), nodeKey }),
      (error) => error instanceof PhotoError && error.code === "node_limit",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("photo store rejects images above the configured resolution", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-photos-"));
  const store = createPhotoStore(directory, { maxDimension: 500 });
  try {
    assert.throws(
      () => store.create({ buffer: pngBuffer(640, 480), nodeKey: "d".repeat(64) }),
      (error) => error instanceof PhotoError && error.code === "too_large_dimensions",
    );
    assert.equal(store.create({ buffer: pngBuffer(500, 400), nodeKey: "d".repeat(64) }).width, 500);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("photo store lists approved node counts", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-photos-"));
  const store = createPhotoStore(directory);
  const first = "1".repeat(64);
  const second = "2".repeat(64);
  try {
    const a = store.create({ buffer: pngBuffer(), nodeKey: first });
    const a2 = store.create({ buffer: pngBuffer(), nodeKey: first });
    const b = store.create({ buffer: pngBuffer(), nodeKey: second });
    store.setStatus(a.id, "approved");
    store.setStatus(a2.id, "approved");
    store.setStatus(b.id, "approved");
    assert.deepEqual(store.listApprovedNodeCounts(), [
      { count: 2, nodeKey: first },
      { count: 1, nodeKey: second },
    ]);
    store.setStatus(b.id, "hidden");
    assert.deepEqual(store.listApprovedNodeCounts(), [{ count: 2, nodeKey: first }]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("photo reports are stored, listed and resolved with the photo", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-photos-"));
  const store = createPhotoStore(directory);
  const nodeKey = "e".repeat(64);
  try {
    const photo = store.create({ buffer: pngBuffer(), nodeKey });
    store.setStatus(photo.id, "approved");
    assert.equal(store.createReport({ photoId: "f".repeat(36), message: "test" }), null);
    const reportId = store.createReport({
      contact: "tester@example.com",
      message: "Je to moje fotka.",
      photoId: photo.id,
      reason: "owner",
    });
    assert.ok(reportId);
    assert.equal(store.openReportCount(), 1);
    const reports = store.listReports("open");
    assert.equal(reports.length, 1);
    assert.equal(reports[0].reason, "owner");
    assert.equal(reports[0].contact, "tester@example.com");
    assert.equal(reports[0].photo.nodeKey, nodeKey);

    assert.equal(store.resolveReport(reportId), true);
    assert.equal(store.openReportCount(), 0);
    assert.equal(store.listReports("open").length, 0);

    store.createReport({ message: "Druhá žádost", photoId: photo.id, reason: "other" });
    assert.equal(store.openReportCount(), 1);
    assert.equal(store.remove(photo.id), true);
    assert.equal(store.openReportCount(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("photo store removes metadata and the file", () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-photos-"));
  const store = createPhotoStore(directory);
  try {
    const photo = store.create({ buffer: jpegBuffer(), nodeKey: "c".repeat(64) });
    const path = store.filePath(photo.id);
    assert.ok(existsSync(path));
    assert.equal(store.remove(photo.id), true);
    assert.equal(existsSync(path), false);
    assert.equal(store.get(photo.id), null);
    assert.equal(store.remove(photo.id), false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
