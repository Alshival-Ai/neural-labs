import { afterEach, describe, expect, it } from "vitest";

import { deviceStateKey, readDeviceState, removeDeviceState, writeDeviceState } from "./deviceState";

afterEach(() => localStorage.clear());

describe("per-device UI state", () => {
  it("namespaces state by immutable user and application area", () => {
    writeDeviceState("user/one", "terminal", { activeId: "shell-1" });
    writeDeviceState("user/two", "terminal", { activeId: "shell-2" });

    expect(readDeviceState("user/one", "terminal")).toEqual({ activeId: "shell-1" });
    expect(readDeviceState("user/two", "terminal")).toEqual({ activeId: "shell-2" });
    expect(deviceStateKey("user/one", "terminal")).not.toBe(deviceStateKey("user/two", "terminal"));
  });

  it("treats corrupt browser state as absent", () => {
    localStorage.setItem(deviceStateKey("user-1", "desktop"), "not-json");
    expect(readDeviceState("user-1", "desktop")).toBeUndefined();
  });

  it("removes state for a closed window without touching another area", () => {
    writeDeviceState("user-1", "files.window-1", { view: "grid" });
    writeDeviceState("user-1", "terminal.window-2", { activeId: "shell-1" });
    removeDeviceState("user-1", "files.window-1");
    expect(readDeviceState("user-1", "files.window-1")).toBeUndefined();
    expect(readDeviceState("user-1", "terminal.window-2")).toEqual({ activeId: "shell-1" });
  });
});
