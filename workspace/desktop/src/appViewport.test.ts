import { describe, expect, it } from "vitest";

import { appViewportForWidth } from "./appViewport";

describe("app viewport", () => {
  it.each([
    [360, "mobile"],
    [760, "mobile"],
    [761, "tablet"],
    [900, "tablet"],
    [901, "desktop"],
    [1440, "desktop"],
  ] as const)("classifies %ipx as %s", (width, mode) => {
    expect(appViewportForWidth(width).mode).toBe(mode);
  });

  it("treats invalid measurements as desktop until a real size is available", () => {
    expect(appViewportForWidth(Number.NaN).mode).toBe("desktop");
  });
});
