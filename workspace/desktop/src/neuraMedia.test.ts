import { describe, expect, it } from "vitest";
import { projectGeneratedMedia } from "./neuraMedia";

describe("generated workspace media", () => {
  it("turns explicit media lines into typed attachments and keeps the caption", () => {
    expect(projectGeneratedMedia('Generated and verified.\n\nMEDIA:/home/node/workspace/projects/cat-video/cat-windowsill.mp4\nMEDIA:"./images/cat photo.png"\nMEDIA:audio/meow.mp3')).toEqual({
      text: "Generated and verified.",
      attachments: [
        { name: "cat-windowsill.mp4", path: "projects/cat-video/cat-windowsill.mp4", type: "video/mp4" },
        { name: "cat photo.png", path: "images/cat photo.png", type: "image/png" },
        { name: "meow.mp3", path: "audio/meow.mp3", type: "audio/mpeg" },
      ],
    });
  });

  it("deduplicates markers against structured workspace attachments", () => {
    const attachment = { path: "clip.mp4", name: "clip.mp4", type: "video/mp4", size: 123 };
    expect(projectGeneratedMedia("MEDIA:/home/node/workspace/clip.mp4\nMEDIA:clip.mp4", [attachment])).toEqual({ text: "", attachments: [attachment] });
  });

  it.each([
    "/home/node/.openclaw/private.mp4", "/home/node/workspace/../private.mp4", "../clip.mp4",
    "https://untrusted.example/clip.mp4", "file:///home/node/workspace/clip.mp4", "//example.com/clip.mp4",
    "folder/%2e%2e/clip.mp4", "folder%5cclip.mp4", "clip%00.mp4", "bad%ZZ.mp4",
  ])("leaves unsupported references as text: %s", (reference) => {
    const text = `MEDIA:${reference}`;
    expect(projectGeneratedMedia(text)).toEqual({ text, attachments: [] });
  });

  it("preserves code examples and ordinary mentions", () => {
    const text = 'Example: MEDIA:clip.mp4\n```text\nMEDIA:clip.mp4\n```\n~~~\nMEDIA:photo.png\n~~~\n`MEDIA:meow.mp3`';
    expect(projectGeneratedMedia(text)).toEqual({ text, attachments: [] });
  });
});
