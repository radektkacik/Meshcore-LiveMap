import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { detectImage, normalizeUploadedImage } from "../photos.mjs";

test("truncated PNG headers never throw and are rejected", async () => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let size = 8; size < 33; size += 1) {
    const buffer = Buffer.alloc(size);
    signature.copy(buffer);
    assert.equal(detectImage(buffer), null);
    await assert.rejects(normalizeUploadedImage(buffer), { code: "invalid_image" });
  }
});

test("header-only images cannot pass full upload validation", async () => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12);
  buffer.writeUInt32BE(1, 16);
  buffer.writeUInt32BE(1, 20);
  await assert.rejects(normalizeUploadedImage(buffer), { code: "invalid_image" });
});

for (const format of ["png", "jpeg", "webp"]) {
  test(`valid ${format} uploads are decoded and re-encoded without trailing data`, async () => {
    const input = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#336699" } })
      .toFormat(format).toBuffer();
    const marker = Buffer.from("UNTRUSTED-TRAILING-PAYLOAD");
    const output = await normalizeUploadedImage(Buffer.concat([input, marker]));
    assert.equal(output.includes(marker), false);
    const meta = await sharp(output).metadata();
    assert.equal(meta.width, 8);
    assert.equal(meta.height, 6);
    assert.equal(meta.format, format);
  });
}

test("image dimension and output byte limits are enforced", async () => {
  const input = await sharp({ create: { width: 110, height: 10, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normalizeUploadedImage(input, { maxDimension: 100 }), { code: "too_large_dimensions" });
  await assert.rejects(normalizeUploadedImage(input, { maxBytes: 10 }), { code: "too_large" });
});
