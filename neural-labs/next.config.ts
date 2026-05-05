import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

const rootEnv = parseEnvFile(path.resolve(process.cwd(), "../.env"));
for (const [key, value] of Object.entries(rootEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const exposedClientEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    key.startsWith("VITE_") || key.startsWith("NEXT_PUBLIC_")
  )
);

const nextConfig: NextConfig = {
  typedRoutes: false,
  env: exposedClientEnv,
  serverExternalPackages: ["@homebridge/node-pty-prebuilt-multiarch"],
};

export default nextConfig;
