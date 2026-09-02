import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { NeuraApp } from "./NeuraApp";
import type { NeuraGateway } from "./openclaw";
import type { ConnectionState, GatewayEvent, SessionRow } from "./types";

const session: SessionRow = {
  key: "agent:main:neura:test",
  sessionId: "session-test",
  title: "Realtime test",
  updatedAt: Date.now(),
  archived: false,
  active: false,
  category: "neura",
  visibility: "draft",
  sharingRole: "owner",
};

class FakeGateway {
  readonly calls: string[] = [];
  private eventListener?: (event: GatewayEvent) => void;

  onStatus(listener: (state: ConnectionState, error?: string) => void) {
    listener("connected");
    return () => undefined;
  }

  onEvent(listener: (event: GatewayEvent) => void) {
    this.eventListener = listener;
    return () => { this.eventListener = undefined; };
  }

  async listSessions() {
    this.calls.push("sessions.list");
    return [session];
  }

  async protectLegacyPrivateSessions(sessions: SessionRow[]) {
    this.calls.push("sessions.protect-private");
    return sessions;
  }

  async subscribeSession(key: string) {
    this.calls.push(`messages.subscribe:${key}`);
    return { key };
  }

  async unsubscribeSession() {}

  async loadHistory(key: string) {
    this.calls.push(`history:${key}`);
    return [];
  }

  async readSkillsStatus() {
    return { agentId: "main", skills: [
      {
        name: "cinematic-interactions",
        skillKey: "cinematic-interactions",
        description: "Build cinematic web interactions.",
        disabled: false,
        eligible: true,
        modelVisible: true,
        userInvocable: true,
      },
      {
        name: "local-business-website-builder",
        skillKey: "local-business-website-builder",
        description: "Build high-quality local business websites.",
        disabled: false,
        eligible: true,
        modelVisible: true,
        userInvocable: true,
      },
      {
        name: "disabled-skill",
        skillKey: "disabled-skill",
        description: "This skill must stay hidden.",
        disabled: true,
        eligible: false,
      },
    ] };
  }

  emit(event: GatewayEvent) {
    this.eventListener?.(event);
  }
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

afterEach(cleanup);

describe("Neura realtime conversation", () => {
  it("makes Team Chat creation a labeled, discoverable action", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    const actions = screen.getAllByRole("button", { name: "New Team Chat" });
    expect(actions.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(actions[0]);
    expect(await screen.findByRole("dialog", { name: "Create Team Chat" })).toBeInTheDocument();
    expect(screen.getByText("Invited teammates")).toBeInTheDocument();
    expect(screen.getByText("Everyone")).toBeInTheDocument();
  });

  it("subscribes before history and renders live streamed and durable replies", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    await waitFor(() => expect(gateway.calls).toEqual([
      "sessions.list",
      "sessions.protect-private",
      `messages.subscribe:${session.key}`,
      `history:${session.key}`,
    ]));
    expect(await screen.findByPlaceholderText("Message Neura…")).toBeEnabled();

    act(() => gateway.emit({ event: "chat", payload: {
      sessionKey: session.key,
      runId: "run-1",
      state: "delta",
      deltaText: "Streaming now",
    } }));
    expect(screen.getByText("Streaming now")).toBeInTheDocument();

    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      sessionId: session.sessionId,
      runId: "run-1",
      phase: "end",
      messageId: "assistant-1",
      message: { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "The durable answer" }] },
    } }));
    expect(screen.getByText("The durable answer")).toBeInTheDocument();
    expect(screen.queryByText("Streaming now")).not.toBeInTheDocument();

    const listCallsBeforeRosterEvent = gateway.calls.filter((call) => call === "sessions.list").length;
    act(() => gateway.emit({ event: "sessions.changed", payload: {} }));
    await waitFor(() => expect(gateway.calls.filter((call) => call === "sessions.list")).toHaveLength(listCallsBeforeRosterEvent + 1));
    expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled();
    expect(screen.queryByText("Work with Neura")).not.toBeInTheDocument();
  });

  it("opens the live skill picker when a user types $ and inserts the selected command", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    const composer = await screen.findByPlaceholderText("Message Neura…");
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: "$local", selectionStart: 6 } });

    expect(await screen.findByRole("option", { name: /local-business-website-builder/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /cinematic-interactions/i })).not.toBeInTheDocument();
    expect(screen.queryByText("disabled-skill")).not.toBeInTheDocument();

    fireEvent.keyDown(composer, { key: "Enter" });
    expect(composer).toHaveValue("$local_business_website_builder ");
    expect(screen.queryByRole("listbox", { name: "Available skills" })).not.toBeInTheDocument();
  });

  it("opens Neura's loopback website links through the authenticated preview route", async () => {
    const gateway = new FakeGateway();
    render(<NeuraApp gateway={gateway as unknown as NeuraGateway} notify={vi.fn()} />);

    await waitFor(() => expect(screen.getByPlaceholderText("Message Neura…")).toBeEnabled());
    act(() => gateway.emit({ event: "session.message", payload: {
      sessionKey: session.key,
      sessionId: session.sessionId,
      messageId: "assistant-preview",
      message: {
        id: "assistant-preview",
        role: "assistant",
        content: [{
          type: "text",
          text: "[Open the website](http://127.0.0.1:4173/)\n\nPage: `tiny-site/index.html`",
        }],
      },
    } }));

    const link = await screen.findByRole("link", { name: "Open the website" });
    expect(link).toHaveAttribute("href", "/workspace/preview/dGlueS1zaXRl/index.html");
    expect(link).toHaveAttribute("title", "Open website preview");
  });
});
