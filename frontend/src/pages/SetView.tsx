// One document set: the company, what the latest review found (with the exceptions inline), the
// files, and the review history. Starting a review takes the user straight to its live trace.
import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { RUN_ROLES, useAuth } from "../auth";
import { Icon } from "../components/Icons";
import { EmptyState, ErrorNote, Kpi, Loading, RunStatusTag, SeverityMark, StatusTag } from "../components/Marks";
import { useToast } from "../components/Toast";
import { docName } from "../components/TickTieStrip";
import { ago, amount, dateTime, metricName, periodName, plural, TYPE_NAMES } from "../format";
import { usePageTitle } from "../prefs";
import { useAsync, usePolling } from "../hooks";

function fileIcon(format: string) {
  return format === "pdf" ? "file" : "table";
}

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function SetView() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const set = useAsync(() => api.set(id), [id]);
  usePageTitle(set.data?.company_name ? `${set.data.company_name} FY${set.data.fiscal_year}` : id);
  const runs = useAsync(() => api.runs(id), [id]);
  const companies = useAsync(() => api.companies(), []);
  const exceptions = useAsync(() => api.exceptions({ set_id: id, status: "open,accepted,rejected,overridden", limit: 200 }), [id]);
  const [starting, setStarting] = useState(false);
  const active = !!runs.data?.some((r) => ["queued", "running"].includes(r.status));
  usePolling(
    useCallback(() => {
      runs.reload();
      set.reload();
      exceptions.reload();
    }, [runs.reload, set.reload, exceptions.reload]), // eslint-disable-line react-hooks/exhaustive-deps
    active,
  );

  async function start() {
    setStarting(true);
    try {
      const run = await api.startRun(id);
      navigate(`/runs/${run.id}`);
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
      runs.reload();
    } finally {
      setStarting(false);
    }
  }

  if (set.error) return <ErrorNote message={set.error} onRetry={set.reload} />;
  if (!set.data) return <Loading />;
  const s = set.data;
  const company = companies.data?.find((c) => c.id === s.company_id);
  const latest = runs.data?.[0];
  const items = exceptions.data?.items ?? [];

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/sets">Document sets</Link> <span aria-hidden="true">/</span> {s.id}
      </nav>
      <header className="page-head with-actions">
        <div>
          <p className="eyebrow">
            {s.id} · fiscal year {s.fiscal_year}
          </p>
          <h1>{s.company_name}</h1>
          <p className="lede">
            {[company?.sector, `reports in ${s.currency}`, company?.fiscal_year_end && `year ends ${company.fiscal_year_end}`].filter(Boolean).join(" · ")}
            {company?.segments.length ? ` · segments: ${company.segments.join(", ")}` : ""}
          </p>
        </div>
        {can(...RUN_ROLES) &&
          (active && latest ? (
            <Link className="button" to={`/runs/${latest.id}`}>
              <span className="pulse" aria-hidden="true" /> Review running, watch it
            </Link>
          ) : (
            <button className="primary" disabled={starting} onClick={start}>
              <Icon name={latest ? "refresh" : "play"} size={16} /> {starting ? "Starting…" : latest ? "Review again" : "Run review"}
            </button>
          ))}
      </header>

      <div className="kpis">
        <Kpi label="Documents" value={s.documents} hint={`${s.document_list.reduce((a, d) => a + (d.pages ?? 0), 0) || "–"} PDF pages`} />
        <Kpi
          label="Open exceptions"
          value={s.open_exceptions}
          tone={s.open_exceptions ? "red" : latest?.status === "succeeded" ? "green" : undefined}
          hint={s.open_exceptions ? <Link to={`/queue?set_id=${s.id}`}>Review them in the queue</Link> : latest ? "Nothing waiting" : "Not reviewed yet"}
        />
        <Kpi label="Decided" value={s.total_exceptions - s.open_exceptions} hint={`of ${plural(s.total_exceptions, "exception")} found`} />
        <Kpi
          label="Latest review"
          value={latest ? <RunStatusTag status={latest.status} /> : "None"}
          hint={latest ? <Link to={`/runs/${latest.id}`}>{ago(latest.finished_at ?? latest.created_at)}, see trace</Link> : undefined}
        />
      </div>

      <section>
        <div className="section-head">
          <h2>Exceptions</h2>
          {items.length > 0 && <Link to={`/queue?set_id=${s.id}&status=all`}>Open in the queue</Link>}
        </div>
        {exceptions.data && items.length === 0 && (
          <EmptyState icon={latest ? "check" : "play"} title={latest ? "No discrepancies found" : "Not reviewed yet"}>
            {latest ? "Every figure agrees across the documents in this set, after rounding." : "Run a review to compare the figures in these documents."}
          </EmptyState>
        )}
        {items.length > 0 && (
          <div className="table-wrap">
            <table className="ledger compact">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Figure</th>
                  <th>Kind</th>
                  <th className="num">Expected → reported</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/exceptions/${e.id}`)}>
                    <td>
                      <SeverityMark severity={e.severity} />
                    </td>
                    <td>
                      <Link to={`/exceptions/${e.id}`} className="row-link">
                        {metricName(e.metric)} <small>{periodName(e.period)}</small>
                      </Link>
                    </td>
                    <td className="nowrap">{TYPE_NAMES[e.type] ?? e.type}</td>
                    <td className="num nowrap">
                      <span className="quiet">{amount(e.expected_value, e.unit)}</span> → {e.type === "missing_item" ? "blank" : amount(e.reported_value, e.unit)}
                    </td>
                    <td>
                      <StatusTag status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Documents</h2>
        <ul className="doc-grid">
          {s.document_list.map((d) => (
            <li key={d.id}>
              <span className={`doc-icon doc-${d.format}`}>
                <Icon name={fileIcon(d.format)} size={20} />
              </span>
              <span className="doc-text">
                <strong>{docName(d.filename)}</strong>
                <small>
                  {d.filename} · {d.pages ? `${plural(d.pages, "page")} · ` : ""}
                  {size(d.size_bytes)}
                </small>
              </span>
              <button
                className="icon-button"
                title={`Download ${d.filename}`}
                aria-label={`Download ${d.filename}`}
                onClick={() => api.download(`/documents/${d.id}/file`, d.filename).catch((e: Error) => toast(e.message, { tone: "error" }))}
              >
                <Icon name="download" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Review history</h2>
        {runs.data && runs.data.length === 0 && <p className="quiet">This set has not been reviewed yet.</p>}
        {runs.data && runs.data.length > 0 && (
          <div className="table-wrap">
            <table className="ledger compact">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>By</th>
                  <th>Status</th>
                  <th className="num">Exceptions</th>
                  <th className="num">Time</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/runs/${r.id}`)}>
                    <td>
                      <Link to={`/runs/${r.id}`} className="row-link">
                        {dateTime(r.created_at)}
                      </Link>
                    </td>
                    <td>{r.created_by}</td>
                    <td>
                      <RunStatusTag status={r.status} />
                    </td>
                    <td className="num">{r.stats?.exceptions ?? ""}</td>
                    <td className="num">{r.stats?.elapsed_seconds !== undefined ? `${r.stats.elapsed_seconds} s` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
