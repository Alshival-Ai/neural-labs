import { useState } from "react";
import { History } from "lucide-react";
import { ExplorerDialog } from "./ExplorerDialog";
import { requestJson } from "./filesApi";

type ImportedFile = { id: string; name: string; path: string; trashed_at: string | null;
  agent_modified: boolean; versions: { id: string; version: number; created_at: string; size: number }[] };

export function ImportedHistory() {
  const [opened, setOpened] = useState(false);
  const [files, setFiles] = useState<ImportedFile[]>();
  const [error, setError] = useState("");
  async function show() {
    setOpened(true); setFiles(undefined); setError("");
    try { setFiles((await requestJson<{ files: ImportedFile[] }>("/workspace/api/files/history")).files); }
    catch { setError("Imported history is unavailable. Your current files are unchanged."); }
  }
  return <><button aria-label="Imported file history" title="Imported file history" onClick={() => void show()}><History /></button>
    {opened && <ExplorerDialog title="Imported file history" onClose={() => setOpened(false)}>
      <p>Original versions retained when files moved into this workspace. Working files may have changed since import.</p>
      {error && <p role="alert">{error}</p>}
      {!files && !error && <p role="status">Loading history…</p>}
      {files?.length === 0 && <p>No historical files have been imported.</p>}
      <div style={{ maxHeight: "55vh", overflow: "auto" }}>
        {files?.map(file => <section key={file.id}>
          <h3>{file.name}{file.trashed_at ? " · Deleted before import" : ""}</h3>
          <p>{file.path}{file.agent_modified ? " · Working copy changed before import" : ""}</p>
          <ul>{file.versions.map(version => <li key={version.id}>
            <a href={`/workspace/api/files/history/download?id=${encodeURIComponent(version.id)}`}>
              Version {version.version} · {new Date(version.created_at).toLocaleString()} · {version.size.toLocaleString()} bytes
            </a>
          </li>)}</ul>
        </section>)}
      </div>
      <footer><button onClick={() => setOpened(false)}>Close</button></footer>
    </ExplorerDialog>}
  </>;
}
