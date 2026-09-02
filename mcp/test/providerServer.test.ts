import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "../src/providerConfig.js";
import { createProviderApplication } from "../src/providerServer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function responseMessage(response: request.Response): Record<string, unknown> {
  if (response.type === "application/json") {
    return response.body as Record<string, unknown>;
  }
  const data = response.text
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice("data:".length)
    .trim();
  if (!data) throw new Error("MCP response did not contain a JSON or SSE message");
  return JSON.parse(data) as Record<string, unknown>;
}

async function callTool(
  application: ReturnType<typeof createProviderApplication>,
  name: string,
  toolArguments: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request(application.app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set("MCP-Protocol-Version", "2025-11-25")
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: toolArguments },
    })
    .expect(200);
  return responseMessage(response);
}

async function config(): Promise<ProviderConfig> {
  const projectsRoot = await mkdtemp(
    path.join(os.tmpdir(), "neural-labs-provider-test-"),
  );
  temporaryDirectories.push(projectsRoot);
  return {
    googleApiKey: "google-test-secret",
    klipyApiKey: "klipy-test-secret",
    pexelsApiKey: "pexels-test-secret",
    projectsRoot,
    downloadSigningKey: randomBytes(32),
  };
}

describe("workspace provider MCP", () => {
  it("registers the complete configured provider tool set", async () => {
    const application = createProviderApplication(
      await config(),
      vi.fn() as unknown as typeof fetch,
    );
    const response = await request(application.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("MCP-Protocol-Version", "2025-11-25")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);
    const message = responseMessage(response) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(message.result.tools.map((tool) => tool.name).sort()).toEqual([
      "google_geocode_address",
      "google_place_details",
      "google_place_photo",
      "google_places_search",
      "google_reverse_geocode",
      "pexels_download_media",
      "pexels_search_photos",
      "pexels_search_videos",
      "search_gif",
    ]);
    await application.close();
  });

  it("searches KLIPY and returns a bounded safe GIF choice set", async () => {
    const providerConfig = await config();
    const fetchProvider = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("api.klipy.com");
      expect(url.searchParams.get("q")).toBe("excited wave");
      expect(url.searchParams.get("key")).toBe("klipy-test-secret");
      expect(url.searchParams.get("client_key")).toBe("neural-labs-workspace");
      expect(url.searchParams.get("limit")).toBe("20");
      return Response.json({
        results: [
          {
            id: "gif-1",
            content_description: "Excited wave",
            media_formats: { gif: { url: "https://media.klipy.com/wave.gif" } },
          },
          {
            id: "unsafe",
            media_formats: { gif: { url: "http://example.com/unsafe.gif" } },
          },
        ],
      });
    });
    const application = createProviderApplication(
      providerConfig,
      fetchProvider as typeof fetch,
    );
    const search = (await callTool(application, "search_gif", {
      query: "excited wave",
      limit: 1,
    })) as {
      result: {
        structuredContent: {
          count: number;
          results: Array<{ id: string; url: string }>;
        };
      };
    };
    expect(search.result.structuredContent.count).toBe(1);
    expect(search.result.structuredContent.results[0]).toEqual({
      id: "gif-1",
      title: "Excited wave",
      url: "https://media.klipy.com/wave.gif",
    });
    await application.close();
  });

  it("uses bounded Google field masks and normalizes search and geocoding results", async () => {
    const providerConfig = await config();
    const fetchProvider = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === "places.googleapis.com") {
          expect(init?.headers).toMatchObject({
            "X-Goog-Api-Key": "google-test-secret",
          });
          expect(
            (init?.headers as Record<string, string>)["X-Goog-FieldMask"],
          ).toContain("places.displayName");
          return Response.json({
            places: [
              {
                id: "place_1",
                displayName: { text: "Example Bakery" },
                formattedAddress: "100 Main St, Alamo, TX",
                location: { latitude: 26.1, longitude: -98.1 },
              },
            ],
          });
        }
        expect(url.searchParams.get("key")).toBe("google-test-secret");
        return Response.json({
          status: "OK",
          results: [
            {
              formatted_address: "100 Main St, Alamo, TX",
              place_id: "place_1",
              geometry: {
                location: { lat: 26.1, lng: -98.1 },
                location_type: "ROOFTOP",
              },
              types: ["street_address"],
            },
          ],
        });
      },
    );
    const application = createProviderApplication(
      providerConfig,
      fetchProvider as typeof fetch,
    );
    const search = (await callTool(application, "google_places_search", {
      query: "bakery",
      city: "Alamo, TX",
    })) as {
      result: { structuredContent: { results: Array<{ id: string }> } };
    };
    expect(search.result.structuredContent.results[0]?.id).toBe("place_1");
    const geocode = (await callTool(application, "google_geocode_address", {
      address: "100 Main St, Alamo, TX",
    })) as {
      result: {
        structuredContent: {
          results: Array<{ location: { latitude: number } }>;
        };
      };
    };
    expect(
      geocode.result.structuredContent.results[0]?.location.latitude,
    ).toBe(26.1);
    await application.close();
  });

  it("searches Pexels and atomically downloads a signed selection into a project", async () => {
    const providerConfig = await config();
    const projectRoot = path.join(providerConfig.projectsRoot, "example-bakery");
    await mkdir(path.join(projectRoot, "site"), { recursive: true });
    const image = Buffer.from("small-jpeg-test-payload");
    const fetchProvider = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === "api.pexels.com") {
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            "pexels-test-secret",
          );
          return Response.json(
            {
              photos: [
                {
                  id: 42,
                  width: 1200,
                  height: 800,
                  url: "https://www.pexels.com/photo/example-42/",
                  photographer: "A. Creator",
                  photographer_url: "https://www.pexels.com/@creator",
                  src: {
                    large:
                      "https://images.pexels.com/photos/42/example.jpeg?w=940",
                  },
                },
              ],
              total_results: 1,
            },
            {
              headers: {
                "X-Ratelimit-Remaining": "199",
              },
            },
          );
        }
        expect(url.hostname).toBe("images.pexels.com");
        return new Response(image, {
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Length": String(image.byteLength),
          },
        });
      },
    );
    const application = createProviderApplication(
      providerConfig,
      fetchProvider as typeof fetch,
    );
    const search = (await callTool(application, "pexels_search_photos", {
      query: "cinematic bakery",
      limit: 8,
    })) as {
      result: {
        structuredContent: {
          results: Array<{ downloadToken: string }>;
        };
      };
    };
    const downloadToken =
      search.result.structuredContent.results[0]?.downloadToken;
    expect(downloadToken).toBeTruthy();
    const download = (await callTool(application, "pexels_download_media", {
      download_token: downloadToken,
      project_slug: "example-bakery",
      relative_path: "site/assets/conceptual/hero.jpg",
    })) as {
      result: {
        structuredContent: {
          status: string;
          sha256: string;
          provenancePath: string;
        };
      };
    };
    expect(download.result.structuredContent.status).toBe("downloaded");
    expect(
      await readFile(
        path.join(projectRoot, "site", "assets", "conceptual", "hero.jpg"),
      ),
    ).toEqual(image);
    const provenance = JSON.parse(
      await readFile(
        path.join(
          projectRoot,
          download.result.structuredContent.provenancePath,
        ),
        "utf8",
      ),
    ) as { creator: { name: string }; relativePath: string };
    expect(provenance.creator.name).toBe("A. Creator");
    expect(provenance.relativePath).toBe(
      "site/assets/conceptual/hero.jpg",
    );
    await application.close();
  });

  it("rejects tampered tokens, traversal, symlink projects, and overwrites", async () => {
    const providerConfig = await config();
    const projectRoot = path.join(providerConfig.projectsRoot, "safe-project");
    await mkdir(path.join(projectRoot, "site"), { recursive: true });
    const outside = await mkdtemp(path.join(os.tmpdir(), "neural-labs-outside-"));
    temporaryDirectories.push(outside);
    await symlink(outside, path.join(providerConfig.projectsRoot, "linked-project"));
    const image = Buffer.from("path-safety-test");
    const fetchProvider = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "api.pexels.com") {
        return Response.json({
          photos: [{
            id: 77,
            width: 800,
            height: 600,
            url: "https://www.pexels.com/photo/path-safety-77/",
            photographer: "Safe Creator",
            photographer_url: "https://www.pexels.com/@safe-creator",
            src: {
              large: "https://images.pexels.com/photos/77/safe.jpeg",
            },
          }],
          total_results: 1,
        });
      }
      return new Response(image, {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(image.byteLength),
        },
      });
    });
    const application = createProviderApplication(
      providerConfig,
      fetchProvider as typeof fetch,
    );
    const tampered = await callTool(application, "pexels_download_media", {
      download_token: "a".repeat(64),
      project_slug: "safe-project",
      relative_path: "site/assets/file.jpg",
    });
    expect(
      (tampered.result as { isError?: boolean } | undefined)?.isError,
    ).toBe(true);
    const search = (await callTool(application, "pexels_search_photos", {
      query: "path safety",
      limit: 8,
    })) as {
      result: {
        structuredContent: { results: Array<{ downloadToken: string }> };
      };
    };
    const downloadToken =
      search.result.structuredContent.results[0]?.downloadToken;
    expect(downloadToken).toBeTruthy();
    const traversal = await callTool(application, "pexels_download_media", {
      download_token: downloadToken,
      project_slug: "safe-project",
      relative_path: "site/assets/../../outside.jpg",
    });
    expect(
      (traversal.result as { isError?: boolean } | undefined)?.isError,
    ).toBe(true);
    const linked = await callTool(application, "pexels_download_media", {
      download_token: downloadToken,
      project_slug: "linked-project",
      relative_path: "site/assets/file.jpg",
    });
    expect(
      (linked.result as { isError?: boolean } | undefined)?.isError,
    ).toBe(true);
    const first = await callTool(application, "pexels_download_media", {
      download_token: downloadToken,
      project_slug: "safe-project",
      relative_path: "site/assets/file.jpg",
    });
    expect(
      (first.result as { isError?: boolean } | undefined)?.isError,
    ).not.toBe(true);
    const overwrite = await callTool(application, "pexels_download_media", {
      download_token: downloadToken,
      project_slug: "safe-project",
      relative_path: "site/assets/file.jpg",
    });
    expect(
      (overwrite.result as { isError?: boolean } | undefined)?.isError,
    ).toBe(true);
    await application.close();
  });
});
