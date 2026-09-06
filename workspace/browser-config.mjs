export const managedBrowserExecutable = "/usr/bin/chromium";

export function browserConfigurationOperations() {
  return [
    { path: "browser.enabled", value: true },
    { path: "browser.defaultProfile", value: "openclaw" },
    { path: "browser.headless", value: true },
    { path: "browser.noSandbox", value: true },
    { path: "browser.executablePath", value: managedBrowserExecutable },
    {
      // Permit QA against a developer's workspace-local preview without
      // granting the browser access to the wider private network.
      path: "browser.ssrfPolicy.allowedHostnames",
      value: ["localhost", "127.0.0.1"],
    },
    { path: "plugins.entries.browser.enabled", value: true },
    { path: "tools.alsoAllow", value: ["browser"] },
  ];
}
