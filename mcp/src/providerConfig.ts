import { createHmac } from "node:crypto";

export interface ProviderConfig {
  googleApiKey?: string;
  klipyApiKey?: string;
  pexelsApiKey?: string;
  projectsRoot: string;
  downloadSigningKey: Buffer;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

export function loadProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfig {
  const workspaceToken = optional(env, "NEURAL_LABS_WORKSPACE_CONTROL_TOKEN");
  if (!workspaceToken || workspaceToken.length < 32) {
    throw new Error(
      "NEURAL_LABS_WORKSPACE_CONTROL_TOKEN must contain at least 32 characters",
    );
  }
  const projectsRoot =
    optional(env, "NEURAL_LABS_PROJECTS_ROOT") ??
    "/home/node/workspace/projects";
  if (!projectsRoot.startsWith("/")) {
    throw new Error("NEURAL_LABS_PROJECTS_ROOT must be absolute");
  }
  const googleApiKey = optional(env, "GOOGLE_PLACES_API_KEY");
  const klipyApiKey = optional(env, "KLIPY_API_KEY");
  const pexelsApiKey = optional(env, "PEXELS_API_KEY");
  return {
    ...(googleApiKey ? { googleApiKey } : {}),
    ...(klipyApiKey ? { klipyApiKey } : {}),
    ...(pexelsApiKey ? { pexelsApiKey } : {}),
    projectsRoot,
    downloadSigningKey: createHmac(
      "sha256",
      Buffer.from(workspaceToken, "utf8"),
    )
      .update("neural-labs/pexels-download-token/v1")
      .digest(),
  };
}
