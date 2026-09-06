// Development-only UI fixture. Not imported by, or included in, the production entry.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppViewportProvider } from "../src/appViewport";
import { NeuraApp } from "../src/NeuraApp";
import { TerminalApp } from "../src/TerminalApp";
import type { NeuraGateway } from "../src/openclaw";
import type { TerminalDescriptor } from "../src/terminalApi";
import "../src/styles.css";

const qa = {
  inputs: [] as string[],
  reactions: [] as Record<string, unknown>[],
  sends: [] as string[],
  queueModes: [] as string[],
  teamPosts: [] as Array<Record<string, unknown>>,
  connections: 0,
  disposals: 0,
};
const noop = () => {};
const channels = [
  {
    id: "release",
    name: "Release planning",
    audience: "restricted",
    ownerUserId: "qa",
    pinned: true,
    memberCount: 4,
    unreadCount: 2,
    mentionCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canManage: true,
    canPin: true,
  },
];
const teamUsers = [
  { id: "qa", handle: "qa", displayName: "QA", role: "admin" as const },
  { id: "salvador", handle: "salvador", displayName: "Salvador", role: "user" as const },
];
Object.assign(window, { mobileQA: qa });
const chats = Array.from({ length: 35 }, (_, index) => ({
  key: `chat-${index}`,
  sessionId: `chat-${index}`,
  title: index ? `Planning conversation ${index}` : "Mobile experience review",
  updatedAt: Date.now() - index * 1000,
  archived: index === 34,
  active: false,
  category: "neura",
  visibility: "draft",
  sharingRole: "owner",
}));
export const gateway = {
  onStatus(listener: (status: string) => void) {
    listener("connected");
    return () => {};
  },
  onEvent() {
    return () => {};
  },
  async listSessions() {
    return chats;
  },
  async protectLegacyPrivateSessions(list: unknown) {
    return list;
  },
  async subscribeSession(key: string) {
    return { key };
  },
  async unsubscribeSession() {},
  async loadHistory(key: string) {
    return [
      {
        id: `${key}-q`,
        role: "user",
        text: "Can we make this easier to use on my phone?",
      },
      {
        id: `${key}-a`,
        role: "assistant",
        attachments: [{ name: "chat-preview.svg", type: "image/svg+xml", path: "qa/chat-preview.svg", size: 200 }],
        text:
          "Yes. Your conversations remain available in the history drawer.\n\n```sh\nprintf 'A long code sample stays inside its own horizontal scrolling region'\n```\n\n" +
          Array.from(
            { length: 12 },
            (_, i) =>
              `Paragraph ${i + 1}. The transcript scrolls independently of the controls.`,
          ).join("\n\n"),
      },
    ];
  },
  async readSkillsStatus() {
    return { agentId: "main", skills: [] };
  },
  async listQuestions() { return []; },
  async send(_session: { key: string }, text: string, _attachments: unknown[], queueMode: string) {
    const chat = chats.find((item) => item.key === _session.key);
    if (chat) chat.active = true;
    qa.sends.push(text);
    qa.queueModes.push(queueMode);
    return { runId: "qa-run" };
  },
  async createSession() {
    const next = {
      ...chats[0],
      key: "new-chat",
      sessionId: "new-chat",
      title: "New conversation",
    };
    chats.unshift(next);
    return next;
  },
  async abort() {},
} as unknown as NeuraGateway;
const terminals: TerminalDescriptor[] = Array.from(
  { length: 12 },
  (_, index) => ({
    id: `shell-${index}`,
    title:
      index === 0
        ? "Workspace shell"
        : index === 1
          ? "Release room"
          : `Development shell ${index}`,
    scope: index === 1 ? "team" : "personal",
    shell: "bash",
    cwd: "~/workspace",
    status: "running",
    createdAt: 1,
    lastActivityAt: 1,
    cols: 80,
    rows: 24,
    sequence: 0,
    exitCode: null,
    owner: { label: "QA" },
    owned: true,
    canTerminate: true,
    participants: [],
    voiceParticipants: [],
    layoutLeader: null,
  }),
);
terminals[1].teamChannel = {
  id: "release",
  name: "Release planning",
};
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.includes("/api/")) return originalFetch(input, init);
  if (url.startsWith("/api/account/model-providers/catalog")) return Response.json({ agentId: "main", models: [], fetchedAt: new Date().toISOString(), stale: false });
  // The voice acceptance test intercepts these requests; never calls a provider.
  if (url.startsWith("/workspace/api/neura/") || url.startsWith("/workspace/api/files") || (url.endsWith("/messages") && init?.method === "POST")) return originalFetch(input, init);
  if (url.startsWith("/api/team/"))
    return Response.json({
      channels,
      users: teamUsers,
      messages: [],
      ticket: "qa-team",
    });
  if (url.endsWith("/ticket"))
    return Response.json({
      ticket: "qa",
      path: `/workspace/api/terminals/socket?session=${url.split("/").at(-2)}`,
      protocol: "neural-terminal.v1",
      expiresAt: Date.now() + 60000,
    });
  if (url === "/workspace/api/terminals" && init?.method === "POST") {
    const next = {
      ...terminals[0],
      id: `shell-${terminals.length}`,
      title: `New shell ${terminals.length}`,
    };
    terminals.push(next);
    return Response.json({ session: next });
  }
  if (/\/terminals\/[^/]+\/gifs/.test(url)) return originalFetch(input, init);
  if (url.startsWith("/workspace/api/terminals"))
    return Response.json({ sessions: terminals });
  return Response.json({ channels: [], users: [], skills: [] });
};
const OriginalSocket = window.WebSocket;
class FixtureSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = 0;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onopen?: () => void;
  isTeamChat = false;
  constructor(url: string, protocols?: string[]) {
    if (String(url).includes("/api/team/socket")) {
      this.isTeamChat = true;
      setTimeout(() => {
        if (this.readyState === 3) return;
        this.readyState = 1;
        this.onopen?.();
        this.onmessage?.({
          data: JSON.stringify({ type: "ready", channels, users: teamUsers }),
        });
      }, 60);
      return;
    }
    if (!String(url).includes("/api/terminals/socket"))
      return new OriginalSocket(url, protocols) as unknown as FixtureSocket;
    qa.connections++;
    const session =
      terminals.find(
        (entry) => entry.id === new URL(url).searchParams.get("session"),
      ) || terminals[0];
    setTimeout(() => {
      if (this.readyState === 3) return;
      this.readyState = 1;
      this.onmessage?.({
        data: JSON.stringify({
          type: "ready",
          session,
          connectionId: session.id,
          mode: "replay",
        }),
      });
      this.onmessage?.({
        data: JSON.stringify({
          type: "replay",
          sequence: 1,
          data: "\x1b[36mNeural Labs mobile shell\x1b[0m\r\n\r\n$ git status\r\nOn branch mobile-improvements\r\nWorking tree ready\r\n\r\n$ ",
        }),
      });
    }, 60);
  }
  send(raw: string) {
    const value = JSON.parse(raw);
    if (value.type === "input") qa.inputs.push(value.data);
    if (value.type === "reaction") {
      qa.reactions.push(value);
      this.onmessage?.({ data: JSON.stringify({ ...value, id: `reaction-${qa.reactions.length}`, actor: { label: "QA" },
        ...(value.kind === "gif" ? { gif: { id: "qa", title: "Celebration", url: "https://static.klipy.com/qa.gif", preview: "https://static.klipy.com/qa.gif", still: "https://static.klipy.com/qa.png" } } : {}) }) });
    }
    if (this.isTeamChat && value.type === "post") qa.teamPosts.push(value);
  }
  close() {
    this.readyState = 3;
    if (!this.isTeamChat) qa.disposals++;
  }
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
function Fixture() {
  const [app, setApp] = useState("neura");
  const [width, setWidth] = useState(window.innerWidth);
  const [scale, setScale] = useState(100);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return (
    <>
      <header style={{ height: 64, padding: 12 }}>
        Mobile acceptance · {app}
      </header>
      <div
        style={{
          height: "calc(100dvh - 64px)",
          container: "app-window / inline-size",
        }}
      >
        <AppViewportProvider width={width}>
          {app === "neura" ? (
            <NeuraApp
              gateway={gateway}
              notify={noop}
              csrfToken="qa"
              onOpenTeamTerminal={noop}
            />
          ) : (
            <TerminalApp fontScale={scale} onFontScaleChange={setScale} />
          )}
        </AppViewportProvider>
      </div>
      <nav className="dock" aria-label="QA applications">
        <button onClick={() => setApp("neura")}>Neura</button>
        <button onClick={() => setApp("terminal")}>Terminal</button>
      </nav>
    </>
  );
}
if (window.location.pathname.endsWith("/mobile.html")) createRoot(document.getElementById("root")!).render(<Fixture />);
