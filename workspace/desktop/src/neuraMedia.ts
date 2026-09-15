import type { NeuraAttachment } from "./types";

export function workspacePathFromMessageReference(reference: string | undefined): string | undefined {
  if (!reference || reference.startsWith("#")) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0]); }
  catch { return undefined; }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return undefined;
  const prefix = "/home/node/workspace/";
  const candidate = (decoded.startsWith(prefix) ? decoded.slice(prefix.length) : decoded).replace(/^\.\//, "");
  if (!candidate || candidate.startsWith("/") || candidate.includes(":")) return undefined;
  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return undefined;
  if (!/\.[A-Za-z0-9]{1,12}$/.test(segments.at(-1) ?? "")) return undefined;
  return candidate;
}

const mediaTypes: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  pdf: "application/pdf",
};

// Only explicit assistant MEDIA lines become attachments. Examples inside code
// fences and references outside the shared workspace remain ordinary text.
export function projectGeneratedMedia(text: string, existing: NeuraAttachment[] = []) {
  const attachments = [...existing];
  let fence: { character: string; length: number } | undefined;
  const lines = text.split("\n").filter((line) => {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (boundary) {
      if (!fence) fence = { character: boundary[1][0], length: boundary[1].length };
      else if (boundary[1][0] === fence.character && boundary[1].length >= fence.length && !boundary[2].trim()) fence = undefined;
      return true;
    }
    if (fence) return true;
    const marker = /^ {0,3}MEDIA:\s*(.+?)\s*$/.exec(line);
    if (!marker) return true;
    const reference = marker[1].replace(/^(["'`])(.*)\1$/, "$2");
    const path = workspacePathFromMessageReference(reference);
    if (!path) return true;
    if (!attachments.some((attachment) => workspacePathFromMessageReference(attachment.path) === path)) {
      const name = path.split("/").at(-1)!;
      attachments.push({ name, path, type: mediaTypes[name.split(".").at(-1)!.toLowerCase()] ?? "application/octet-stream" });
    }
    return false;
  });
  return { text: lines.join("\n").trim(), attachments };
}
