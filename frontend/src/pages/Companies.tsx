// Companies: every reporting entity with its document sets, open exceptions and latest review.
// Admins add companies here; each row opens the company's page.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { ADMIN_ROLES, useAuth } from "../auth";
import { NewCompany } from "../components/CompanyForm";
import { Icon } from "../components/Icons";
import { CompanyLogo, EmptyState, ErrorNote, RunStatusTag, SkeletonRows } from "../components/Marks";
import { useToast } from "../components/Toast";
import { ago } from "../format";
import { useAsync } from "../hooks";
import { usePageTitle } from "../prefs";
import type { SetSummary } from "../types";

export function Companies() {
  usePageTitle("Companies");
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const companies = useAsync(() => api.companies(), []);
  const sets = useAsync(() => api.sets(), []);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [adding, setAdding] = useState(false);

  const bySet = useMemo(() => {
    const m = new Map<string, SetSummary[]>();
    for (const s of sets.data ?? []) m.set(s.company_id, [...(m.get(s.company_id) ?? []), s]);
    return m;
  }, [sets.data]);

  const error = companies.error ?? sets.error;
  const all = companies.data ?? [];
  const sectors = [...new Set(all.map((c) => c.sector).filter(Boolean))].sort() as string[];
  const needle = query.trim().toLowerCase();
  const rows = all
    .filter((c) => (!sector || c.sector === sector) && (!needle || `${c.id} ${c.name} ${c.sector}`.toLowerCase().includes(needle)))
    .map((c) => {
      const cs = bySet.get(c.id) ?? [];
      const latest = cs
        .map((s) => s.latest_run)
        .filter(Boolean)
        .sort((a, b) => (b!.created_at > a!.created_at ? 1 : -1))[0];
      return { c, sets: cs, open: cs.reduce((a, s) => a + s.open_exceptions, 0), latest };
    })
    .sort((a, b) => b.open - a.open || a.c.name.localeCompare(b.c.name));

  return (
    <>
      <header className="page-head with-actions">
        <div>
          <p className="eyebrow">Library</p>
          <h1>Companies</h1>
          <p className="lede">The reporting entities whose documents are reviewed. Open a company to see all of its fiscal years in one place.</p>
        </div>
        {can(...ADMIN_ROLES) && (
          <button className="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add company
          </button>
        )}
      </header>

      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" size={16} />
          <span className="visually-hidden">Find a company</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company name, ID or sector" />
        </label>
        <label className="select-label">
          <span className="visually-hidden">Sector</span>
          <select value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <ErrorNote message={error} onRetry={() => (companies.reload(), sets.reload())} />
      {!companies.data && !error && <SkeletonRows />}
      {companies.data && rows.length === 0 && (
        <EmptyState icon="building" title={all.length ? "No companies match" : "No companies yet"}>
          {all.length ? "Try another search or sector." : "An admin adds a company before uploading its documents."}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Company</th>
                <th>Sector</th>
                <th>Currency</th>
                <th>Year end</th>
                <th className="num">Sets</th>
                <th className="num">Open</th>
                <th>Latest review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, sets: cs, open, latest }) => (
                <tr key={c.id} className="clickable" onClick={(e) => !(e.target as HTMLElement).closest("a") && navigate(`/companies/${c.id}`)}>
                  <td>
                    <span className="company-cell">
                      <CompanyLogo id={c.id} name={c.name} />
                      <Link to={`/companies/${c.id}`} className="row-link">
                        {c.name}
                        <small>{c.id}</small>
                      </Link>
                    </span>
                  </td>
                  <td>{c.sector ?? "–"}</td>
                  <td>{c.currency}</td>
                  <td className="nowrap">{c.fiscal_year_end ?? "–"}</td>
                  <td className="num">{cs.length}</td>
                  <td className="num">
                    {open > 0 ? (
                      <Link to={`/queue?company_id=${c.id}`} className="count-pill">
                        {open}
                      </Link>
                    ) : (
                      <span className="quiet">0</span>
                    )}
                  </td>
                  <td>
                    {latest ? (
                      <span className="run-cell">
                        <RunStatusTag status={latest.status} />
                        <small className="sub">{ago(latest.finished_at ?? latest.created_at)}</small>
                      </span>
                    ) : (
                      <span className="quiet">Not reviewed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {companies.data && rows.length > 0 && <p className="pager">Showing {rows.length} of {all.length} companies</p>}

      {companies.data && (
        <NewCompany
          open={adding}
          onClose={() => setAdding(false)}
          existing={all}
          onCreated={(c) => {
            setAdding(false);
            companies.reload();
            toast(`Added ${c.name}.`, { link: { to: "/upload", label: "Upload its documents" } });
          }}
        />
      )}
    </>
  );
}
