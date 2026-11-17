export const NORMAL_ROUTE_ANIMATION_FPS = 10;
export const HEAVY_ROUTE_ANIMATION_FPS = 5;
export const HEAVY_ROUTE_COUNT = 175;

export function routeAnimationFps(routeCount) {
  const count = Number(routeCount);
  return Number.isFinite(count) && count >= HEAVY_ROUTE_COUNT
    ? HEAVY_ROUTE_ANIMATION_FPS
    : NORMAL_ROUTE_ANIMATION_FPS;
}
