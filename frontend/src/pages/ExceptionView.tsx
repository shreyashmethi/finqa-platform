// One exception: where it sits in the queue (previous/next), the figure that disagrees against the
// figure most documents agree on, the explanation as an auditor's note, the tick-and-tie strip
// across documents, the selected figure in its source, then the decision and the audit trail.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { AuditTrail, DecisionPanel } from "../components/DecisionPanel";
import { EvidenceViewer } from "../components/EvidenceViewer";
import { Icon } from "../components/Icons";
import { ErrorNote, Kbd, Loading, SeverityMark, StatusTag } from "../components/Marks";
import { useToast } from "../components/Toast";
import { docName, TickTieStrip } from "../components/TickTieStrip";
import { amount, metricName, diffText, periodName, STATUS_NAMES, TYPE_HINTS, TYPE_NAMES, whereText } from "../format";
import { useAsync, useHotkeys, useStoredFlag } from "../hooks";
import type { DecisionAction, EvidenceItem } from "../types";
import { usePageTitle } from "../prefs";
import { QUEUE_CONTEXT_KEY } from "./Queue";

/** The queue filter the user came from (status=open by default). */
function queueContext(): URLSearchParams {
  try {
    return new URLSearchParams(sessionStorage.getItem(QUEUE_CONTEXT_KEY) ?? "");
  } catch {
    return new URLSearchParams();
  }
}

