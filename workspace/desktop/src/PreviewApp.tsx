import { Download, FileWarning, LoaderCircle, Maximize2, RefreshCw, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createWorkspaceWebsitePreview,
  subscribeWorkspaceFiles,
  workspaceContentUrl,
  workspaceDownloadUrl,
  type WorkspacePreviewFile,
} from "./filesApi";
import "./preview-app.css";

type PreviewKind = "audio" | "csv" | "html" | "image" | "pdf" | "spreadsheet" | "video" | "unsupported";
type SheetPreview = {
  name: string;
  rows: string[][];
  rowCount: number;
  columnCount: number;
  truncated: boolean;
};

const MAX_SPREADSHEET_BYTES = 25 * 1024 * 1024;
const MAX_SHEET_ROWS = 500;
const MAX_SHEET_COLUMNS = 100;

function extensionFor(name: string): string {
  return name.includes(".") ? name.split(".").at(-1)?.toLowerCase() ?? "" : "";
}

export function previewKindFor(file: WorkspacePreviewFile): PreviewKind {
  const extension = extensionFor(file.name);
  if (["html", "htm"].includes(extension)) return "html";
  if (file.mimeType.startsWith("image/") || ["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"].includes(extension)) return "image";
  if (file.mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (file.mimeType.startsWith("video/") || ["m4v", "mov", "mp4", "ogv", "webm"].includes(extension)) return "video";
  if (file.mimeType.startsWith("audio/") || ["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav"].includes(extension)) return "audio";
  if (extension === "xlsx") return "spreadsheet";
  if (extension === "csv") return "csv";
  return "unsupported";
}

function columnLabel(index: number): string {
  let value = index;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function displayCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleString();
  return typeof value === "object" ? "" : String(value);
}

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"'; index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (character !== "\r") cell += character;
  }
  if (cell || row.length || (content && !content.endsWith("\n"))) { row.push(cell); rows.push(row); }
  return rows;
}

function PreviewStatus({ message, error = false }: { message: string; error?: boolean }) {
  return <div className={`preview-status${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
    <span>{error ? <FileWarning /> : <LoaderCircle className="is-spinning" />}</span>
    <strong>{error ? "Preview unavailable" : "Preparing preview"}</strong>
    <p>{message}</p>
  </div>;
}

function DataTable({ sheet }: { sheet: SheetPreview }) {
  const visibleColumns = Math.min(sheet.columnCount, MAX_SHEET_COLUMNS);
  return <div className="preview-sheet-table-wrap">
    <table className="preview-sheet-table">
      <thead><tr><th aria-label="Row number" />{Array.from({ length: visibleColumns }, (_, index) => <th key={index}>{columnLabel(index + 1)}</th>)}</tr></thead>
      <tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex}><th>{rowIndex + 1}</th>{Array.from({ length: visibleColumns }, (_, columnIndex) => <td key={columnIndex} title={row[columnIndex]}>{row[columnIndex] ?? ""}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function SpreadsheetPreview({ file }: { file: WorkspacePreviewFile }) {
  const [sheets, setSheets] = useState<SheetPreview[]>();
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setSheets(undefined); setActiveSheet(0); setError(undefined);
    if (file.size > MAX_SPREADSHEET_BYTES) {
      setError("Workbooks larger than 25 MB can be downloaded but are not opened in the browser preview.");
      return () => controller.abort();
    }
    void (async () => {
      try {
        const response = await fetch(workspaceContentUrl(file.path), { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error(`Preview failed with HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const { default: readExcelFile } = await import("read-excel-file/browser");
        const workbook = await readExcelFile(buffer);
        if (controller.signal.aborted) return;
        const previews = workbook.map((worksheet) => {
          const sourceColumnCount = worksheet.data.reduce((maximum, row) => Math.max(maximum, row.length), 0);
          const rowCount = Math.min(worksheet.data.length, MAX_SHEET_ROWS);
          const columnCount = Math.min(sourceColumnCount, MAX_SHEET_COLUMNS);
          const rows = worksheet.data.slice(0, rowCount).map((row) =>
            row.slice(0, columnCount).map(displayCellValue));
          return {
            name: worksheet.sheet,
            rows,
            rowCount: worksheet.data.length,
            columnCount: sourceColumnCount,
            truncated: worksheet.data.length > MAX_SHEET_ROWS || sourceColumnCount > MAX_SHEET_COLUMNS,
          };
        });
        setSheets(previews);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The workbook could not be read.");
      }
    })();
    return () => controller.abort();
  }, [file.path, file.size]);

  if (error) return <PreviewStatus message={error} error />;
  if (!sheets) return <PreviewStatus message="Reading workbook sheets…" />;
  if (!sheets.length) return <PreviewStatus message="This workbook does not contain any worksheets." error />;
  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)];
  return <div className="preview-spreadsheet">
    <div className="preview-sheet-tabs" role="tablist" aria-label="Workbook sheets">
      {sheets.map((candidate, index) => <button type="button" role="tab" aria-selected={index === activeSheet} key={`${candidate.name}:${index}`} onClick={() => setActiveSheet(index)}>{candidate.name}</button>)}
    </div>
    <div className="preview-sheet-summary"><Table2 /><span><strong>{sheet.name}</strong>{sheet.rowCount.toLocaleString()} rows × {sheet.columnCount.toLocaleString()} columns{sheet.truncated ? " · showing the first 500 rows and 100 columns" : ""}</span></div>
    <DataTable sheet={sheet} />
  </div>;
}

