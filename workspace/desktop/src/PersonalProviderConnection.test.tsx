import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalProviderConnection } from "./PersonalProviderConnection";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("recovers from an initial status failure and lets a member start device-code sign-in", async () => {
  let unavailable = true;
  let connecting = false;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (unavailable) return Response.json({ error: { message: "Personal OpenAI setup is unavailable." } }, { status: 503 });
    if (url.endsWith("/connect")) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-csrf-token")).toBe("member-csrf");
      connecting = true;
      return Response.json({ state: "starting", authenticated: false, modelReady: false, paused: false });
    }
    expect(url).toBe("/api/account/openai");
    return Response.json({
      state: connecting ? "awaiting_user" : "disconnected", authenticated: false, modelReady: false, paused: true,
      verificationUrl: connecting ? "https://auth.openai.com/codex/device" : null,
      userCode: connecting ? "TEST-CODE" : null,
    });
  });
  render(<PersonalProviderConnection csrfToken="member-csrf" />);
  await screen.findByText("Connection status unavailable");
  expect(screen.queryByRole("button", { name: "Connect ChatGPT" })).toBeNull();
  unavailable = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry connection status" }));
  fireEvent.click(await screen.findByRole("button", { name: "Connect ChatGPT" }));
  expect(await screen.findByText("TEST-CODE")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open OpenAI sign-in" }).getAttribute("href")).toBe("https://auth.openai.com/codex/device");
  await waitFor(() => expect(screen.queryByText("Personal OpenAI setup is unavailable.")).toBeNull());
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/admin/"))).toBe(false);
});


it("requests one device code after an explicit choice, including when mount effects are replayed", async () => {
  let finishStart: (response: Response) => void = () => {};
  let connecting = false;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/connect")) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-csrf-token")).toBe("member-csrf");
      connecting = true;
      return new Promise<Response>((resolve) => { finishStart = resolve; });
    }
    return Response.json({ state: connecting ? "awaiting_user" : "disconnected", authenticated: false, modelReady: false, paused: !connecting, verificationUrl: connecting ? "https://auth.openai.com/codex/device" : null, userCode: connecting ? "TEST-CODE" : null });
  });
  render(<StrictMode><PersonalProviderConnection csrfToken="member-csrf" /></StrictMode>);
  fireEvent.click(await screen.findByRole("button", { name: "Connect ChatGPT" }));
  expect(await screen.findByText("Preparing a secure sign-in code…")).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/connect"))).toHaveLength(1);
  finishStart(Response.json({ state: "starting", authenticated: false, modelReady: false, paused: false }));
  expect(await screen.findByText("TEST-CODE")).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/connect"))).toHaveLength(1);
});

it("offers a personal API key without echoing it and keeps ChatGPT as a separate choice", async () => {
  const key = "sk-test-personal";
  let method: "chatgpt" | "api-key" = "chatgpt";
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api-key")) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-csrf-token")).toBe("member-csrf");
      expect(JSON.parse(String(init?.body))).toEqual({ key });
      method = "api-key";
    }
    return Response.json({ provider: "openai", authMethod: method, state: method === "api-key" ? "connected" : "disconnected", authenticated: method === "api-key", modelReady: method === "api-key", paused: method !== "api-key", verificationUrl: null, userCode: null, expiresAt: null, message: null, agentId: "nl-test" });
  });
  render(<PersonalProviderConnection csrfToken="member-csrf" />);
  fireEvent.click(await screen.findByRole("button", { name: "Use an API key" }));
  fireEvent.change(screen.getByLabelText("OpenAI API key"), { target: { value: key } });
  fireEvent.click(screen.getByRole("button", { name: "Save and use API key" }));
  expect(await screen.findByText("OpenAI API key configured")).toBeTruthy();
  expect(screen.queryByDisplayValue(key)).toBeNull();
  expect(screen.getByRole("button", { name: "Use ChatGPT instead" })).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/api-key"))).toHaveLength(1);
});
