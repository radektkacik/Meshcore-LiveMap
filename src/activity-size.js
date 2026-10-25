export const ACTIVITY_MIN_WIDTH = 240;
export const ACTIVITY_MIN_HEIGHT = 150;

export function clampActivitySize(size, limits = {}) {
  const minWidth = Number(limits.minWidth ?? ACTIVITY_MIN_WIDTH);
  const minHeight = Number(limits.minHeight ?? ACTIVITY_MIN_HEIGHT);
  const maxWidth = Math.max(minWidth, Number(limits.maxWidth) || minWidth);
  const maxHeight = Math.max(minHeight, Number(limits.maxHeight) || minHeight);
  const width = Number.isFinite(Number(size?.w)) ? Number(size.w) : minWidth;
  const height = Number.isFinite(Number(size?.h)) ? Number(size.h) : minHeight;
  return {
    height: Math.round(Math.min(maxHeight, Math.max(minHeight, height))),
    width: Math.round(Math.min(maxWidth, Math.max(minWidth, width))),
  };
}
