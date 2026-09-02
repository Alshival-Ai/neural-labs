export type Bounds = { x: number; y: number; width: number; height: number };
export type ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const MIN_WINDOW_WIDTH = 640;
export const MIN_WINDOW_HEIGHT = 440;

export function initialBounds(viewportWidth: number, viewportHeight: number): Bounds {
  const width = Math.min(1120, Math.max(MIN_WINDOW_WIDTH, viewportWidth - 104));
  const height = Math.min(760, Math.max(MIN_WINDOW_HEIGHT, viewportHeight - 164));
  return {
    x: Math.max(16, Math.round((viewportWidth - width) / 2)),
    y: Math.max(76, Math.round((viewportHeight - height) / 2) - 8),
    width,
    height,
  };
}

export function clampBounds(bounds: Bounds, viewportWidth: number, viewportHeight: number): Bounds {
  const top = 68;
  const bottom = 84;
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, viewportWidth - 24);
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, viewportHeight - top - bottom);
  const width = Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, bounds.width));
  const height = Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, bounds.height));
  return {
    width,
    height,
    x: Math.min(Math.max(12, bounds.x), Math.max(12, viewportWidth - width - 12)),
    y: Math.min(Math.max(top, bounds.y), Math.max(top, viewportHeight - height - bottom)),
  };
}

export function moveBounds(origin: Bounds, dx: number, dy: number, viewportWidth: number, viewportHeight: number): Bounds {
  return clampBounds({ ...origin, x: origin.x + dx, y: origin.y + dy }, viewportWidth, viewportHeight);
}

export function resizeBounds(
  origin: Bounds,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewportWidth: number,
  viewportHeight: number,
): Bounds {
  let { x, y, width, height } = origin;
  if (edge.includes("e")) width += dx;
  if (edge.includes("s")) height += dy;
  if (edge.includes("w")) {
    width -= dx;
    x += dx;
  }
  if (edge.includes("n")) {
    height -= dy;
    y += dy;
  }
  if (width < MIN_WINDOW_WIDTH) {
    if (edge.includes("w")) x -= MIN_WINDOW_WIDTH - width;
    width = MIN_WINDOW_WIDTH;
  }
  if (height < MIN_WINDOW_HEIGHT) {
    if (edge.includes("n")) y -= MIN_WINDOW_HEIGHT - height;
    height = MIN_WINDOW_HEIGHT;
  }
  return clampBounds({ x, y, width, height }, viewportWidth, viewportHeight);
}