function CsvPreview({ file }: { file: WorkspacePreviewFile }) {
  const [sheet, setSheet] = useState<SheetPreview>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setSheet(undefined); setError(undefined);
    if (file.size > MAX_SPREADSHEET_BYTES) {
      setError("CSV files larger than 25 MB can be downloaded but are not opened in the browser preview.");
      return () => controller.abort();
    }
    void (async () => {
      try {
        const response = await fetch(workspaceContentUrl(file.path), { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error(`Preview failed with HTTP ${response.status}`);
        const allRows = parseCsv(await response.text());
        if (controller.signal.aborted) return;
        const columnCount = allRows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
        setSheet({ name: file.name, rows: allRows.slice(0, MAX_SHEET_ROWS).map((row) => row.slice(0, MAX_SHEET_COLUMNS)), rowCount: allRows.length, columnCount, truncated: allRows.length > MAX_SHEET_ROWS || columnCount > MAX_SHEET_COLUMNS });
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The CSV file could not be read.");
      }
    })();
    return () => controller.abort();
  }, [file.name, file.path, file.size]);
  if (error) return <PreviewStatus message={error} error />;
  if (!sheet) return <PreviewStatus message="Reading rows…" />;
  return <div className="preview-spreadsheet"><div className="preview-sheet-summary"><Table2 /><span><strong>{file.name}</strong>{sheet.rowCount.toLocaleString()} rows × {sheet.columnCount.toLocaleString()} columns{sheet.truncated ? " · preview truncated" : ""}</span></div><DataTable sheet={sheet} /></div>;
}

export function PreviewApp({ file }: { file: WorkspacePreviewFile }) {
  const kind = useMemo(() => previewKindFor(file), [file]);
  const [htmlUrl, setHtmlUrl] = useState<string>();
  const [htmlError, setHtmlError] = useState<string>();
  const [htmlRevision, setHtmlRevision] = useState(0);
  const contentUrl = workspaceContentUrl(file.path);
  useEffect(() => {
    let cancelled = false;
    setHtmlUrl(undefined);
    setHtmlError(undefined);
    setHtmlRevision(0);
    if (kind !== "html") return () => { cancelled = true; };
    void createWorkspaceWebsitePreview(file.path).then((preview) => {
      if (!cancelled) setHtmlUrl(preview.url);
    }).catch((error) => {
      if (!cancelled) setHtmlError(error instanceof Error ? error.message : "The website preview could not be opened.");
    });
    return () => { cancelled = true; };
  }, [file.path, kind]);
  useEffect(() => {
    if (kind !== "html" || typeof EventSource !== "function") return undefined;
    const separator = file.path.lastIndexOf("/");
    const root = separator < 0 ? "" : file.path.slice(0, separator);
    let refreshTimer = 0;
    const unsubscribe = subscribeWorkspaceFiles((change) => {
      const changedInsideSite = change.paths.some((changedPath) =>
        root ? changedPath === root || changedPath.startsWith(`${root}/`) : !changedPath.includes("/"));
      if (!changedInsideSite) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => setHtmlRevision((current) => current + 1), 180);
    });
    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [file.path, kind]);
  const liveHtmlUrl = htmlUrl && htmlRevision > 0 ? `${htmlUrl}?reload=${htmlRevision}` : htmlUrl;
  return <div className="preview-app">
    <header className="preview-toolbar">
      <div><span>{kind === "spreadsheet" || kind === "csv" ? "Spreadsheet" : kind === "html" ? "Web page · live preview" : kind[0].toUpperCase() + kind.slice(1)}</span><strong>{file.name}</strong></div>
      <div className="preview-toolbar-actions">
        {kind === "html" && <button type="button" onClick={() => setHtmlRevision((current) => current + 1)}><RefreshCw />Reload</button>}
        <a href={workspaceDownloadUrl(file.path)} download={file.name}><Download />Download</a>
      </div>
    </header>
    <main className={`preview-canvas is-${kind}`}>
      {kind === "image" && <img src={contentUrl} alt={file.name} />}
      {kind === "html" && !htmlUrl && <PreviewStatus message={htmlError ?? "Creating a private preview…"} error={Boolean(htmlError)} />}
      {kind === "html" && liveHtmlUrl && <iframe src={liveHtmlUrl} title={`Preview of ${file.name}`} sandbox="allow-scripts allow-modals allow-downloads" />}
      {kind === "pdf" && <iframe src={contentUrl} title={`Preview of ${file.name}`} />}
      {kind === "video" && <video src={contentUrl} controls preload="metadata">Your browser cannot play this video.</video>}
      {kind === "audio" && <div className="preview-audio"><span><Maximize2 /></span><strong>{file.name}</strong><audio src={contentUrl} controls preload="metadata">Your browser cannot play this audio file.</audio></div>}
      {kind === "spreadsheet" && <SpreadsheetPreview file={file} />}
      {kind === "csv" && <CsvPreview file={file} />}
      {kind === "unsupported" && <PreviewStatus message="Download this file or open it with a compatible desktop application." error />}
    </main>
  </div>;
}
