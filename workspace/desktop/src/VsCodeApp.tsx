import { Code2, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { openWorkspaceInVsCode, type WorkspaceVsCodeTarget } from "./filesApi";
import "./vscode-app.css";

const WORKSPACE_ROOT = "/home/node/workspace";
const VSCODE_URL = `/workspace/vscode/?folder=${encodeURIComponent(WORKSPACE_ROOT)}`;

function fileUri(absolutePath: string) {
  return `file://${absolutePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function vsCodeTargetUrl(target: WorkspaceVsCodeTarget) {
  const absolutePath = target.path ? `${WORKSPACE_ROOT}/${target.path}` : WORKSPACE_ROOT;
  if (target.type === "folder") {
    return `/workspace/vscode/?folder=${encodeURIComponent(absolutePath)}`;
  }
  const payload = JSON.stringify([["openFile", fileUri(absolutePath)]]);
  return `${VSCODE_URL}&payload=${encodeURIComponent(payload)}`;
}

export type VsCodeOpenRequest = { id: string; path: string };

export function VsCodeApp({ openRequest, notify }: { openRequest?: VsCodeOpenRequest; notify?: (message: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [frameUrl, setFrameUrl] = useState(VSCODE_URL);
  const handledRequest = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!openRequest || handledRequest.current === openRequest.id) return;
    handledRequest.current = openRequest.id;
    let active = true;
    void openWorkspaceInVsCode(openRequest.path).then(({ opened }) => {
      if (!active) return;
      setLoaded(false);
      setFrameUrl(vsCodeTargetUrl(opened));
      setFrameKey((current) => current + 1);
    }).catch((error) => {
      if (active) notify?.(error instanceof Error ? error.message : "VS Code could not open this workspace item.");
    });
    return () => { active = false; };
  }, [notify, openRequest]);

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
          src={frameUrl}
          title="VS Code workspace"
          allow="clipboard-read; clipboard-write"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  );
}
