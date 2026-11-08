export const NEW_PHOTO_MS = 24 * 60 * 60 * 1000;

function createdAtValue(photo) {
  const value = Number(photo?.createdAt);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function isNewPhoto(photo, now = Date.now(), newMs = NEW_PHOTO_MS) {
  const createdAt = createdAtValue(photo);
  const age = now - createdAt;
  return createdAt > 0 && Number.isFinite(newMs) && newMs >= 0 && age >= 0 && age <= newMs;
}

function byNewest(first, second) {
  return createdAtValue(second) - createdAtValue(first);
}

export function buildPhotoGallerySections(photos, {
  now = Date.now(),
  newMs = NEW_PHOTO_MS,
  collator = new Intl.Collator("cs", { numeric: true, sensitivity: "base" }),
} = {}) {
  const list = Array.isArray(photos) ? photos.filter(Boolean) : [];
  const recent = [];
  const byNode = new Map();

  for (const photo of list) {
    if (isNewPhoto(photo, now, newMs)) {
      recent.push(photo);
      continue;
    }
    const nodeName = String(photo.nodeName || "").trim();
    const nodeKey = String(photo.nodeKey || "").toLowerCase();
    const groupKey = nodeKey || nodeName;
    let group = byNode.get(groupKey);
    if (!group) {
      group = { nodeKey, nodeName, photos: [] };
      byNode.set(groupKey, group);
    }
    if (!group.nodeName && nodeName) group.nodeName = nodeName;
    group.photos.push(photo);
  }

  recent.sort(byNewest);
  const groups = [...byNode.values()]
    .map((group) => ({ ...group, photos: group.photos.sort(byNewest) }))
    .sort((first, second) => collator.compare(first.nodeName, second.nodeName)
      || collator.compare(first.nodeKey, second.nodeKey));

  return { groups, recent };
}
