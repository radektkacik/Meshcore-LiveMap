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

export function sortPhotosNewestFirst(photos) {
  return (Array.isArray(photos) ? photos.filter(Boolean) : []).slice().sort(byNewest);
}
