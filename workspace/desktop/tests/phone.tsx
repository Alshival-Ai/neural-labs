// Development-only fixture; not included in the production entry point.
import { createRoot } from "react-dom/client";
import { PersonalizationPanel } from "../src/UserSettingsApp";
import "../src/styles.css";
import "../src/settings-app.css";

createRoot(document.getElementById("root")!).render(
  <main className="settings-app" style={{ display: "block", padding: 16, maxWidth: 760, margin: "0 auto", height: "auto", overflow: "visible" }}>
    <PersonalizationPanel
      user={{
        id: "11111111-1111-4111-8111-111111111111",
        email: "qa@example.org",
        handle: "qa-user",
        displayName: "Test User",
        role: "user",
        status: "active",
      }}
      providers={["local", "microsoft"]}
      csrfToken="phone-test-csrf"
      fontScale={100}
      onFontScaleChange={() => {}}
      onLogout={() => {}}
    />
  </main>,
);
