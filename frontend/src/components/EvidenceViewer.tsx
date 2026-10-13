// Shows a figure in its source: the PDF page with the value boxed, a window of spreadsheet cells
// with the cell outlined, or the CSV line. Images are fetched with the auth header and shown via
// object URLs (a plain <img src> cannot send a bearer token).
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { EvidenceItem } from "../types";
import { grouped } from "../format";
import { ErrorNote, Loading } from "./Marks";

export function EvidenceViewer({ evidence, documentId, tone }: { evidence: EvidenceItem; documentId: string; tone: "red" | "green" }) {
  const loc = evidence.location;
  if (loc.page && loc.bbox)
    return (
      <PdfEvidence
        documentId={documentId}
        page={loc.page}
        bbox={loc.bbox}
        pageWidth={loc.page_size?.[0] ?? 595}
        tone={tone}
      />
    );
  if (loc.sheet && loc.cell) return <SheetEvidence documentId={documentId} sheet={loc.sheet} cell={loc.cell} />;
  if (loc.line) return <CsvEvidence documentId={documentId} line={loc.line} />;
  return <p className="quiet">No location recorded for this figure.</p>;
}

function PdfEvidence({
  documentId,
  page,
  bbox,
  pageWidth,
  tone,
}: {
  documentId: string;
  page: number;
  bbox: number[];
  pageWidth: number;
  tone: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let current: string | null = null;
    const box = encodeURIComponent(`${bbox.join(",")},${tone}`);
    setUrl(null);
    api
      .blobUrl(`/documents/${documentId}/pages/${page}.png?box=${box}`)
      .then((u) => {
        current = u;
        if (!revoked) setUrl(u);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      revoked = true;
      if (current) URL.revokeObjectURL(current); // free memory when the selection changes
    };
  }, [documentId, page, bbox, tone]);

  // Once the image has laid out, scroll the frame so the highlighted value sits near the top.
  const frame = useRef<HTMLElement>(null);
  function scrollToHighlight(img: HTMLImageElement) {
    if (!frame.current || !img.naturalWidth) return;
    const renderScale = img.naturalWidth / pageWidth; // PNG pixels per PDF point
    const shown = img.clientWidth / img.naturalWidth; // on-screen pixels per PNG pixel
    frame.current.scrollTop = Math.max(0, bbox[1] * renderScale * shown - 140);
  }

  if (error) return <ErrorNote message={`Could not load page ${page}: ${error}`} />;
  if (!url) return <Loading />;
  return (
    <figure className="page-figure" ref={frame}>
      <img src={url} alt={`Page ${page} with the figure highlighted`} onLoad={(e) => scrollToHighlight(e.currentTarget)} />
    </figure>
  );
}

function SheetEvidence({ documentId, sheet, cell }: { documentId: string; sheet: string; cell: string }) {
  const { data, error } = useAsync(() => api.sheetCells(documentId, sheet, cell), [documentId, sheet, cell]);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  return (
    <div className="grid-scroll">
      <table className="sheet-grid">
        <thead>
          <tr>
            <th />
            {data.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.row}>
              <th>{r.row}</th>
              {r.cells.map((v, i) => (
                <td key={i} className={r.row === data.highlight.row && i + 1 === data.highlight.col ? "is-target" : ""}>
                  {grouped(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">
        {sheet} sheet, cell {cell}
      </p>
    </div>
  );
}

function CsvEvidence({ documentId, line }: { documentId: string; line: number }) {
  const { data, error } = useAsync(() => api.csvLines(documentId, line), [documentId, line]);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  return (
    <div className="grid-scroll">
      <table className="sheet-grid">
        <thead>
          <tr>
            <th>Line</th>
            {data.header.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.line} className={r.line === data.highlight ? "is-target-row" : ""}>
              <th>{r.line}</th>
              {r.cells.map((v, i) => (
                <td key={i}>{grouped(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

