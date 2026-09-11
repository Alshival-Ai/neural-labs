import { createRoot } from "react-dom/client";
import { MessageAttachments } from "../src/ChatAttachments";
import "../src/styles.css";

createRoot(document.getElementById("root")!).render(<main style={{ padding: 16, height: "100vh", overflow: "auto" }}>
  <MessageAttachments attachments={[{ name: "sample.mp4", type: "video/mp4", path: "sample.mp4" }]} />
  <div style={{ height: 1600 }} />
  <MessageAttachments attachments={[{ name: "later.mp4", type: "video/mp4", path: "later.mp4" }]} />
</main>);
