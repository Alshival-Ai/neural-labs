import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./openclaw", () => ({
  NeuraGateway: class {
    start() {}
    setAgentId() {}
  },
}));

vi.mock("./TerminalApp", () => ({
  TerminalApp: () => <div data-testid="terminal-live-view">Live terminal view</div>,
}));

vi.mock("./NeuraApp", () => ({
  NeuraApp: () => <div data-testid="neura-live-view">Live Neura view</div>,
}));

vi.mock("./SkillsLiveApp", () => ({
  SkillsLiveApp: ({ initialSection }: { initialSection?: string }) => <div data-testid="skills-live-view">Skills section: {initialSection}</div>,
}));

import { App } from "./App";
import { deviceStateKey } from "./deviceState";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function session(role: "admin" | "user") {
  return {
    authenticated: true,
    csrfToken: "csrf-token",
    providers: ["local"],
    neura: { agentId: `nl-${role}id` },
    user: { id: `${role}-id`, email: `${role}@example.org`, displayName: role, role, status: "active" },
  };
}

function renderDesktop(role: "admin" | "user") {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/session") return json(session(role));
    if (url === "/api/workspace") return json({ status: "ready" });
    if (url === "/api/auth/providers") return json({ local: { enabled: true }, microsoft: { available: true, enabled: true } });
    if (url === "/api/admin/overview") return json({
      counts: { pending: 0, active: 1, activeAdmins: 1, inactive: 0 },
      authentication: { localEnabled: true, microsoftEnabled: true, microsoftAvailable: true, microsoftSource: "environment" },
      mcp: {
        ready: true,
        mode: "workspace-local",
        endpoint: "http://127.0.0.1:8792/mcp",
        transport: "streamable-http",
        agentServerName: "neural-labs-tools",
        agentScope: "shared-workspace",
        publicAccess: false,
        providers: { googlePlaces: true, googleGeocoding: true, klipy: true, pexels: true },
        tools: ["search_gif"],
      },
      workspace: { status: "ready", openclawVersion: "2026.8.2", codexVersion: "0.152.0", openclawModelReady: true },
      recentAudit: [],
    });
    if (url.startsWith("/workspace/api/files/text?") && method === "GET") {
      return json({
        item: { name: "notes.md", path: "notes.md", type: "file", size: 13, modifiedAt: "2026-09-01T12:05:00.000Z", mimeType: "text/markdown" },
        content: "# Team notes\n",
        version: "a".repeat(43),
      });
    }
    if (url.startsWith("/workspace/api/files/text?") && method === "PUT") {
      return json({
        item: { name: "notes.md", path: "notes.md", type: "file", size: 21, modifiedAt: "2026-09-01T12:06:00.000Z", mimeType: "text/markdown" },
        content: String(init?.body),
        version: "b".repeat(43),
      });
    }
    if (url.startsWith("/workspace/api/files?") && method === "GET") {
      return json({ path: "", parent: null, entries: [
        { name: "notes.md", path: "notes.md", type: "file", size: 13, modifiedAt: "2026-09-01T12:05:00.000Z", mimeType: "text/markdown" },
        { name: "photo.png", path: "photo.png", type: "file", size: 8, modifiedAt: "2026-09-01T12:06:00.000Z", mimeType: "image/png" },
      ] });
    }
    return json({});
  });
  return render(<App />);
}

