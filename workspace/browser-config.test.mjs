import assert from "node:assert/strict";
import test from "node:test";

import {
  browserConfigurationOperations,
  managedBrowserExecutable,
} from "./browser-config.mjs";

function valuesByPath() {
  return new Map(browserConfigurationOperations().map(({ path, value }) => [path, value]));
}

test("enables OpenClaw's isolated managed browser for agent QA", () => {
  const values = valuesByPath();
  assert.equal(values.get("browser.enabled"), true);
  assert.equal(values.get("browser.defaultProfile"), "openclaw");
  assert.equal(values.get("browser.headless"), true);
  assert.equal(values.get("browser.noSandbox"), true);
  assert.equal(values.get("browser.executablePath"), managedBrowserExecutable);
  assert.equal(values.get("plugins.entries.browser.enabled"), true);
  assert.deepEqual(values.get("tools.alsoAllow"), ["browser"]);
});

test("allows only workspace-local QA destinations through the private-network guard", () => {
  const values = valuesByPath();
  assert.deepEqual(
    values.get("browser.ssrfPolicy.allowedHostnames"),
    ["localhost", "127.0.0.1"],
  );
  assert.equal(values.has("browser.ssrfPolicy.dangerouslyAllowPrivateNetwork"), false);
});
