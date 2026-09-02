import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";

import { parseCsv, PreviewApp, previewKindFor } from "./PreviewApp";
import type { WorkspacePreviewFile } from "./filesApi";

function previewFile(name: string, mimeType: string, size = 12): WorkspacePreviewFile {
  return { name, path: name, mimeType, size };
}

function workbookFixture(): Uint8Array {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Metrics" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
  const sheet = (left: string, right: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${left}</t></is></c><c r="B2" t="inlineStr"><is><t>${right}</t></is></c></row></sheetData></worksheet>`;
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(relationships),
    "xl/worksheets/sheet1.xml": strToU8(sheet("Preview", "Ready")),
    "xl/worksheets/sheet2.xml": strToU8(sheet("Rows", "2")),
  };
  return zipSync(files);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Preview app", () => {
  it("classifies common browser preview types", () => {
    expect(previewKindFor(previewFile("page.html", "text/html"))).toBe("html");
    expect(previewKindFor(previewFile("photo.png", "image/png"))).toBe("image");
    expect(previewKindFor(previewFile("report.pdf", "application/pdf"))).toBe("pdf");
    expect(previewKindFor(previewFile("metrics.xlsx", "application/octet-stream"))).toBe("spreadsheet");
    expect(previewKindFor(previewFile("clip.mp4", "video/mp4"))).toBe("video");
  });

  it("parses quoted CSV cells and line endings", () => {
    expect(parseCsv('Name,Note\r\nAda,"one, two"\r\nLinus,"said ""hello"""\r\n')).toEqual([
      ["Name", "Note"],
      ["Ada", "one, two"],
      ["Linus", 'said "hello"'],
    ]);
  });

  it("renders root HTML inside the authenticated sandboxed website route", () => {
    const { container } = render(<PreviewApp file={previewFile("index.html", "text/html")} />);
    const frame = screen.getByTitle("Preview of index.html");
    expect(frame).toHaveAttribute("src", "/workspace/preview/root/index.html");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-modals allow-popups allow-downloads");
    expect(container.querySelector('.preview-toolbar a[download="index.html"]')).toHaveAttribute("href", "/workspace/api/files/download?path=index.html");
  });

  it("renders images from the authenticated inline-content route", () => {
    render(<PreviewApp file={previewFile("photo.png", "image/png")} />);
    expect(screen.getByRole("img", { name: "photo.png" })).toHaveAttribute("src", "/workspace/api/files/content?path=photo.png");
  });

  it("renders CSV files as a scrollable table", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Name,Score\nAda,98\nLinus,95\n", { status: 200 }));
    render(<PreviewApp file={previewFile("scores.csv", "text/csv")} />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Ada")).toBeInTheDocument();
    expect(within(table).getByText("98")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/workspace/api/files/content?path=scores.csv", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("loads XLSX workbooks on demand and switches worksheets", async () => {
    const bytes = workbookFixture();
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));

    render(<PreviewApp file={previewFile("report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes.byteLength)} />);
    const tabs = await screen.findByRole("tablist", { name: "Workbook sheets" }, { timeout: 5_000 });
    expect(within(tabs).getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Ready")).toBeInTheDocument();

    within(tabs).getByRole("tab", { name: "Metrics" }).click();
    await waitFor(() => expect(screen.getByText("Rows")).toBeInTheDocument());
  });
});
