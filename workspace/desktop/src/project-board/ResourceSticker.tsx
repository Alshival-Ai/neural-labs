import type { Resource } from "./types";
export const stickers = [
  ["auto", "Automatic"], ["website", "Browser"], ["server", "Server rack"],
  ["database", "Database"], ["api", "Connector"], ["repository", "Repository"],
  ["domain", "Globe"], ["storage", "Drive"], ["other", "Label"],
];
export function stickerFor(resource?: Resource | null) {
  const value = resource?.sticker;
  return value && value !== "auto" && stickers.some(([id]) => id === value)
    ? value : resource?.kind || "other";
}
export function StickerPicker({ value = "auto", name = "sticker" }: { value?: string; name?: string }) {
  return <fieldset><legend>Change sticker</legend><div className="resource-sticker-picker">
    {stickers.map(([id, label]) => <label key={id}>
      <input type="radio" name={name} value={id} defaultChecked={value === id} />
      <span className="resource-sticker-preview" data-sticker={id} aria-hidden="true" />
      <span>{label}</span>
    </label>)}
  </div></fieldset>;
}
export function ResourceTags({ tags = [], compact = false }: { tags?: string[]; compact?: boolean }) {
  return <div className="resource-sticker-tags">{(compact ? tags.slice(0, 3) : tags).map(tag => <span key={tag}>{tag}</span>)}
    {compact && tags.length > 3 && <span aria-label="More tags">+{tags.length - 3}</span>}
  </div>;
}
export function parseTags(value: string) {
  return value.split(",").map(tag => tag.trim()).filter(Boolean);
}
