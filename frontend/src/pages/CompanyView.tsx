// One company: its profile, open exceptions across all fiscal years (by kind), and each document
// set with its latest review. Links lead to the company-filtered queue and to each set.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { ADMIN_ROLES, RUN_ROLES, useAuth } from "../auth";
import { Icon } from "../components/Icons";
import { CompanyLogo, EmptyState, ErrorNote, Kpi, Loading, RunStatusTag } from "../components/Marks";
import { useToast } from "../components/Toast";
import { ago, plural, TYPE_NAMES } from "../format";
import { useAsync } from "../hooks";
import { usePageTitle } from "../prefs";

export function CompanyView() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const companies = useAsync(() => api.companies(), []);
  const sets = useAsync(() => api.sets(), []);
  const open = useAsync(() => api.exceptions({ company_id: id, status: "open", limit: 500 }), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const company = companies.data?.find((c) => c.id === id);
  usePageTitle(company?.name);

  async function review(setId: string) {
    setBusy(setId);
    try {
      const run = await api.startRun(setId);
      navigate(`/runs/${run.id}`);
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  if (companies.error) return <ErrorNote message={companies.error} onRetry={companies.reload} />;
  if (!companies.data || !sets.data) return <Loading />;
  if (!company)
    return (
      <EmptyState icon="building" title="Company not found" action={<Link className="button" to="/companies">All companies</Link>}>
        There is no company with ID {id}.
      </EmptyState>
    );

  const own = sets.data.filter((s) => s.company_id === id).sort((a, b) => b.fiscal_year - a.fiscal_year || a.id.localeCompare(b.id));
  const items = open.data?.items ?? [];
  const byType = items.reduce<Record<string, number>>((m, e) => ({ ...m, [e.type]: (m[e.type] ?? 0) + 1 }), {});
  const high = items.filter((e) => e.severity === "high").length;
  const reviewed = own.filter((s) => s.latest_run?.status === "succeeded").length;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/companies">Companies</Link> <span aria-hidden="true">/</span> {company.name}
      </nav>
      <header className="page-head with-actions">
        <div>
          <p className="eyebrow">{company.id}</p>
          <h1 className="company-cell">
            <CompanyLogo id={company.id} name={company.name} />
            {company.name}
          </h1>
          <p className="lede">
            {[company.sector, `reports in ${company.currency}`, company.fiscal_year_end && `year ends ${company.fiscal_year_end}`].filter(Boolean).join(" · ")}
            {company.segments.length > 0 && ` · segments: ${company.segments.join(", ")}`}
          </p>
        </div>
        <div className="actions">
          {items.length > 0 && (
            <Link className="button primary" to={`/queue?company_id=${id}`}>
              Review {plural(items.length, "open item")} <Icon name="arrowRight" size={16} />
            </Link>
          )}
          {can(...ADMIN_ROLES) && (
            <Link className="button" to="/upload">
              <Icon name="upload" size={16} /> Upload a year
            </Link>
          )}
        </div>
      </header>

      <div className="kpis">
        <Kpi label="Document sets" value={own.length} hint={`${reviewed} reviewed`} />
        <Kpi label="Open exceptions" value={items.length} tone={items.length ? "red" : "green"} hint={items.length ? "across all years" : "Nothing waiting"} />
        <Kpi label="High severity" value={high} tone={high ? "red" : undefined} hint={high ? <Link to={`/queue?company_id=${id}&severity=high`}>Review these first</Link> : "None open"} />
      </div>

      {Object.keys(byType).length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Open, by kind</h2>
          </div>
          <div className="actions">
            {Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .map(([t, n]) => (
                <Link key={t} to={`/queue?company_id=${id}&type=${t}`} className="filter-pill">
                  {TYPE_NAMES[t] ?? t} <strong>{n}</strong>
                </Link>
              ))}
          </div>
        </section>
      )}

      <div className="section-head">
        <h2>Document sets</h2>
      </div>
      {own.length === 0 ? (
        <EmptyState icon="folder" title="No document sets yet">
          Upload this company's documents for a fiscal year to start reviewing.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Set</th>
                <th className="num">Documents</th>
                <th>Latest review</th>
                <th className="num">Open</th>
                <th className="num">Decided</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {own.map((s) => {
                const active = !!s.latest_run && ["queued", "running"].includes(s.latest_run.status);
                return (
                  <tr key={s.id} className="clickable" onClick={(e) => !(e.target as HTMLElement).closest("a, button") && navigate(`/sets/${s.id}`)}>
                    <td>
                      <Link to={`/sets/${s.id}`} className="row-link">
                        FY{s.fiscal_year}
                        <small>{s.id}</small>
                      </Link>
                    </td>
                    <td className="num">{s.documents}</td>
                    <td>
                      {s.latest_run ? (
                        <Link to={`/runs/${s.latest_run.id}`} className="plain-link run-cell">
                          <RunStatusTag status={s.latest_run.status} />
                          <small className="sub">{ago(s.latest_run.finished_at ?? s.latest_run.created_at)}</small>
                        </Link>
                      ) : (
                        <span className="quiet">Not reviewed</span>
                      )}
                    </td>
                    <td className="num">
                      {s.open_exceptions > 0 ? (
                        <Link to={`/queue?set_id=${s.id}`} className="count-pill">
                          {s.open_exceptions}
                        </Link>
                      ) : (
                        <span className="quiet">0</span>
                      )}
                    </td>
                    <td className="num">{s.total_exceptions - s.open_exceptions}</td>
                    <td className="actions-cell">
                      {can(...RUN_ROLES) && (
                        <button disabled={active || busy === s.id} onClick={() => review(s.id)}>
                          {active ? "Reviewing…" : s.latest_run ? "Review again" : "Run review"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