export function ExceptionView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: e, error, setData, reload } = useAsync(() => api.exception(id), [id]);
  const [selected, setSelected] = useState<EvidenceItem | null>(null);
  const [autoAdvance, setAutoAdvance] = useStoredFlag("finqa.autoAdvance", true);
  usePageTitle(e ? `${metricName(e.metric)}, ${periodName(e.period)}` : "Exception");

  // The ordered ids of the list the user is working through, fetched once per filter context.
  const ctx = useMemo(queueContext, []);
  const ctxStatus = ctx.get("status") ?? "open";
  const list = useAsync(
    () =>
      api.exceptions({
        status: ctxStatus === "all" ? undefined : ctxStatus,
        severity: ctx.get("severity") ?? undefined,
        type: ctx.get("type") ?? undefined,
        q: ctx.get("q") ?? undefined,
        set_id: ctx.get("set_id") ?? undefined,
        company_id: ctx.get("company_id") ?? undefined,
        metric: ctx.get("metric") ?? undefined,
        limit: 500,
      }),
    [ctx],
  );
  const ids = list.data?.items.map((x) => x.id) ?? [];
  const pos = ids.indexOf(id);
  const prevId = pos > 0 ? ids[pos - 1] : null;
  const nextId = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null;
  const backTo = `/queue${ctx.toString() ? `?${ctx}` : ""}`;

  // Default selection: the conflicting figure if there is one, otherwise the first supporting one.
  useEffect(() => {
    if (e) setSelected(e.evidence.conflicting.find((c) => !c.missing) ?? e.evidence.conflicting[0] ?? e.evidence.supporting[0] ?? null);
  }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useHotkeys({
    j: () => nextId && navigate(`/exceptions/${nextId}`),
    k: () => prevId && navigate(`/exceptions/${prevId}`),
    u: () => navigate(backTo),
  });

  function onDecided(updated: typeof e, action: DecisionAction) {
    if (!updated) return;
    setData(updated);
    const verb = action === "comment" ? "Comment added" : action === "reopen" ? "Reopened" : `Saved as ${STATUS_NAMES[updated.status].toLowerCase()}`;
    if (autoAdvance && nextId && action !== "comment" && action !== "reopen") {
      toast(`${verb}. Showing the next item.`, { link: { to: `/exceptions/${updated.id}`, label: "Go back" } });
      navigate(`/exceptions/${nextId}`);
    } else if (action !== "comment" && action !== "reopen" && !nextId && pos >= 0) {
      toast(`${verb}. That was the last item in this list.`, { link: { to: backTo, label: "Back to queue" } });
    } else {
      toast(`${verb}.`);
    }
  }

  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!e) return <Loading />;
  const isConflict = selected ? e.evidence.conflicting.some((c) => c.line_item_id === selected.line_item_id) : false;
  const diff = diffText(e.type, e.expected_value, e.reported_value);
  const isAnomaly = e.type === "baseline_anomaly";
  const base = e.evidence.baseline;
  const selectedDocId = selected ? e.documents[selected.filename] : undefined;

  return (
    <article className="exception">
      <div className="exception-nav">
        <Link to={backTo} className="back-link">
          <Icon name="chevronLeft" size={16} /> Exception queue
        </Link>
        {pos >= 0 && (
          <div className="stepper-nav">
            <span className="quiet">
              {pos + 1} of {ids.length}
              {ctxStatus === "open" ? " open" : ""}
            </span>
            <button className="icon-button" disabled={!prevId} onClick={() => prevId && navigate(`/exceptions/${prevId}`)} title="Previous (k)" aria-label="Previous exception">
              <Icon name="chevronLeft" />
            </button>
            <button className="icon-button" disabled={!nextId} onClick={() => nextId && navigate(`/exceptions/${nextId}`)} title="Next (j)" aria-label="Next exception">
              <Icon name="chevronRight" />
            </button>
          </div>
        )}
      </div>

      <header className="page-head exception-head">
        <p className="eyebrow">
          <Link to={`/sets/${e.set_id}`}>{e.set_id}</Link>
        </p>
        <h1>
          {metricName(e.metric)}, {periodName(e.period)}
        </h1>
        <p className="meta-line">
          <SeverityMark severity={e.severity} />
          <span title={TYPE_HINTS[e.type]}>{TYPE_NAMES[e.type] ?? e.type}</span>
          <StatusTag status={e.status} />
        </p>
      </header>

      <div className="compare">
        <div className="compare-cell">
          <span className="compare-label">{isAnomaly ? `Audited ${base ? periodName(base.period) : "prior year"}` : "Most documents say"}</span>
          <span className="compare-value">{amount(isAnomaly && base ? base.value : e.expected_value, e.unit)}</span>
        </div>
        <span className="compare-arrow" aria-hidden="true">
          <Icon name="arrowRight" size={22} />
        </span>
        <div className="compare-cell compare-outlier">
          <span className="compare-label">
            {isAnomaly ? `Reported ${periodName(e.period)}` : e.outlier_documents.length ? e.outlier_documents.map(docName).join(", ") : "Reported"}
          </span>
          <span className="compare-value">{e.type === "missing_item" ? "Blank" : amount(e.reported_value, e.unit)}</span>
        </div>
        {diff && e.type !== "missing_item" && (
          <div className="compare-cell compare-diff">
            <span className="compare-label">Difference</span>
            <span className="compare-value">{diff}</span>
          </div>
        )}
        {e.override_value !== null && (
          <div className="compare-cell compare-corrected">
            <span className="compare-label">Correct value on record</span>
            <span className="compare-value">{amount(e.override_value, e.unit)}</span>
          </div>
        )}
      </div>

      <p className="note">{e.explanation}</p>

      <div className="exception-layout">
        <div className="exception-main">
          <section aria-labelledby="strip-h">
            <h2 id="strip-h">What each document reports</h2>
            <p className="section-help">Select a document to see the figure highlighted in its source.</p>
            <TickTieStrip exception={e} selected={selected?.line_item_id ?? null} onSelect={setSelected} />
          </section>

          {selected && (
            <section aria-labelledby="source-h" className="source">
              <div className="section-head">
                <h2 id="source-h">
                  {docName(selected.filename)}
                  <small>{whereText(selected.location)}</small>
                </h2>
                {selectedDocId && (
                  <button className="quiet-button" onClick={() => api.download(`/documents/${selectedDocId}/file`, selected.filename).catch((err: Error) => toast(err.message, { tone: "error" }))}>
                    <Icon name="download" size={16} /> {selected.filename}
                  </button>
                )}
              </div>
              {selectedDocId ? (
                <EvidenceViewer evidence={selected} documentId={selectedDocId} tone={isConflict ? "red" : "green"} />
              ) : (
                <p className="quiet">The source document is no longer available.</p>
              )}
            </section>
          )}
        </div>

        <aside className="exception-side">
          <section aria-labelledby="decide-h" className="panel decision-panel">
            <h2 id="decide-h">Your decision</h2>
            <DecisionPanel exception={e} onChange={onDecided} autoAdvance={autoAdvance} setAutoAdvance={setAutoAdvance} hasNext={!!nextId} />
          </section>
          <section aria-labelledby="audit-h" className="panel">
            <h2 id="audit-h">Audit trail</h2>
            <AuditTrail exception={e} />
          </section>
          <p className="quiet shortcut-hint">
            <Kbd>j</Kbd> <Kbd>k</Kbd> next / previous · <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> decide · <Kbd>u</Kbd> back to queue
          </p>
        </aside>
      </div>
    </article>
  );
}
