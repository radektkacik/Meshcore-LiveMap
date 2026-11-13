const STORAGE_KEY = "meshcoreNodeInfoTokens";
const MAX_TOKENS = 500;

export function createNodeInfoTokenStore(storage = globalThis.localStorage) {
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

  function get(nodeKey) {
    return String(read()[String(nodeKey || "").toLowerCase()]?.token || "");
  }

  function remember(nodeKey, token) {
    const key = String(nodeKey || "").toLowerCase();
    if (!key || !token) return false;
    const tokens = read();
    tokens[key] = { token: String(token), savedAt: Date.now() };
    const keys = Object.keys(tokens);
    while (keys.length > MAX_TOKENS) delete tokens[keys.shift()];
    return write(tokens);
  }

  function forget(nodeKey) {
    const tokens = read();
    delete tokens[String(nodeKey || "").toLowerCase()];
    return write(tokens);
  }

  return { forget, get, remember };
}
