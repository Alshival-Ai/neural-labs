import { Code2, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";

import "./vscode-app.css";

const VSCODE_URL = `/workspace/vscode/?folder=${encodeURIComponent("/home/node/workspace")}`;

export function VsCodeApp() {
  const [loaded, setLoaded] = useState(false);
  const [frameKey, setFrameKey] = useState(0);

  const reload = () => {
    setLoaded(false);
    setFrameKey((current) => current + 1);
  };

  return (
    <div className="vscode-app">
      <header className="vscode-app__toolbar">
        <div className="vscode-app__identity">
          <span><Code2 /></span>
          <div><strong>Workspace</strong><small>VS Code in the shared container</small></div>
        </div>
        <div className="vscode-app__actions">
          <span className={`vscode-app__state${loaded ? " is-loaded" : ""}`}><i />{loaded ? "Connected" : "Starting"}</span>
          <button type="button" onClick={reload} aria-label="Reload VS Code"><RefreshCw /></button>
          <a href={VSCODE_URL} target="_blank" rel="noopener noreferrer" aria-label="Open VS Code in a new tab"><ExternalLink /><span>Open in tab</span></a>
        </div>
      </header>
      <div className="vscode-app__canvas">
        {!loaded && <div className="vscode-app__loading" role="status"><Code2 /><strong>Opening VS Code</strong><span>Connecting to the shared workspace…</span></div>}
        <iframe
          key={frameKey}
          src={VSCODE_URL}
          title="VS Code workspace"
          allow="clipboard-read; clipboard-write"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  );
}
