import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/workspace/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    // Bound test-worker memory on development hosts, including 8GB ARM64.
    maxWorkers: 4,
    setupFiles: ["./src/test/setup.ts"],
  },
});
