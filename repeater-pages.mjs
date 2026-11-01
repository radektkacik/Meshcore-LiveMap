const PAGE_BASE = "https://meshcore.cz";
const RAW_BASE = `${PAGE_BASE}/_export/raw/repeatery:`;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RAW_BYTES = 256 * 1024;
const MAX_TEXT = 1000;
const pageCache = new Map();

function ascii(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7f]/g, "");
}

function normalized(value) {
  return ascii(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function validRepeaterSlug(value) {
  return /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(String(value || ""));
}

export function guessRepeaterSlugs(name) {
  const source = ascii(name).toLowerCase()
    .replace(/\.meshcore\.(cz|rpt|meshcor).*$/i, "")
    .replace(/\.meshcor$/i, "");
  const tokens = source.split(/[^a-z0-9]+/).filter(Boolean)
    .filter((token) => !["meshcore", "meshcor", "cz", "rpt"].includes(token));
  const candidates = new Set();
  const add = (value) => {
    const slug = String(value || "").replace(/^[-_]+|[-_]+$/g, "");
    if (slug && validRepeaterSlug(slug)) candidates.add(slug);
  };
  if (tokens.length) {
    add(tokens.join("_"));
    add(tokens.join("-"));
    add(tokens.join(""));
    add(tokens.at(-1));
    for (const token of tokens) if (token.length >= 4) add(token);
    const primary = tokens.join("");
    for (let length = 5; length < primary.length; length += 1) add(primary.slice(0, length));
  }
  return [...candidates].slice(0, 20);
}

function firstHeading(raw) {
  const match = String(raw || "").match(/^={1,6}\s*(.+?)\s*={1,6}\s*$/m);
  return match ? match[1].trim() : "";
}

function wikiToText(raw) {
  return String(raw || "")
    .replace(/^={1,6}\s*.*?\s*={1,6}\s*$/gm, "")
    .replace(/\{\{:[^}]*\}\}/g, "")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseRepeaterRaw(raw) {
  const title = firstHeading(raw);
  const images = [...String(raw || "").matchAll(/\{\{:\s*repeatery:([^}|\s?]+)/gi)]
    .map((match) => match[1])
    .filter(Boolean);
  let text = wikiToText(raw);
  if (text.length > MAX_TEXT) {
    text = `${text.slice(0, MAX_TEXT - 1).replace(/\s+\S*$/, "")}…`.trim();
  }
  return {
    imageCount: images.length,
    images: [...new Set(images)],
    text,
    title,
  };
}

export function repeaterSourceUrl(slug) {
  return `${PAGE_BASE}/doku.php?id=repeatery:${encodeURIComponent(slug)}`;
}

function pageMatches(page, nodeName) {
  if (!page) return false;
  const title = normalized(page.title);
  const name = normalized(nodeName);
  if (!name) return false;
  if (title === name) return true;
  if (title.length >= 5 && (name.includes(title) || title.includes(name))) return true;
  const slug = normalized(page.slug);
  return Boolean(slug && slug.length >= 4 && (slug === name || name.includes(slug) || slug.includes(name)));
}

export async function fetchRepeaterPage(slug) {
  const key = String(slug || "").toLowerCase();
  if (!validRepeaterSlug(key)) return null;
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.page;
  let page = null;
  try {
    const response = await fetch(`${RAW_BASE}${encodeURIComponent(key)}`, {
      headers: { "User-Agent": "meshcore-map-import/1" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.startsWith("text/plain")) {
      const raw = (await response.text()).slice(0, MAX_RAW_BYTES);
      const parsed = parseRepeaterRaw(raw);
      page = {
        ...parsed,
        slug: key,
        sourceUrl: repeaterSourceUrl(key),
        title: parsed.title || key,
      };
    }
  } catch {
    page = null;
  }
  pageCache.set(key, { at: Date.now(), page });
  if (pageCache.size > 100) pageCache.delete(pageCache.keys().next().value);
  return page;
}

export async function findRepeaterPage(nodeName) {
  for (const slug of guessRepeaterSlugs(nodeName)) {
    const page = await fetchRepeaterPage(slug);
    if (page && pageMatches(page, nodeName)) return page;
  }
  return null;
}
