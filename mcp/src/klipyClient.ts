const KLIPY_API_URL = "https://api.klipy.com/v2/search";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function cleanText(value: unknown): string | undefined {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function safeHttps(value: unknown): string | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function requestKlipy(
  apiKey: string,
  query: string,
  fetchFn: typeof globalThis.fetch,
  catalog?: { pos?: string },
): Promise<JsonObject> {
  const url = new URL(catalog && !query ? "https://api.klipy.com/v2/featured" : KLIPY_API_URL);
  url.search = new URLSearchParams({
    q: query,
    media_filter: "gif",
    key: apiKey,
    client_key: "neural-labs-workspace",
    limit: "20",
  }).toString();
  if (catalog) {
    url.searchParams.set("contentfilter", "off");
    url.searchParams.set("media_filter", "gif,tinygif,gifpreview");
    if (catalog.pos) url.searchParams.set("pos", catalog.pos);
  }
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("KLIPY GIF search could not reach the provider");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error("KLIPY GIF search failed with HTTP " + response.status);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("KLIPY GIF search exceeded the response size limit");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("KLIPY returned an empty response");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("KLIPY GIF search exceeded the response size limit");
      chunks.push(value);
    }
  } catch {
    throw new Error(size > MAX_RESPONSE_BYTES ? "KLIPY GIF search exceeded the response size limit" : "KLIPY GIF search response was interrupted");
  } finally { await reader.cancel().catch(() => {}); }
  const raw = Buffer.concat(chunks);
  if (raw.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("KLIPY GIF search exceeded the response size limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("KLIPY GIF search returned invalid JSON");
  }
  const payload = record(parsed);
  if (!payload) throw new Error("KLIPY GIF search returned an unexpected response");
  return payload;
}

export function extractResults(payload: JsonObject, limit: number): JsonObject[] {
  if (!Array.isArray(payload.results)) return [];
  const results: JsonObject[] = [];
  for (const raw of payload.results) {
    const item = record(raw);
    const formats = record(item?.media_formats);
    if (!item || !formats) continue;
    let url: string | undefined;
    for (const name of ["gif", "mediumgif", "tinygif"]) {
      url = safeHttps(record(formats[name])?.url);
      if (url) break;
    }
    if (!url) continue;
    results.push({
      id: cleanText(item.id) ?? null,
      title:
        cleanText(item.content_description) ?? cleanText(item.title) ?? null,
      url,
    });
    if (results.length >= limit) break;
  }
  return results;
}


const MEDIA_HOSTS = new Set(["static.klipy.com", "static1.klipy.com", "static2.klipy.com"]);
export function klipyMediaUrl(value: unknown): string | undefined {
  const url = safeHttps(value);
  return url && MEDIA_HOSTS.has(new URL(url).hostname) ? url : undefined;
}

export function createKlipyClient(apiKey: string | undefined, fetchFn = globalThis.fetch) {
  apiKey = apiKey?.trim();
  return {
    configured: Boolean(apiKey),
    async catalog(query: string, pos = "") {
      if (!apiKey) throw new Error("GIF search is unavailable: KLIPY is not configured");
      const payload = await requestKlipy(apiKey, query, fetchFn, { pos });
      const results = [];
      for (const raw of Array.isArray(payload.results) ? payload.results : []) {
        const item = record(raw);
        const formats = record(item?.media_formats);
        const id = cleanText(item?.id);
        const url = klipyMediaUrl(record(formats?.gif)?.url);
        if (!id || !url) continue;
        results.push({ id, title: cleanText(item?.content_description) ?? cleanText(item?.title) ?? "GIF reaction", url,
          preview: klipyMediaUrl(record(formats?.tinygif)?.url) ?? url,
          still: klipyMediaUrl(record(formats?.gifpreview)?.url) ?? klipyMediaUrl(record(formats?.gif)?.preview) ?? null });
      }
      return { results, next: typeof payload.next === "string" ? payload.next : "" };
    },
    async share(id: string, query: string) {
      if (!apiKey) return;
      const url = new URL("https://api.klipy.com/v2/registershare");
      url.search = new URLSearchParams({ key: apiKey, id, q: query, client_key: "neural-labs-workspace" }).toString();
      const response = await fetchFn(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
      await response.body?.cancel();
    },
  };
}
