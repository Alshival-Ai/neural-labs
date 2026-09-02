import {
  DESKTOP_FONT_SCALE_DEFAULT,
  DESKTOP_FONT_SCALE_MAX,
  DESKTOP_FONT_SCALE_MIN,
  DESKTOP_FONT_SCALE_STEP,
  normalizeDesktopFontScale,
} from "./fontScale";
import "./font-size-control.css";

type FontSizeControlProps = {
  value: number;
  onChange: (value: number) => void;
  className?: string;
};

export function FontSizeControl({ value, onChange, className = "" }: FontSizeControlProps) {
  const normalized = normalizeDesktopFontScale(value);
  return (
    <div className={`font-size-control${className ? ` ${className}` : ""}`} role="group" aria-label="Font size">
      <button
        type="button"
        aria-label="Decrease font size"
        title="Smaller text"
        disabled={normalized <= DESKTOP_FONT_SCALE_MIN}
        onClick={() => onChange(normalizeDesktopFontScale(normalized - DESKTOP_FONT_SCALE_STEP))}
      >−</button>
      <button
        type="button"
        className="font-size-control__reset"
        aria-label="Reset font size to 100%"
        title="Reset font size"
        onClick={() => onChange(DESKTOP_FONT_SCALE_DEFAULT)}
      >{normalized}%</button>
      <button
        type="button"
        aria-label="Increase font size"
        title="Larger text"
        disabled={normalized >= DESKTOP_FONT_SCALE_MAX}
        onClick={() => onChange(normalizeDesktopFontScale(normalized + DESKTOP_FONT_SCALE_STEP))}
      >+</button>
    </div>
  );
}
