import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ProviderConfig } from "./providerConfig.js";

export function registerSmsNotificationTool(
  server: McpServer,
  config: ProviderConfig,
  fetchFn: typeof globalThis.fetch,
): void {
  if (!config.notificationApi) return;
  const api = config.notificationApi;
  server.registerTool(
    "notify_workspace_user",
    {
      title: "Notify a workspace user by SMS/MMS",
      description:
        "Send an explicitly requested or automation-related update to one verified Neural Labs member who opted in. Address only by @handle or workspace user ID; arbitrary phone numbers are never accepted.",
      inputSchema: z.object({
        handle: z.string().trim().toLowerCase().regex(/^@?[a-z0-9][a-z0-9._-]{1,31}$/).optional(),
        userId: z.string().uuid().optional(),
        message: z.string().trim().min(1).max(1_600),
        mediaUrls: z.array(z.string().url().startsWith("https://")).max(10).default([]),
      }).refine((value) => Boolean(value.handle) !== Boolean(value.userId), {
        message: "Provide exactly one workspace user handle or user ID",
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ handle, userId, message, mediaUrls }) => {
      const response = await fetchFn(api.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${api.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ...(handle ? { handle: handle.replace(/^@/, "") } : {}),
          ...(userId ? { userId } : {}),
          message,
          mediaUrls,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => ({})) as {
        recipient?: string;
        mediaCount?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Neural Labs could not send the SMS/MMS notification");
      }
      const output = {
        deliveredTo: payload.recipient ?? (handle ? `@${handle.replace(/^@/, "")}` : userId),
        mediaCount: payload.mediaCount ?? mediaUrls.length,
        policy: "verified-workspace-member-with-opt-in",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );
}
