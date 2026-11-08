const STORAGE_KEY = "meshcorePhotoManageTokens";
const MAX_TOKENS = 500;
const MAX_UPLOADS = 50;

export function createPhotoTokenStore(storage = globalThis.localStorage) {
  function read() {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function write(tokens) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(tokens));
      return true;
    } catch {
      return false;
    }
  }

  function get(photoId) {
    const value = read()[String(photoId || "")];
    if (typeof value === "string") return value;
    return typeof value?.token === "string" ? value.token : "";
  }

  function remember(photoId, token, metadata = {}) {
    if (!photoId || !token) return false;
    const tokens = read();
    const previous = tokens[String(photoId)];
    const previousMetadata = previous && typeof previous === "object" ? previous : {};
    tokens[String(photoId)] = {
      ...previousMetadata,
      ...metadata,
      token: String(token),
      savedAt: Date.now(),
    };
    const ids = Object.keys(tokens);
    while (ids.length > MAX_TOKENS) delete tokens[ids.shift()];
    return write(tokens);
  }

  function forget(photoId) {
    const tokens = read();
    delete tokens[String(photoId || "")];
    write(tokens);
  }

  function uploads() {
    return Object.values(read())
      .filter((value) => value && typeof value === "object" && value.node?.public_key && value.photo?.id)
      .map((value) => ({ node: value.node, photo: value.photo }))
      .sort((first, second) => Number(second.photo.createdAt || 0) - Number(first.photo.createdAt || 0))
      .slice(0, MAX_UPLOADS);
  }

  return { forget, get, remember, uploads };
}
