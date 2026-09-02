import type { CSSProperties } from "react";

export const DESKTOP_FONT_SCALE_MIN = 90;
export const DESKTOP_FONT_SCALE_MAX = 150;
export const DESKTOP_FONT_SCALE_STEP = 10;
export const DESKTOP_FONT_SCALE_DEFAULT = 100;

const FONT_BASELINES = {
  caption: 11,
  small: 12,
  body: 13,
  control: 14,
  subheading: 16,
  heading: 18,
  title: 20,
  displaySm: 24,
  display: 28,
  displayLg: 32,
  hero: 36,
} as const;

export function normalizeDesktopFontScale(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return DESKTOP_FONT_SCALE_DEFAULT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DESKTOP_FONT_SCALE_DEFAULT;
  const snapped = Math.round(parsed / DESKTOP_FONT_SCALE_STEP) * DESKTOP_FONT_SCALE_STEP;
  return Math.min(DESKTOP_FONT_SCALE_MAX, Math.max(DESKTOP_FONT_SCALE_MIN, snapped));
}

export function desktopTypographyStyle(value: unknown): CSSProperties {
  const scale = normalizeDesktopFontScale(value) / 100;
  const pixels = (baseline: number) => `${Number((baseline * scale).toFixed(2))}px`;
  return {
    "--desktop-font-caption": pixels(FONT_BASELINES.caption),
    "--desktop-font-small": pixels(FONT_BASELINES.small),
    "--desktop-font-body": pixels(FONT_BASELINES.body),
    "--desktop-font-control": pixels(FONT_BASELINES.control),
    "--desktop-font-subheading": pixels(FONT_BASELINES.subheading),
    "--desktop-font-heading": pixels(FONT_BASELINES.heading),
    "--desktop-font-title": pixels(FONT_BASELINES.title),
    "--desktop-font-display-sm": pixels(FONT_BASELINES.displaySm),
    "--desktop-font-display": pixels(FONT_BASELINES.display),
    "--desktop-font-display-lg": pixels(FONT_BASELINES.displayLg),
    "--desktop-font-hero": pixels(FONT_BASELINES.hero),
  } as CSSProperties;
}