function createPopupWindow() {
  const popupDocument = document.implementation.createHTMLDocument("Neural Labs pop-out");
  const events = new EventTarget();
  let closed = false;
  const focus = vi.fn();
  const close = vi.fn(() => { closed = true; });
  const popup = {
    document: popupDocument,
    innerWidth: 1024,
    innerHeight: 768,
    focus,
    close,
    get closed() { return closed; },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as unknown as Window;
  return {
    popup,
    popupDocument,
    focus,
    close,
    closeFromBrowser() {
      closed = true;
      events.dispatchEvent(new Event("beforeunload"));
    },
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("desktop admin navigation", () => {
  it("recovers the shared workspace badge after a temporary deployment outage", async () => {
    let workspaceRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/session") return json(session("user"));
      if (url === "/api/workspace") {
        workspaceRequests += 1;
        if (workspaceRequests === 1) throw new Error("workspace restarting");
        return json({ status: "ready" });
      }
      return json({});
    });

    render(<App />);
    expect(await screen.findByText("offline")).toBeInTheDocument();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("Workspace ready")).toBeInTheDocument();
  });

  it("uses one browser-selected responsive wallpaper without speculative preloads", async () => {
    const view = renderDesktop("user");
    await screen.findByText("Workspace ready");
    const picture = view.container.querySelector("picture.desktop-wallpaper");
    expect(picture).toBeInTheDocument();
    expect(picture?.querySelectorAll("source")).toHaveLength(2);
    expect(picture?.querySelector('img[fetchpriority="high"]')).toHaveAttribute("src", "/workspace/assets/wallpaper.png");
  });

  it("opens Terminal as the active app on startup", async () => {
    renderDesktop("user");
    const terminalWindow = await screen.findByLabelText("Terminal application");

    expect(terminalWindow).not.toHaveAttribute("hidden");
    expect(await within(terminalWindow).findByTestId("terminal-live-view")).toBeInTheDocument();
  });

  it("does not reopen Terminal when the saved desktop has no Terminal window", async () => {
    localStorage.setItem(deviceStateKey("user-id", "desktop"), JSON.stringify({
      windows: [{ id: "files-saved", app: "files", visibility: "open", order: 1 }],
      editorPaths: [],
    }));

    renderDesktop("user");

    expect(await screen.findByLabelText("Files application")).toBeInTheDocument();
    expect(screen.queryByLabelText("Terminal application")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminal" })).not.toHaveClass("is-active");
  });

  it("moves a live app into a browser window and pops the same view back into the desktop", async () => {
    const external = createPopupWindow();
    const open = vi.spyOn(window, "open").mockReturnValue(external.popup);
    renderDesktop("user");
    const terminalWindow = await screen.findByLabelText("Terminal application");
    const liveView = await within(terminalWindow).findByTestId("terminal-live-view");

    fireEvent.click(within(terminalWindow).getByRole("button", { name: "Pop out Terminal" }));

    await waitFor(() => expect(external.popupDocument.body.querySelector('[aria-label="Terminal application"]')).toBeTruthy());
    expect(open).toHaveBeenCalledWith("about:blank", expect.stringMatching(/^neural-labs-terminal-/), expect.stringContaining("popup=yes"));
    expect(external.popupDocument.title).toBe("Terminal — Neural Labs");
    expect(external.popupDocument.body.querySelector('[data-testid="terminal-live-view"]')).toBe(liveView);
    expect(document.body.contains(liveView)).toBe(false);

    const popInButton = external.popupDocument.body.querySelector<HTMLButtonElement>('[aria-label="Pop Terminal back into desktop"]');
    expect(popInButton).toBeTruthy();
    popInButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const restored = await screen.findByLabelText("Terminal application");
    await waitFor(() => expect(within(restored).getByTestId("terminal-live-view")).toBe(liveView));
    await waitFor(() => expect(external.close).toHaveBeenCalledOnce());
  });

  it("returns a popped app to the desktop when its browser window is closed", async () => {
    const external = createPopupWindow();
    vi.spyOn(window, "open").mockReturnValue(external.popup);
    renderDesktop("user");
    const terminalWindow = await screen.findByLabelText("Terminal application");
    const liveView = within(terminalWindow).getByTestId("terminal-live-view");
    fireEvent.click(within(terminalWindow).getByRole("button", { name: "Pop out Terminal" }));
    await waitFor(() => expect(document.body.contains(liveView)).toBe(false));

    external.closeFromBrowser();

    const restored = await screen.findByLabelText("Terminal application");
    await waitFor(() => expect(within(restored).getByTestId("terminal-live-view")).toBe(liveView));
  });

  it("brings a pop-out back from the app dock menu", async () => {
    const external = createPopupWindow();
    vi.spyOn(window, "open").mockReturnValue(external.popup);
    renderDesktop("user");
    const terminalWindow = await screen.findByLabelText("Terminal application");
    fireEvent.click(within(terminalWindow).getByRole("button", { name: "Pop out Terminal" }));
    await waitFor(() => expect(screen.queryByLabelText("Terminal application")).not.toBeInTheDocument());

    fireEvent.contextMenu(screen.getByRole("button", { name: "Terminal" }), { clientX: 200, clientY: 700 });
    const menu = screen.getByRole("menu", { name: "terminal actions" });
    expect(within(menu).getByText("1 popped out")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Bring pop-out back" }));

    expect(await screen.findByLabelText("Terminal application")).toBeInTheDocument();
    await waitFor(() => expect(external.close).toHaveBeenCalledOnce());
  });

  it("explains how to recover when the browser blocks a pop-out", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    renderDesktop("user");
    const terminalWindow = await screen.findByLabelText("Terminal application");

    fireEvent.click(within(terminalWindow).getByRole("button", { name: "Pop out Terminal" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Allow pop-ups for Neural Labs");
    expect(terminalWindow).toBeInTheDocument();
  });

  it("opens embedded VS Code from the dock and keeps its live frame mounted while minimized", async () => {
    renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "VS Code" }));

    const vsCodeWindow = await screen.findByLabelText("VS Code application");
    const frame = await within(vsCodeWindow).findByTitle("VS Code workspace");
    expect(frame).toHaveAttribute("src", "/workspace/vscode/?folder=%2Fhome%2Fnode%2Fworkspace");
    expect(within(vsCodeWindow).getByRole("link", { name: "Open VS Code in a new tab" })).toHaveAttribute("target", "_blank");

    fireEvent.click(screen.getByRole("button", { name: "Minimize VS Code" }));
    expect(vsCodeWindow).toHaveAttribute("hidden");
    expect(frame).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "VS Code" }));
    expect(vsCodeWindow).not.toHaveAttribute("hidden");
    expect(within(vsCodeWindow).getByTitle("VS Code workspace")).toBe(frame);
  });

  it("opens administrator and personal settings from the shared Settings cog", async () => {
    renderDesktop("admin");
    const settingsButton = await screen.findByRole("button", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "AD" }));
    expect(screen.queryByRole("button", { name: "User Settings" })).not.toBeInTheDocument();
    fireEvent.click(settingsButton);
    const settingsWindow = await screen.findByLabelText("Settings application");
    expect(within(settingsWindow).getByRole("button", { name: "Minimize Settings" })).toBeInTheDocument();
    expect(within(settingsWindow).getByRole("button", { name: "Maximize Settings" })).toBeInTheDocument();
    fireEvent.click(await within(settingsWindow).findByRole("button", { name: /^Personalization/ }));
    expect((await within(settingsWindow).findAllByText("admin@example.org")).length).toBeGreaterThan(0);
    expect(within(settingsWindow).getByRole("button", { name: /^Overview/ })).toBeInTheDocument();
  });

  it("opens a Personalization-only Settings app for regular users", async () => {
    renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const settingsWindow = await screen.findByLabelText("Settings application");
    expect(await within(settingsWindow).findByRole("heading", { name: "Personalization" })).toBeInTheDocument();
    expect(within(settingsWindow).queryByRole("button", { name: /^Overview/ })).not.toBeInTheDocument();
    expect(within(settingsWindow).queryByRole("button", { name: /^Users/ })).not.toBeInTheDocument();
  });

  it("restores and persists the per-user desktop font size", async () => {
    localStorage.setItem(deviceStateKey("user-id", "appearance"), JSON.stringify({ fontScale: 140 }));
    const view = renderDesktop("user");
    await screen.findByText("Workspace ready");
    await waitFor(() => expect(view.container.querySelector<HTMLElement>(".desktop")?.style.getPropertyValue("--desktop-font-body")).toBe("18.2px"));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Reset font size to 100%" })).toHaveTextContent("140%");
    fireEvent.click(screen.getByRole("button", { name: "Increase font size" }));

    await waitFor(() => expect(JSON.parse(localStorage.getItem(deviceStateKey("user-id", "appearance")) ?? "{}")).toEqual({ fontScale: 150 }));
    expect(view.container.querySelector<HTMLElement>(".desktop")?.style.getPropertyValue("--desktop-font-title")).toBe("30px");
  });

  it("opens Settings Personalization after an account or identity-link redirect", async () => {
    window.history.pushState({}, "", "/workspace?settings=personalization&success=Microsoft+identity+linked");
    renderDesktop("user");

    const settingsWindow = await screen.findByLabelText("Settings application");
    expect(await within(settingsWindow).findByRole("heading", { name: "Personalization" })).toBeInTheDocument();
    expect(await within(settingsWindow).findByText("Microsoft identity linked")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("exposes Settings and read-only Automations to regular users", async () => {
    renderDesktop("user");
    expect(await screen.findByText("Workspace ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Automations" })).toBeInTheDocument();
  });

  it("routes the Automations dock icon into the canonical Skills window", async () => {
    renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Automations" }));
    const skillsWindow = await screen.findByLabelText("Skills application");
    expect(await within(skillsWindow).findByTestId("skills-live-view")).toHaveTextContent("Skills section: automations");
    expect(screen.queryByLabelText("Automations application")).not.toBeInTheDocument();
  });

  it("opens and saves a shared file through Files and the Editor window", async () => {
    renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    const browser = await screen.findByRole("region", { name: "All files" });
    const notes = await within(browser).findByRole("button", { name: /notes\.md/i });
    fireEvent.doubleClick(notes);

    const editor = await screen.findByRole("textbox", { name: "Code editor for notes.md" }, { timeout: 4_000 });
    fireEvent.change(editor, { target: { value: "# Team notes\n\nUpdated together.\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Minimize Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(await screen.findByRole("textbox", { name: "Code editor for notes.md" })).toHaveValue("# Team notes\n\nUpdated together.\n");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/workspace/api/files/text?path=notes.md&version="),
      expect.objectContaining({ method: "PUT", body: "# Team notes\n\nUpdated together.\n" }),
    ));
    expect((await screen.findAllByText("notes.md saved to the shared workspace.")).length).toBeGreaterThan(0);
  });

  it("opens a common binary file in a dedicated desktop preview window", async () => {
    renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    const browser = await screen.findByRole("region", { name: "All files" });
    fireEvent.doubleClick(await within(browser).findByRole("button", { name: /photo\.png/i }));

    const preview = await screen.findByLabelText("Preview — photo.png application");
    expect(await within(preview).findByRole("img", { name: "photo.png" })).toHaveAttribute("src", "/workspace/api/files/content?path=photo.png");
    expect(screen.queryByRole("textbox", { name: /photo\.png/i })).not.toBeInTheDocument();
  });

  it("raises clicked windows, toggles dock minimization, and manages multiple windows", async () => {
    renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));

    const filesWindow = await screen.findByLabelText("Files application");
    const editorWindow = await screen.findByLabelText("Editor application");
    expect(Number(editorWindow.style.zIndex)).toBeGreaterThan(Number(filesWindow.style.zIndex));

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    await waitFor(() => expect(Number(filesWindow.style.zIndex)).toBeGreaterThan(Number(editorWindow.style.zIndex)));
    expect(filesWindow).toBeInTheDocument();

    fireEvent.pointerDown(editorWindow);
    await waitFor(() => expect(Number(editorWindow.style.zIndex)).toBeGreaterThan(Number(filesWindow.style.zIndex)));
    fireEvent.pointerDown(filesWindow);
    await waitFor(() => expect(Number(filesWindow.style.zIndex)).toBeGreaterThan(Number(editorWindow.style.zIndex)));

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.queryByLabelText("Files application")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(await screen.findByLabelText("Files application")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Files" }), { clientX: 200, clientY: 700 });
    let menu = screen.getByRole("menu", { name: "files actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New window" }));
    await waitFor(() => expect(screen.getAllByLabelText("Files application")).toHaveLength(2));

    fireEvent.contextMenu(screen.getByRole("button", { name: "Files" }), { clientX: 200, clientY: 700 });
    menu = screen.getByRole("menu", { name: "files actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close all windows" }));
    expect(screen.queryByLabelText("Files application")).not.toBeInTheDocument();
  });

  it("keeps a live terminal view mounted while its window is minimized", async () => {
    renderDesktop("user");
    const terminalWindow = await screen.findByLabelText("Terminal application");
    const liveView = await screen.findByTestId("terminal-live-view");
    fireEvent.click(screen.getByRole("button", { name: "Minimize Terminal" }));

    expect(terminalWindow).toHaveAttribute("hidden");
    expect(liveView).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    expect(terminalWindow).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("terminal-live-view")).toBe(liveView);
  });

  it("keeps the live Neura transcript mounted while its window is minimized", async () => {
    renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Neura" }));
    const neuraWindow = await screen.findByLabelText("Neura application");
    const liveView = await within(neuraWindow).findByTestId("neura-live-view");

    fireEvent.click(within(neuraWindow).getByRole("button", { name: "Minimize Neura" }));
    expect(neuraWindow).toHaveAttribute("hidden");
    expect(liveView).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Neura" }));
    expect(neuraWindow).not.toHaveAttribute("hidden");
    expect(within(neuraWindow).getByTestId("neura-live-view")).toBe(liveView);
  });

  it("turns an active maximized window into edge-to-edge focus mode", async () => {
    const view = renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    const filesWindow = await screen.findByLabelText("Files application");

    fireEvent.click(screen.getByRole("button", { name: "Maximize Files" }));
    await waitFor(() => expect(view.container.querySelector(".desktop")).toHaveClass("has-maximized-window"));
    expect(filesWindow).toHaveClass("is-maximized");
    expect(filesWindow.style.left).toBe("0px");
    expect(filesWindow.style.top).toBe("0px");
    expect(filesWindow.style.width).toBe("100vw");
    expect(filesWindow.style.height).toBe("100dvh");
    expect(view.container.querySelectorAll(".shell-reveal-zone")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    await screen.findByLabelText("Editor application");
    await waitFor(() => expect(view.container.querySelector(".desktop")).not.toHaveClass("has-maximized-window"));

    fireEvent.pointerDown(filesWindow);
    await waitFor(() => expect(view.container.querySelector(".desktop")).toHaveClass("has-maximized-window"));
    fireEvent.click(screen.getByRole("button", { name: "Restore Files" }));
    await waitFor(() => expect(view.container.querySelector(".desktop")).not.toHaveClass("has-maximized-window"));
  });

  it("restores per-user desktop visibility after a fresh mount", async () => {
    const first = renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(await screen.findByLabelText("Files application")).toBeInTheDocument();
    expect(screen.queryByLabelText("Editor application")).not.toBeInTheDocument();

    first.unmount();
    render(<App />);
    expect(await screen.findByLabelText("Files application")).toBeInTheDocument();
    expect(screen.queryByLabelText("Editor application")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(await screen.findByLabelText("Editor application")).toBeInTheDocument();
  });

  it("restores Editor file paths by refetching content instead of caching file bodies", async () => {
    const first = renderDesktop("user");
    await screen.findByText("Workspace ready");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    const browser = await screen.findByRole("region", { name: "All files" });
    fireEvent.doubleClick(await within(browser).findByRole("button", { name: /notes\.md/i }));
    expect(await screen.findByRole("textbox", { name: "Code editor for notes.md" })).toHaveValue("# Team notes\n");
    const stored = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index) ?? "")).join("\n");
    expect(stored).not.toContain("# Team notes");

    first.unmount();
    render(<App />);
    expect(await screen.findByRole("textbox", { name: "Code editor for notes.md" })).toHaveValue("# Team notes\n");
  });
});
