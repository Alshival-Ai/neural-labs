import { describe, expect, it } from "vitest";

import { initialBounds, moveBounds, resizeBounds, snapBounds, snapTarget, clampBounds } from "./windowGeometry";

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


describe("desktop snap geometry", () => {
  it("uses full height and divides odd widths without a gap", () => {
    expect(snapBounds("left", 1281, 420)).toEqual({ x: 0, y: 0, width: 640, height: 420 });
    expect(snapBounds("right", 1281, 420)).toEqual({ x: 640, y: 0, width: 641, height: 420 });
    expect(snapBounds("left", 1000, 800, 76)).toEqual({ x: 0, y: 76, width: 500, height: 724 });
  });
  it("gives the top precedence and disables targets on phones and outside the viewport", () => {
    expect(snapTarget(0, 0, 1280, 900)).toBe("maximized");
    expect(snapTarget(24, 100, 1280, 900)).toBe("left");
    expect(snapTarget(1256, 100, 1280, 900)).toBe("right");
    expect(snapTarget(640, 100, 1280, 900)).toBeNull();
    expect(snapTarget(-1, 100, 1280, 900)).toBeNull();
    expect(snapTarget(0, 0, 760, 900)).toBeNull();
  });
  it("reclaims the top and fits short desktop windows", () => {
    expect(clampBounds({ x: 10, y: -30, width: 600, height: 700 }, 1280, 420)).toEqual({ x: 12, y: 0, width: 600, height: 336 });
    expect(clampBounds({ x: 10, y: -30, width: 600, height: 700 }, 1280, 420, 76).y).toBe(76);
  });
});
