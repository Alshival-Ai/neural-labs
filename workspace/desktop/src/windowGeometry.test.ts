import { describe, expect, it } from "vitest";

import { initialBounds, moveBounds, resizeBounds } from "./windowGeometry";

describe("window geometry", () => {
  it("centers a useful first window", () => {
    expect(initialBounds(1440, 1000)).toEqual({ x: 160, y: 112, width: 1120, height: 760 });
  });

  it("keeps a moved window inside the desktop", () => {
    const moved = moveBounds({ x: 100, y: 100, width: 800, height: 600 }, -900, 900, 1200, 900);
    expect(moved.x).toBe(12);
    expect(moved.y).toBe(216);
  });

  it("supports northwest resizing without crossing minimum dimensions", () => {
    const resized = resizeBounds({ x: 200, y: 150, width: 700, height: 500 }, "nw", 500, 200, 1200, 900);
    expect(resized.width).toBe(360);
    expect(resized.height).toBe(440);
    expect(resized.x).toBe(540);
    expect(resized.y).toBe(210);
  });

  it("can reach a compact app layout without collapsing below a usable width", () => {
    const resized = resizeBounds({ x: 100, y: 100, width: 800, height: 600 }, "e", -700, 0, 1440, 1200);
    expect(resized.width).toBe(360);
  });
});
