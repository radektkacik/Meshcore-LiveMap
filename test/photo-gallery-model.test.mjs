import assert from "node:assert/strict";
import test from "node:test";
import { buildPhotoGallerySections, isNewPhoto, NEW_PHOTO_MS } from "../src/photo-gallery-model.js";

const now = Date.UTC(2026, 10, 8, 17);
const hour = 60 * 60 * 1000;

function photo(id, nodeName, ageMs, nodeKey = "f".repeat(64)) {
  return {
    createdAt: now - ageMs,
    id,
    nodeKey,
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

test("gallery puts recent photos first and sorts the rest by node", () => {
  const photos = [
    photo("1", "Želešice", 30 * hour, "1".repeat(64)),
    photo("2", "alpha", 31 * hour, "2".repeat(64)),
    photo("3", "Česká", 32 * hour, "3".repeat(64)),
    photo("4", "beta", 33 * hour, "4".repeat(64)),
    photo("5", "alpha", 34 * hour, "2".repeat(64)),
    photo("6", "Delta", hour, "5".repeat(64)),
  ];

  const { groups, recent } = buildPhotoGallerySections(photos, { now });
  assert.deepEqual(recent.map((item) => item.id), ["6"]);
  assert.deepEqual(groups.map((group) => group.nodeName), ["alpha", "beta", "Česká", "Želešice"]);
  assert.deepEqual(groups.map((group) => group.photos.map((item) => item.id)), [["2", "5"], ["4"], ["3"], ["1"]]);
});

test("gallery orders multiple node photos newest first", () => {
  const photos = [
    photo("a", "Node", 25 * hour),
    photo("b", "Node", 26 * hour),
    photo("c", "Node", 27 * hour),
  ];
  const { groups, recent } = buildPhotoGallerySections(photos, { now });
  assert.deepEqual(recent, []);
  assert.deepEqual(groups[0].photos.map((item) => item.id), ["a", "b", "c"]);
});
