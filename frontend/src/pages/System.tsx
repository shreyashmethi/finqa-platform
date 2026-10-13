// System status (admins): API health, storage and AI configuration, data volumes, review
// outcomes and the agents' function-calling tools. Read-only; secrets are never sent by the API.
import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorNote, Kpi, Loading } from "../components/Marks";
import { useAsync, usePolling } from "../hooks";
import { usePageTitle } from "../prefs";

const COUNT_LABELS: Record<string, string> = {
  companies: "Companies",
  document_sets: "Document sets",
  documents: "Documents",
  line_items: "Figures extracted",
  baselines: "Audited baseline rows",
  exceptions: "Exceptions",
  decisions: "Decisions",
  label_mappings: "Cached label mappings",
};

export function System() {
  usePageTitle("System status");
  const status = useAsync(() => api.system(), []);
  const health = useAsync(() => api.health(), []);
  const tools = useAsync(() => api.tools(), []);
  usePolling(
    useCallback(() => {
      status.reload();
      health.reload();
    }, [status.reload, health.reload]), // eslint-disable-line react-hooks/exhaustive-deps
    true,
    10000,
  );

  if (status.error) return <ErrorNote message={status.error} onRetry={status.reload} />;
  if (!status.data) return <Loading />;
  const s = status.data;
  const runs = s.runs_by_status;
  const failed = (runs.failed ?? 0) + (runs.cancelled ?? 0);
  const active = (runs.running ?? 0) + (runs.queued ?? 0);

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Administration</p>
        <h1>System status</h1>
        <p className="lede">Health and configuration of this deployment. Refreshes every 10 seconds.</p>
      </header>

      <div className="kpis">
        <Kpi
          label="API"
          value={<span className={`health ${health.data?.status === "ok" ? "health-ok" : "health-bad"}`}>{health.data?.status === "ok" ? "Healthy" : "Unreachable"}</span>}
          hint={`version ${s.version}`}
        />
        <Kpi label="Reviews running" value={active} tone={active ? "blue" : undefined} hint={`${s.worker_threads} worker threads`} />
        <Kpi label="Reviews finished" value={(runs.succeeded ?? 0).toLocaleString()} tone="green" />
        <Kpi
          label="Failed or cancelled"
          value={failed}
          tone={failed ? "red" : undefined}
          hint={failed ? <Link to="/runs?status=failed,cancelled">Resume them</Link> : "None"}
        />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Configuration</h2>
          </div>
          <dl className="kv">
            <dt>Database</dt>
            <dd>{s.database === "sqlite" ? "SQLite (single host)" : s.database}</dd>
            <dt>AI label mapping</dt>
            <dd>
              {s.llm_enabled ? (
                <span className="health health-ok">On · {s.llm_model}</span>
              ) : (
                <span className="health health-warn">Off (rules only)</span>
              )}
            </dd>
            <dt>AI calls per review</dt>
            <dd>up to {s.llm_max_calls_per_run}</dd>
            <dt>Steps per review</dt>
            <dd>up to {s.max_steps}</dd>
            <dt>Year-on-year threshold</dt>
            <dd>
              {Math.round(s.anomaly_threshold * 100)}% · <Link to="/rules">change</Link>
            </dd>
          </dl>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Data</h2>
          </div>
          <dl className="kv">
            {Object.entries(s.counts).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{COUNT_LABELS[k] ?? k}</dt>
                <dd>{v.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <div className="section-head">
        <h2>Agent tools</h2>
      </div>
      <p className="section-help">The function-calling tools the agents use. Every call is validated against these schemas and logged in each review's trace.</p>
      <ul className="tool-list">
        {(tools.data ?? []).map((t) => (
          <li key={t.name}>
            <code>{t.name}</code>
            <p>{t.description}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
