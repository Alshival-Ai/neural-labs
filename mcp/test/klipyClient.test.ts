import { describe, expect, it, vi } from "vitest";
import { createKlipyClient, klipyMediaUrl } from "../src/klipyClient.js";

const item = { id: "gif-1", title: "Celebration", media_formats: { gif: { url: "https://static.klipy.com/test.gif" }, tinygif: { url: "https://static1.klipy.com/tiny.gif" }, gifpreview: { url: "https://static2.klipy.com/still.png" } } };
describe("terminal KLIPY client", () => {
  it("loads featured and paginated search without filtering and retains still previews", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [item], next: "cursor:2" })));
    const client = createKlipyClient("placeholder-key", fetchFn);
    const page = await client.catalog("");
    const featured = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(featured.pathname).toBe("/v2/featured");
    expect(featured.searchParams.get("contentfilter")).toBe("off");
    expect(page.results[0]?.still).toBe("https://static2.klipy.com/still.png");
    expect(page.next).toBe("cursor:2");
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ results: [item] })));
    await client.catalog("  wow!!  ", "cursor:2");
    const search = new URL(String(fetchFn.mock.calls[1]?.[0]));
    expect(search.pathname).toBe("/v2/search");
    expect(search.searchParams.get("q")).toBe("  wow!!  ");
    expect(search.searchParams.get("pos")).toBe("cursor:2");
  });
  it("rejects untrusted, credential-bearing, and non-HTTPS media URLs", () => {
    const credentialUrl = new URL("https://static.klipy.com/x");
    credentialUrl.username = "placeholder";
    credentialUrl.password = "placeholder";
    expect(klipyMediaUrl(credentialUrl.toString())).toBeUndefined();
    for (const url of ["http://static.klipy.com/x", "https://static.klipy.com.attacker.example/x", "https://static.klipy.com:8443/x", "data:image/gif;base64,x"]) expect(klipyMediaUrl(url)).toBeUndefined();
  });
  it("omits unsafe media and handles empty, unavailable, invalid, and oversized responses", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ ...item, media_formats: { gif: { url: "https://other.example/a.gif" } } }] })));
    const client = createKlipyClient("placeholder-key", fetchFn);
    expect((await client.catalog("x")).results).toEqual([]);
    await expect(createKlipyClient(undefined).catalog("x")).rejects.toThrow("not configured");
    fetchFn.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(client.catalog("x")).rejects.toThrow("HTTP 503");
    fetchFn.mockRejectedValueOnce(new Error("https://api.klipy.com?key=placeholder-key"));
    await expect(client.catalog("x")).rejects.toThrow("could not reach");
    fetchFn.mockResolvedValueOnce(new Response("invalid"));
    await expect(client.catalog("x")).rejects.toThrow("invalid JSON");
    fetchFn.mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(client.catalog("x")).rejects.toThrow("size limit");
  });
  it("registers shares on the server with redirects disabled", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await createKlipyClient("placeholder-key", fetchFn).share("gif-1", "yay");
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v2/registershare");
    expect(url.searchParams.get("id")).toBe("gif-1");
    expect(fetchFn.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
});
