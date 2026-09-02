import { describe, expect, it } from "vitest";

import {
  DESKTOP_FONT_SCALE_DEFAULT,
  desktopTypographyStyle,
  normalizeDesktopFontScale,
} from "./fontScale";

describe("desktop font scale", () => {
  it("defaults, snaps, and clamps stored values", () => {
    expect(normalizeDesktopFontScale(undefined)).toBe(DESKTOP_FONT_SCALE_DEFAULT);
    expect(normalizeDesktopFontScale(null)).toBe(DESKTOP_FONT_SCALE_DEFAULT);
    expect(normalizeDesktopFontScale(false)).toBe(DESKTOP_FONT_SCALE_DEFAULT);
    expect(normalizeDesktopFontScale("124")).toBe(120);
    expect(normalizeDesktopFontScale(20)).toBe(90);
    expect(normalizeDesktopFontScale(999)).toBe(150);
  });

  it("produces semantic text variables without changing layout units", () => {
    const normal = desktopTypographyStyle(100) as Record<string, string>;
    const large = desktopTypographyStyle(150) as Record<string, string>;
    expect(normal["--desktop-font-caption"]).toBe("11px");
    expect(normal["--desktop-font-body"]).toBe("13px");
    expect(normal["--desktop-font-hero"]).toBe("36px");
    expect(large["--desktop-font-body"]).toBe("19.5px");
    expect(large["--desktop-font-title"]).toBe("30px");
  });
});
