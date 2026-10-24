export const PLAYBACK_BASE_MS = 60_000;
export const PLAYBACK_MIN_TRAIL_MS = 2 * 60_000;
export const PLAYBACK_MAX_TRAIL_MS = 6 * 60 * 60_000;

export function playbackTrailMs(windowMs) {
  const window = Math.max(0, Number(windowMs) || 0);
  return Math.min(Math.max(window / 48, PLAYBACK_MIN_TRAIL_MS), PLAYBACK_MAX_TRAIL_MS);
}

export function playbackCursor(start, end, fraction) {
  const from = Number(start) || 0;
  const to = Number(end) || 0;
  const value = Math.min(1, Math.max(0, Number(fraction) || 0));
  return from + (to - from) * value;
}

export function playbackFraction(start, end, cursor) {
  const from = Number(start) || 0;
  const to = Number(end) || 0;
  if (to <= from) return 0;
  return Math.min(1, Math.max(0, (Number(cursor) - from) / (to - from)));
}

export function playbackVisibleRoutes(routes, cursor, trailMs) {
  const until = Number(cursor);
  const since = until - Math.max(0, Number(trailMs) || 0);
  return (routes || []).filter((route) => route.timestamp >= since && route.timestamp <= until);
}

export function playbackRate(windowMs, speed = 1) {
  const window = Math.max(0, Number(windowMs) || 0);
  return (window / PLAYBACK_BASE_MS) * Math.max(0.1, Number(speed) || 1);
}
