const VOTER_KEY = "meshcorePhotoVoterId";
const API_TIMEOUT_MS = 20_000;
let fallbackVoterId = "";

export function getPhotoVoterId() {
  try {
    const stored = localStorage.getItem(VOTER_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,128}$/.test(stored)) return stored;
  } catch {}
  if (fallbackVoterId) return fallbackVoterId;
  const created = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  fallbackVoterId = created;
  try {
    localStorage.setItem(VOTER_KEY, created);
  } catch {}
  return created;
}

async function request(appPath, path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Photo-Voter", getPhotoVoterId());
  const response = await fetch(appPath(path), {
    ...options,
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

export async function getPhotoJson(appPath, path) {
  return request(appPath, path);
}

export async function voteForPhoto(appPath, photoId, value) {
  return request(appPath, `/api/photos/${encodeURIComponent(photoId)}/vote`, {
    body: JSON.stringify({ value }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
