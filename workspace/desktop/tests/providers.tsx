// Development-only UI fixture. All backend requests are intercepted by tests.
import { createRoot } from "react-dom/client";
import { SettingsApp } from "../src/SettingsApp";
import { ConversationModelPicker } from "../src/ConversationModelPicker";
import type { NeuraGateway } from "../src/openclaw";
import "../src/styles.css";

const conversation = new URLSearchParams(location.search).has("conversation");
createRoot(document.getElementById("root")!).render(<div style={{ containerType: "inline-size", containerName: "app-window", width: "100vw", height: "100dvh" }}>{conversation ? <div className="neura-app"><main className="neura-main"><header className="neura-toolbar"><button type="button">History</button><div><strong>Private conversation</strong><span>Connected</span></div><ConversationModelPicker session={{ key: "test", sessionId: "test", title: "Test", updatedAt: 1, archived: false, active: false, visibility: "draft" }} gateway={{ patchSession: async () => ({}) } as unknown as NeuraGateway} /></header></main></div> :
  <SettingsApp administrator={false} csrfToken="model-test-csrf" currentUserId="11111111-1111-4111-8111-111111111111" initialSection="model-provider" />}</div>,
);
