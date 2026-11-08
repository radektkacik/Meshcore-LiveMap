import assert from "node:assert/strict";
import test from "node:test";
import { isNewPhoto, NEW_PHOTO_MS, sortPhotosNewestFirst } from "../src/photo-gallery-model.js";

const now = Date.UTC(2026, 10, 8, 17);
const hour = 60 * 60 * 1000;

function photo(id, ageMs, nodeName = "Node") {
  return {
    createdAt: now - ageMs,
    id,
    nodeKey: "f".repeat(64),
    nodeName,
  };
}

test("photo is new only within the upload window", () => {
  assert.equal(isNewPhoto(photo("a", hour), now), true);
  assert.equal(isNewPhoto(photo("b", NEW_PHOTO_MS), now), true);
  assert.equal(isNewPhoto(photo("c", NEW_PHOTO_MS + hour), now), false);
  assert.equal(isNewPhoto(photo("d", -hour), now), false);
  assert.equal(isNewPhoto({}, now), false);
});

test("gallery photos are sorted newest first regardless of node", () => {
  const photos = [
    photo("1", 30 * hour, "Želešice"),
    photo("2", 2 * hour, "alpha"),
    photo("3", 32 * hour, "Česká"),
    photo("4", 5 * hour, "beta"),
    photo("5", hour, "alpha"),
  ];
  assert.deepEqual(sortPhotosNewestFirst(photos).map((item) => item.id), ["5", "2", "4", "1", "3"]);
});

test("gallery ignores invalid creation times and does not mutate the input", () => {
  const photos = [
    photo("a", 25 * hour),
    { createdAt: "nope", id: "b" },
    photo("c", 26 * hour),
  ];
  const sorted = sortPhotosNewestFirst(photos);
  assert.deepEqual(sorted.map((item) => item.id), ["a", "c", "b"]);
  assert.deepEqual(photos.map((item) => item.id), ["a", "b", "c"]);
});
