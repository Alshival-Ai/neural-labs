// Bound decode concurrency and retain only small, version-keyed thumbnails.
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const queue: (() => void)[] = [];
let active = 0;
async function permit() {
  if (active < 4) {
    active++;
    return;
  }
  if (queue.length >= 128) throw new Error("Thumbnail queue is full");
  await new Promise<void>((resolve) => queue.push(resolve));
}
export function fileThumbnail(url: string): Promise<string> {
  const saved = cache.get(url);
  if (saved) {
    cache.delete(url);
    cache.set(url, saved);
    return Promise.resolve(saved);
  }
  const existing = pending.get(url);
  if (existing) return existing;
  const result = (async () => {
    await permit();
    let original: string | undefined;
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        signal: AbortSignal.timeout(20000),
      });
      if (
        !response.ok ||
        Number(response.headers.get("content-length")) > 10 * 1024 * 1024
      )
        throw new Error("Thumbnail unavailable");
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024) throw new Error("Thumbnail too large");
      const image = new Image();
      image.src = original = URL.createObjectURL(blob);
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 40000000)
        throw new Error("Thumbnail too large");
      const ratio = Math.min(
        1,
        256 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas
        .getContext("2d")!
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumbnail = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      canvas.width = canvas.height = 1;
      if (!thumbnail) throw new Error("Thumbnail unavailable");
      const output = URL.createObjectURL(thumbnail);
      cache.set(url, output);
      while (cache.size > 64) {
        const oldest = cache.keys().next().value!;
        URL.revokeObjectURL(cache.get(oldest)!);
        cache.delete(oldest);
      }
      return output;
    } finally {
      if (original) URL.revokeObjectURL(original);
      pending.delete(url);
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  })();
  pending.set(url, result);
  void result.catch(() => pending.delete(url));
  return result;
}
