const PREFIX = "meshcore.trace.preferred.";
const VALID_KEY = /^[0-9a-f]{64}$/;

export function getPreferredRepeater(storage, companionKey) {
  try {
    if (!VALID_KEY.test(companionKey)) return null;
    const key = storage.getItem(PREFIX + companionKey);
    return VALID_KEY.test(key || "") ? key : null;
  } catch {
    return null;
  }
}

export function setPreferredRepeater(storage, companionKey, repeaterKey) {
  if (!VALID_KEY.test(companionKey) || (repeaterKey !== null && !VALID_KEY.test(repeaterKey))) return false;
  try {
    if (repeaterKey === null) storage.removeItem(PREFIX + companionKey);
    else storage.setItem(PREFIX + companionKey, repeaterKey);
    return true;
  } catch {
    return false;
  }
}
