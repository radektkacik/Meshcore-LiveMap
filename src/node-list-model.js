function normalizedText(value, locale) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase(locale);
}

export function filterNodeList(nodes, {
  query = "",
  includeInactive = false,
  isActive = () => true,
  role = "all",
  locale = "cs-CZ",
} = {}) {
  const terms = normalizedText(query, locale).trim().split(/\s+/).filter(Boolean);
  return nodes.filter((node) => {
    if (!includeInactive && !isActive(node)) return false;
    if (role !== "all" && (node.role || "unknown") !== role) return false;
    if (!terms.length) return true;

    const publicKey = normalizedText(node.public_key, locale);
    const textFields = [
      node.name,
      node.role,
      node.health?.boardName,
      node.health?.firmware,
    ].map((value) => normalizedText(value, locale));
    return terms.every((term) => publicKey.startsWith(term) || textFields.some((field) => field.includes(term)));
  });
}

function nodeSortValue(node, sortBy, activityAt) {
  switch (sortBy) {
    case "id":
      return node.public_key || "";
    case "role":
      return node.role || "unknown";
    case "relay":
      return node.relay_count_24h;
    case "battery":
      return node.health?.batteryMv ?? node.battery_mv;
    case "activity":
      return activityAt(node);
    case "name":
    default:
      return node.name || node.public_key || "";
  }
}

export function sortNodeList(nodes, {
  sortBy = "activity",
  direction = "desc",
  activityAt = () => 0,
  locale = "cs-CZ",
} = {}) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...nodes].sort((left, right) => {
    const a = nodeSortValue(left, sortBy, activityAt);
    const b = nodeSortValue(right, sortBy, activityAt);
    const aMissing = a == null || a === "";
    const bMissing = b == null || b === "";
    if (aMissing !== bMissing) return aMissing ? 1 : -1;

    let result = 0;
    if (!aMissing && !bMissing && typeof a === "number" && typeof b === "number") {
      result = a - b;
    } else if (!aMissing && !bMissing) {
      result = String(a).localeCompare(String(b), locale, { numeric: true, sensitivity: "base" });
    }
    if (result) return result * multiplier;
    return String(left.public_key || "").localeCompare(String(right.public_key || ""));
  });
}
