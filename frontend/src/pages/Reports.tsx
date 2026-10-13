// Reports: where the open discrepancies are (by company, by kind and severity, by figure) and
// how review is going (decisions by reviewer and outcome). Every number links to the matching
// filtered queue. CSV exports and a print-friendly layout for sharing with the finance team.
import { Link } from "react-router-dom";
import { api } from "../api";
import { Icon } from "../components/Icons";
import { CompanyLogo, ErrorNote, Kpi, Loading } from "../components/Marks";
import { useToast } from "../components/Toast";
import { metricName, pctOf, plural, TYPE_HINTS, TYPE_NAMES } from "../format";
import { useAsync } from "../hooks";
import { usePageTitle } from "../prefs";
import type { Severity } from "../types";

const SEVERITIES: Severity[] = ["high", "medium", "low"];
const ACTION_LABELS: Record<string, string> = {
  accept: "Confirmed",
  reject: "False positive",
  override: "Corrected",
  comment: "Comment",
  reopen: "Reopened",
};

function BarList({ rows, max }: { rows: { key: string; label: React.ReactNode; value: number; to: string; tone?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.key}>
          <Link to={r.to}>
            <span className="bar-label">{r.label}</span>
            <span className="bar-track">
              <span className={`bar-fill ${r.tone ?? ""}`} style={{ width: `${(r.value / top) * 100}%` }} />
            </span>
            <span className="bar-value">{r.value.toLocaleString()}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Reports() {
  usePageTitle("Reports");
  const toast = useToast();
  const reports = useAsync(() => api.reports(), []);
  const summary = useAsync(() => api.summary(), []);

  async function exportCsv(status: string, name: string) {
    try {
      await api.download(`/exceptions/export.csv?status=${status}`, name);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, { tone: "error" });
    }
  }

  const error = reports.error ?? summary.error;
  if (error) return <ErrorNote message={error} onRetry={() => (reports.reload(), summary.reload())} />;
  if (!reports.data || !summary.data) return <Loading />;
  const r = reports.data;
  const s = summary.data;
  const open = s.exceptions_by_status.open ?? 0;
  const decided = (s.exceptions_by_status.accepted ?? 0) + (s.exceptions_by_status.rejected ?? 0) + (s.exceptions_by_status.overridden ?? 0);
  const falsePositives = s.exceptions_by_status.rejected ?? 0;
  const companiesWithOpen = r.by_company.filter((c) => c.open > 0);
  const types = Object.keys(r.type_by_severity).sort(
    (a, b) => Object.values(r.type_by_severity[b]).reduce((x, y) => x + (y ?? 0), 0) - Object.values(r.type_by_severity[a]).reduce((x, y) => x + (y ?? 0), 0),
  );
  const colTotal = (sev: Severity) => types.reduce((a, t) => a + (r.type_by_severity[t][sev] ?? 0), 0);

  return (
    <>
      <header className="page-head with-actions">
        <div>
          <p className="eyebrow">Insights</p>
          <h1>Reports</h1>
          <p className="lede">Where the open discrepancies are and how review is progressing. Click any number to open the matching items.</p>
        </div>
        <div className="actions no-print">
          <button onClick={() => exportCsv("open", "open-exceptions.csv")}>
            <Icon name="download" size={16} /> Open items (CSV)
          </button>
          <button onClick={() => exportCsv("open,accepted,rejected,overridden", "all-exceptions.csv")}>
            <Icon name="download" size={16} /> Everything (CSV)
          </button>
          <button className="quiet-button" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      <div className="kpis">
        <Kpi label="Open exceptions" value={open.toLocaleString()} tone={open ? "red" : "green"} hint={`${plural(companiesWithOpen.length, "company", "companies")} affected`} />
        <Kpi label="High severity open" value={(s.open_by_severity.high ?? 0).toLocaleString()} tone="red" hint={<Link to="/queue?severity=high">Open them</Link>} />
        <Kpi label="Decided" value={decided.toLocaleString()} tone="green" hint={`${pctOf(decided, decided + open)} of all found`}>
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${decided + open ? (decided / (decided + open)) * 100 : 0}%` }} />
          </span>
        </Kpi>
        <Kpi label="False-positive rate" value={decided ? pctOf(falsePositives, decided) : "–"} tone="blue" hint={`${falsePositives} of ${decided} decided`} />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Open by kind and severity</h2>
          </div>
          <div className="table-wrap" style={{ boxShadow: "none" }}>
            <table className="ledger compact matrix">
              <thead>
                <tr>
                  <th>Kind</th>
                  {SEVERITIES.map((sev) => (
                    <th key={sev}>{sev[0].toUpperCase() + sev.slice(1)}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => {
                  const row = r.type_by_severity[t];
                  const total = SEVERITIES.reduce((a, sev) => a + (row[sev] ?? 0), 0);
                  return (
                    <tr key={t}>
                      <td title={TYPE_HINTS[t]}>
                        <Link to={`/queue?type=${t}`} className="row-link">
                          {TYPE_NAMES[t] ?? t}
                        </Link>
                      </td>
                      {SEVERITIES.map((sev) => (
                        <td key={sev}>
                          {row[sev] ? (
                            <Link to={`/queue?type=${t}&severity=${sev}`} className={`heat heat-${sev}`}>
                              {row[sev]}
                            </Link>
                          ) : (
                            <span className="cell-zero">–</span>
                          )}
                        </td>
                      ))}
                      <td>
                        <strong>{total}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  {SEVERITIES.map((sev) => (
                    <td key={sev}>{colTotal(sev)}</td>
                  ))}
                  <td>{open}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Companies with the most open items</h2>
            <Link to="/companies">All companies</Link>
          </div>
          <BarList
            rows={companiesWithOpen.slice(0, 10).map((c) => ({
              key: c.company_id,
              label: (
                <span className="company-cell">
                  <CompanyLogo id={c.company_id} name={c.company_name} /> {c.company_name}
                </span>
              ),
              value: c.open,
              to: `/queue?company_id=${c.company_id}`,
              tone: c.high ? "bar-high" : "bar-medium",
            }))}
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Open by figure</h2>
          </div>
          <BarList
            rows={Object.entries(r.by_metric)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([m, n]) => ({ key: m, label: metricName(m), value: n, to: `/queue?metric=${encodeURIComponent(m)}` }))}
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Review activity</h2>
            <Link to="/audit">Audit log</Link>
          </div>
          {Object.keys(r.decisions_by_user).length === 0 ? (
            <p className="quiet">No decisions recorded yet. They appear here as reviewers work through the queue.</p>
          ) : (
            <>
              <h3 className="panel-sub" style={{ marginTop: 0 }}>
                By reviewer
              </h3>
              <BarList
                rows={Object.entries(r.decisions_by_user)
                  .sort((a, b) => b[1] - a[1])
                  .map(([u, n]) => ({ key: u, label: u[0].toUpperCase() + u.slice(1), value: n, to: `/audit?username=${u}` }))}
              />
              <h3 className="panel-sub">By outcome</h3>
              <BarList
                rows={Object.entries(r.decisions_by_action)
                  .sort((a, b) => b[1] - a[1])
                  .map(([a, n]) => ({
                    key: a,
                    label: ACTION_LABELS[a] ?? a,
                    value: n,
                    to: `/audit?action=${a}`,
                    tone: a === "accept" ? "bar-high" : a === "reject" ? "bar-low" : "",
                  }))}
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
