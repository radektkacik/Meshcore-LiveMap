import assert from "node:assert/strict";
import test from "node:test";
import { buildPhotoGallerySections, isNewPhoto, NEW_PHOTO_MS } from "../src/photo-gallery-model.js";

const now = Date.UTC(2026, 10, 8, 17);
const hour = 60 * 60 * 1000;

function photo(id, nodeName, ageMs, nodeKey) {
  return {
    createdAt: now - ageMs,
    id,
    nodeKey: nodeKey || "f".repeat(64),
    nodeName,
  };
}

test("photo is new only within the upload window", () => {
  assert.equal(isNewPhoto(photo("a", "A", hour), now), true);
  assert.equal(isNewPhoto(photo("b", "B", NEW_PHOTO_MS), now), true);
  assert.equal(isNewPhoto(photo("c", "C", NEW_PHOTO_MS + hour), now), false);
  assert.equal(isNewPhoto(photo("d", "D", -hour), now), false);
  assert.equal(isNewPhoto({}, now), false);
});

test("gallery groups by node and orders nodes by their newest photo", () => {
  const photos = [
    photo("1", "Starší nod", 40 * hour, "1".repeat(64)),
    photo("2", "Novější nod", 2 * hour, "2".repeat(64)),
    photo("3", "Nejstarší nod", 50 * hour, "3".repeat(64)),
    photo("4", "Starší nod", 10 * hour, "1".repeat(64)),
    photo("5", "Novější nod", 30 * hour, "2".repeat(64)),
  ];
  const groups = buildPhotoGallerySections(photos);
  assert.deepEqual(groups.map((group) => group.nodeName), ["Novější nod", "Starší nod", "Nejstarší nod"]);
  assert.deepEqual(groups.map((group) => group.photos.map((item) => item.id)), [["2", "5"], ["4", "1"], ["3"]]);
});

test("nodes with the same latest time fall back to node name", () => {
  const photos = [
    photo("1", "Želešice", 5 * hour, "1".repeat(64)),
    photo("2", "alpha", 5 * hour, "2".repeat(64)),
    photo("3", "Česká", 5 * hour, "3".repeat(64)),
  ];
  const groups = buildPhotoGallerySections(photos);
  assert.deepEqual(groups.map((group) => group.nodeName), ["alpha", "Česká", "Želešice"]);
});

test("gallery ignores invalid creation times when ordering", () => {
  const photos = [
    { createdAt: "nope", id: "bad", nodeKey: "b".repeat(64), nodeName: "Bad" },
    photo("good", "Good", 25 * hour, "a".repeat(64)),
  ];
  const groups = buildPhotoGallerySections(photos);
  assert.deepEqual(groups.map((group) => group.nodeName), ["Good", "Bad"]);
  assert.deepEqual(groups[0].photos.map((item) => item.id), ["good"]);
});
