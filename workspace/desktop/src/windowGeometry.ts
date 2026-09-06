export type Bounds = { x: number; y: number; width: number; height: number };
export type ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export type WindowPlacement = "freeform" | "left" | "right" | "maximized";
export type SnapTarget = Exclude<WindowPlacement, "freeform">;
export const MIN_WINDOW_WIDTH = 360;
export const MIN_WINDOW_HEIGHT = 440;

export function initialBounds(viewportWidth: number, viewportHeight: number, top = 0): Bounds {
  const width = Math.min(1120, viewportWidth - 104);
  const height = Math.min(760, viewportHeight - 164);
  return clampBounds({ x: Math.round((viewportWidth - width) / 2), y: Math.round((viewportHeight - height) / 2) - 8, width, height }, viewportWidth, viewportHeight, top);
}

export function clampBounds(bounds: Bounds, viewportWidth: number, viewportHeight: number, top = 0): Bounds {
  const maxWidth = Math.max(1, viewportWidth - 24);
  const maxHeight = Math.max(1, viewportHeight - top - 84);
  const width = Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, bounds.width));
  const height = Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, bounds.height));
  return { width, height,
    x: Math.min(Math.max(12, bounds.x), Math.max(12, viewportWidth - width - 12)),
    y: Math.min(Math.max(top, bounds.y), Math.max(top, viewportHeight - height - 84)),
  };
}

export function snapBounds(target: SnapTarget, width: number, height: number, top = 0): Bounds {
  if (target === "maximized") return { x: 0, y: top, width, height: Math.max(1, height - top) };
  const half = Math.floor(width / 2);
  return { x: target === "left" ? 0 : half, y: top, width: target === "left" ? half : width - half, height: Math.max(1, height - top) };
}

export function snapTarget(x: number, y: number, width: number, height: number, top = 0): SnapTarget | null {
  if (width <= 760 || x < 0 || x > width || y < 0 || y > height) return null;
  if (y <= top + 24) return "maximized";
  if (x <= 24) return "left";
  if (x >= width - 24) return "right";
  return null;
}

export function moveBounds(origin: Bounds, dx: number, dy: number, viewportWidth: number, viewportHeight: number, top = 0): Bounds {
  return clampBounds({ ...origin, x: origin.x + dx, y: origin.y + dy }, viewportWidth, viewportHeight, top);
}

export function resizeBounds(origin: Bounds, edge: ResizeEdge, dx: number, dy: number, viewportWidth: number, viewportHeight: number, top = 0): Bounds {
  let { x, y, width, height } = origin;
  if (edge.includes("e")) width += dx;
  if (edge.includes("s")) height += dy;
  if (edge.includes("w")) { width -= dx; x += dx; }
  if (edge.includes("n")) { height -= dy; y += dy; }
  const minWidth = Math.min(MIN_WINDOW_WIDTH, Math.max(1, viewportWidth - 24));
  const minHeight = Math.min(MIN_WINDOW_HEIGHT, Math.max(1, viewportHeight - top - 84));
  if (width < minWidth) { if (edge.includes("w")) x -= minWidth - width; width = minWidth; }
  if (height < minHeight) { if (edge.includes("n")) y -= minHeight - height; height = minHeight; }
  return clampBounds({ x, y, width, height }, viewportWidth, viewportHeight, top);
}
