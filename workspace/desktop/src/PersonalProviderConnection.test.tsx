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


it("requests one device code on setup, including when mount effects are replayed", async () => {
  let finishStart: (response: Response) => void = () => {};
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/connect")) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-csrf-token")).toBe("member-csrf");
      return new Promise<Response>((resolve) => { finishStart = resolve; });
    }
    return Response.json({ state: "awaiting_user", authenticated: false, modelReady: false, paused: true, verificationUrl: "https://auth.openai.com/codex/device", userCode: "TEST-CODE" });
  });
  render(<StrictMode><PersonalProviderConnection csrfToken="member-csrf" startOnMount /></StrictMode>);
  expect(await screen.findByText("Preparing a secure sign-in code…")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
  finishStart(Response.json({ state: "starting", authenticated: false, modelReady: false, paused: false }));
  expect(await screen.findByText("TEST-CODE")).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/connect"))).toHaveLength(1);
});
