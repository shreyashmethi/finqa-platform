// One review run: a live pipeline of the agents (extraction counts documents as it goes), the
// result with a link to its exceptions, each step with the supervisor's reason, and every tool call
// (click a row for its full input and output). Resume/cancel controls for analysts and admins.
import { Fragment, useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { RUN_ROLES, useAuth } from "../auth";
import { Icon } from "../components/Icons";
import { ErrorNote, Kpi, Loading, RunStatusTag } from "../components/Marks";
import { useToast } from "../components/Toast";
import { dateTime, duration, NODE_NAMES, plural, TYPE_NAMES } from "../format";
import { usePageTitle } from "../prefs";
import { useAsync, usePolling } from "../hooks";

function describe(node: string, s: Record<string, any>): string {
  if (node === "supervisor") return s.next_agent ? `Sent work to the ${NODE_NAMES[s.next_agent]?.toLowerCase() ?? s.next_agent}` : "";
  if (node === "extraction" && s.extraction_stats?.[0]) {
    const x = s.extraction_stats[0];
    return `Read ${x.filename}: ${plural(x.items, "figure")}${x.missing_cells ? `, ${x.missing_cells} blank` : ""}${x.pages ? ` from ${plural(x.pages, "page")}` : ""}`;
  }
  if (node === "reconciliation") return `Found ${plural(s.findings ?? 0, "cross-document discrepancy", "cross-document discrepancies")}`;
  if (node === "baseline") return `Found ${plural(s.anomalies ?? 0, "unusual year-on-year change")}`;
  if (node === "exceptions") return `Saved ${plural(s.exception_ids ?? 0, "exception record")}`;
  return "";
}

const STAGES = ["extraction", "reconciliation", "baseline", "exceptions", "finish"] as const;
const STAGE_LABELS: Record<string, string> = {
  extraction: "Read documents",
  reconciliation: "Compare figures",
  baseline: "Check against last year",
  exceptions: "Save exceptions",
  finish: "Done",
};

function Pipeline({ steps, current, status, docs }: { steps: { node: string }[]; current: string | null; status: string; docs: number }) {
  const extracted = steps.filter((s) => s.node === "extraction").length;
  // The stage being worked on: the running node if it is a stage, else the furthest stage reached
  // (the supervisor runs between stages).
  const reached = Math.max(0, ...steps.map((s) => STAGES.indexOf(s.node as (typeof STAGES)[number])));
  const currentIdx = STAGES.indexOf(current as (typeof STAGES)[number]);
  const at = status === "succeeded" ? STAGES.length : currentIdx >= 0 ? currentIdx : reached;
  const live = status === "running" || status === "queued";
  return (
    <ol className="pipeline" aria-label="Review progress">
      {STAGES.map((stage, i) => {
        const state = i < at || status === "succeeded" ? "done" : i === at ? (live ? "active" : "stopped") : "todo";
        return (
          <li key={stage} className={`stage stage-${state}`} aria-current={state === "active" ? "step" : undefined}>
            <span className="stage-dot" aria-hidden="true">
              {state === "done" ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span className="stage-label">
              {STAGE_LABELS[stage]}
              {stage === "extraction" && docs > 0 && (
                <small>
                  {Math.min(extracted, docs)} of {docs} documents
                </small>
              )}
            </span>
            {stage === "extraction" && state === "active" && docs > 0 && (
              <span className="stage-meter" aria-hidden="true">
                <span style={{ width: `${(Math.min(extracted, docs) / docs) * 100}%` }} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function RunView() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const run = useAsync(() => api.run(id), [id]);
  usePageTitle(run.data ? `Review of ${run.data.set_id}` : "Review");
  const tools = useAsync(() => api.toolCalls(id), [id]);
  const setId = run.data?.set_id;
  const set = useAsync(() => (setId ? api.set(setId) : Promise.resolve(null)), [setId]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const active = !!run.data && ["queued", "running"].includes(run.data.status);
  usePolling(
    useCallback(() => {
      run.reload();
      tools.reload();
    }, [run.reload, tools.reload]), // eslint-disable-line react-hooks/exhaustive-deps
    active,
    1000,
  );

  async function act(fn: () => Promise<unknown>, done: string) {
    setError(null);
    try {
      await fn();
      run.reload();
      toast(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (run.error) return <ErrorNote message={run.error} onRetry={run.reload} />;
  if (!run.data) return <Loading />;
  const r = run.data;
  const reasons = (r.stats?.route_log ?? []) as { next: string; reason: string }[];
  let supervisorIndex = 0;
  const byType = (r.stats?.findings_by_type ?? {}) as Record<string, number>;
  const docs = set.data?.documents ?? r.stats?.documents ?? 0;
  const llm = r.stats?.llm as { calls: number; input_tokens: number; output_tokens: number } | undefined;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/sets">Document sets</Link> <span aria-hidden="true">/</span> <Link to={`/sets/${r.set_id}`}>{r.set_id}</Link>{" "}
        <span aria-hidden="true">/</span> Review
      </nav>
      <header className="page-head with-actions">
        <div>
          <p className="eyebrow">Review trace</p>
          <h1>Review of {r.set_id}</h1>
          <p className="meta-line">
            <RunStatusTag status={r.status} />
            <span>
              Started by {r.created_by}, {dateTime(r.started_at ?? r.created_at)}
            </span>
            {r.stats?.elapsed_seconds !== undefined && <span>took {r.stats.elapsed_seconds} s</span>}
          </p>
        </div>
        {can(...RUN_ROLES) && (
          <div className="actions">
            {active && (
              <button onClick={() => act(() => api.cancelRun(r.id), "Cancelling. The review stops at the next step.")}>
                <Icon name="stop" size={16} /> Cancel review
              </button>
            )}
            {["failed", "cancelled"].includes(r.status) && (
              <button className="primary" onClick={() => act(() => api.resumeRun(r.id), "Resuming from the last checkpoint.")}>
                <Icon name="refresh" size={16} /> Resume from last checkpoint
              </button>
            )}
          </div>
        )}
      </header>

      {r.error && <ErrorNote message={`The review stopped: ${r.error}`} />}
      <ErrorNote message={error} />

      <Pipeline steps={r.steps} current={r.current_node} status={r.status} docs={docs} />

      {r.status === "succeeded" && (
        <section className="result-card">
          <div className="kpis">
            <Kpi label="Documents read" value={r.stats.documents} hint={`${(r.stats.pages ?? 0).toLocaleString()} PDF pages`} />
            <Kpi label="Figures extracted" value={(r.stats.line_items ?? 0).toLocaleString()} />
            <Kpi label="Exceptions" value={r.stats.exceptions ?? 0} tone={r.stats.exceptions ? "red" : "green"} hint={r.stats.closed_stale ? `${r.stats.closed_stale} earlier ones no longer found` : undefined} />
            <Kpi label="Time" value={`${r.stats.elapsed_seconds} s`} hint={llm ? `${plural(llm.calls, "LLM call")}` : "rules only"} />
          </div>
          {Object.keys(byType).length > 0 && (
            <p>
              Found{" "}
              {Object.entries(byType)
                .map(([k, v]) => `${v} ${(TYPE_NAMES[k] ?? k).toLowerCase()}`)
                .join(", ")}
              .
            </p>
          )}
          {(r.stats.exceptions ?? 0) > 0 ? (
            <Link className="button primary" to={`/queue?set_id=${r.set_id}`}>
              Review the {plural(r.stats.exceptions, "exception")} <Icon name="arrowRight" size={16} />
            </Link>
          ) : (
            <p className="saved">Every figure agrees across the documents in this set.</p>
          )}
          {r.stats.unmapped_labels?.length > 0 && (
            <details className="quiet">
              <summary>{plural(r.stats.unmapped_labels.length, "row label")} not recognised as tracked figures</summary>
              <p>{r.stats.unmapped_labels.join("; ")}</p>
            </details>
          )}
        </section>
      )}

      <section>
        <h2>Steps</h2>
        <ol className="steps">
          {r.steps.map((s) => {
            const reason = s.node === "supervisor" ? reasons[supervisorIndex++]?.reason : undefined;
            return (
              <li key={s.seq} className={`step step-${s.node}`}>
                <span className="step-node">{NODE_NAMES[s.node] ?? s.node}</span>
                <span className="step-what">
                  {describe(s.node, s.summary)}
                  {reason && <small> because {reason}</small>}
                </span>
                <span className="step-time">{duration(s.duration_ms)}</span>
              </li>
            );
          })}
          {active && (
            <li className="step step-pending">
              <span className="spinner" aria-hidden="true" /> {r.current_node ? `${NODE_NAMES[r.current_node] ?? r.current_node} working…` : "Waiting for a worker…"}
            </li>
          )}
        </ol>
      </section>

      <section>
        <h2>
          Tool calls <small>click a row for full input and output</small>
        </h2>
        {tools.data && tools.data.length > 0 ? (
          <div className="table-wrap">
            <table className="ledger compact">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Tool</th>
                  <th>Input</th>
                  <th>Result</th>
                  <th className="num">Attempts</th>
                  <th className="num">Time</th>
                </tr>
              </thead>
              <tbody>
                {tools.data.map((t) => (
                  <Fragment key={t.id}>
                    <tr className={`clickable${t.status === "error" ? " is-error" : ""}${open === t.id ? " is-expanded" : ""}`} onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                      <td>{NODE_NAMES[t.node] ?? t.node}</td>
                      <td className="nowrap mono">{t.tool}</td>
                      <td className="json">{compact(t.input)}</td>
                      <td className="json">{t.status === "error" ? t.error : compact(t.output_summary ?? {})}</td>
                      <td className="num">{t.attempts}</td>
                      <td className="num">{duration(t.duration_ms)}</td>
                    </tr>
                    {open === t.id && (
                      <tr className="json-detail">
                        <td colSpan={6}>
                          <div className="json-columns">
                            <div>
                              <strong>Input</strong>
                              <pre>{JSON.stringify(t.input, null, 2)}</pre>
                            </div>
                            <div>
                              <strong>{t.status === "error" ? "Error" : "Output"}</strong>
                              <pre>{t.status === "error" ? t.error : JSON.stringify(t.output_summary, null, 2)}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="quiet">No tool calls recorded yet.</p>
        )}
      </section>
    </>
  );
}

/** Short one-line rendering of a JSON object for the trace table. */
function compact(obj: Record<string, unknown>): string {
  const text = Object.entries(obj)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}
