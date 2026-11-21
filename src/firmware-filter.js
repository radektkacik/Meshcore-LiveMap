export const FIRMWARE_NONE = "__none__";

export function firmwareKey(nodeOrValue) {
  const value = typeof nodeOrValue === "string"
    ? nodeOrValue
    : (nodeOrValue?.health?.firmware ?? nodeOrValue?.healthConfig?.firmware ?? null);
  return value ? String(value) : FIRMWARE_NONE;
}

export function firmwareShortLabel(value) {
  if (!value || value === FIRMWARE_NONE) return null;
  const match = String(value).match(/rc[.\-]?(.+)$/i);
  if (!match) return String(value);
  const label = match[1].replace(/-meshcz.*$/i, "").replace(/[.\-]+$/g, "");
  return label ? `RC${label}` : String(value);
}

export function firmwareGroups(nodes = []) {
  const groups = new Map();
  for (const node of nodes) {
    const key = firmwareKey(node);
    const group = groups.get(key) || { key, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((first, second) => {
    if (first.key === FIRMWARE_NONE) return 1;
    if (second.key === FIRMWARE_NONE) return -1;
    return second.count - first.count || first.key.localeCompare(second.key);
  });
}

export function firmwareMatches(filter, node) {
  if (filter === null) return true;
  return filter.has(firmwareKey(node));
}
