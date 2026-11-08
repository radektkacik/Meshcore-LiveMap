export const NEW_PHOTO_MS = 3 * 24 * 60 * 60 * 1000;

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
  collator = new Intl.Collator("cs", { numeric: true, sensitivity: "base" }),
} = {}) {
  const groups = new Map();
  for (const photo of Array.isArray(photos) ? photos : []) {
    if (!photo) continue;
    const nodeName = String(photo.nodeName || "").trim();
    const nodeKey = String(photo.nodeKey || "").toLowerCase();
    const groupKey = nodeKey || nodeName;
    let group = groups.get(groupKey);
    if (!group) {
      group = { latestCreatedAt: 0, nodeKey, nodeName, photos: [] };
      groups.set(groupKey, group);
    }
    if (!group.nodeName && nodeName) group.nodeName = nodeName;
    group.latestCreatedAt = Math.max(group.latestCreatedAt, createdAtValue(photo));
    group.photos.push(photo);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, photos: group.photos.sort(byNewest) }))
    .sort((first, second) => second.latestCreatedAt - first.latestCreatedAt
      || collator.compare(first.nodeName, second.nodeName)
      || collator.compare(first.nodeKey, second.nodeKey));
}
