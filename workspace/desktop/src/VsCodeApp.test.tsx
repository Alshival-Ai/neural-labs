import { describe, expect, it } from "vitest";

import { vsCodeTargetUrl } from "./VsCodeApp";

describe("VS Code target URLs", () => {
  it("opens a validated file in the selected browser workbench", () => {
    const url = new URL(vsCodeTargetUrl({ path: "projects/space & #hash.ts", type: "file" }), "https://neural-labs.example.com");

    expect(url.pathname).toBe("/workspace/vscode/");
    expect(url.searchParams.get("folder")).toBe("/home/node/workspace");
    expect(JSON.parse(url.searchParams.get("payload") ?? "null")).toEqual([
      ["openFile", "file:///home/node/workspace/projects/space%20%26%20%23hash.ts"],
    ]);
  });

  it("opens a validated folder as that browser workbench's workspace", () => {
    const url = new URL(vsCodeTargetUrl({ path: "projects/client site", type: "folder" }), "https://neural-labs.example.com");

    expect(url.pathname).toBe("/workspace/vscode/");
    expect(url.searchParams.get("folder")).toBe("/home/node/workspace/projects/client site");
    expect(url.searchParams.has("payload")).toBe(false);
  });
});
