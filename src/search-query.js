export function parseSearchQuery(raw) {
  const text = String(raw || "").trim();
  const token = text.replace(/\s+/g, "");
  return {
    query: text.toLocaleLowerCase("cs-CZ"),
    hex: /^[0-9a-f]{2,}$/i.test(token) ? token.toUpperCase() : "",
  };
}
