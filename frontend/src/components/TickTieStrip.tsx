// The tick-and-tie strip: one column per document showing what it reports for this figure.
// Agreeing documents get a pencil tick; the outlier is circled in red. For an unusual-change
// exception the strip compares the audited prior year with the current figure instead.
// Clicking a column selects that piece of evidence for the viewer below.
import { amount, grouped, periodName, whereText } from "../format";
import type { EvidenceItem, ExceptionDetail } from "../types";
import { PencilCircle, Tick } from "./Marks";

export const DOC_NAMES: Record<string, string> = {
  "annual_report.pdf": "Annual report",
  "board_deck.pdf": "Board deck",
  "press_release.pdf": "Press release",
  "management_accounts.xlsx": "Management accounts",
  "quarterly_kpis.csv": "KPI file",
};

export const docName = (filename: string) => DOC_NAMES[filename] ?? filename;

interface Column {
  key: string;
  evidence: EvidenceItem;
  role: "agrees" | "conflicts";
  extra: number; // further occurrences of the same figure in the same document
}

/** One column per document; the first occurrence represents it, others are counted. */
function columns(e: ExceptionDetail): Column[] {
  const out: Column[] = [];
  const add = (items: EvidenceItem[], role: Column["role"]) => {
    for (const ev of items) {
      const existing = out.find((c) => c.evidence.document_id === ev.document_id && c.role === role);
      if (existing) existing.extra += 1;
      else out.push({ key: `${role}-${ev.line_item_id}`, evidence: ev, role, extra: 0 });
    }
  };
  add(e.evidence.conflicting, "conflicts");
  add(e.evidence.supporting, "agrees");
  return out;
}

export function TickTieStrip({
  exception,
  selected,
  onSelect,
}: {
  exception: ExceptionDetail;
  selected: number | null;
  onSelect: (ev: EvidenceItem) => void;
}) {
  const cols = columns(exception);
  const base = exception.evidence.baseline;
  return (
    <div className="strip" role="list" aria-label="What each document reports">
      {base && exception.type === "baseline_anomaly" && (
        <div className="strip-col strip-baseline" role="listitem">
          <span className="strip-doc">Audited {periodName(base.period)}</span>
          <span className="strip-value">{amount(base.value, exception.unit)}</span>
          <span className="strip-where">{base.source ?? "historical baseline"}</span>
        </div>
      )}
      {cols.map((c) => {
        const ev = c.evidence;
        const value = ev.missing ? "Blank" : grouped(ev.displayed);
        return (
          <button
            key={c.key}
            role="listitem"
            className={`strip-col strip-${c.role}${selected === ev.line_item_id ? " is-selected" : ""}`}
            onClick={() => onSelect(ev)}
            aria-pressed={selected === ev.line_item_id}
          >
            <span className="strip-doc">{docName(ev.filename)}</span>
            <span className="strip-value">
              {c.role === "conflicts" ? <PencilCircle>{value}</PencilCircle> : value}
              {c.role === "agrees" && <Tick />}
            </span>
            {!ev.missing && (
              // As printed, each document uses its own unit; this line puts them on one scale.
              <span className="strip-normalised">= {amount(ev.value, exception.unit)}</span>
            )}
            <span className="strip-where">
              {whereText(ev.location)}
              {c.extra > 0 && ` and ${c.extra} more place${c.extra > 1 ? "s" : ""}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
