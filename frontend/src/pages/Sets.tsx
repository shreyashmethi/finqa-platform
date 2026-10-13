// Document sets: what has been loaded, its latest review and how many exceptions are open.
// Filter by review state or fiscal year, start one review or all of the shown ones at once; the
// list refreshes while any review is in progress and shows which agent is working.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ADMIN_ROLES, RUN_ROLES, useAuth } from "../auth";
import { Icon } from "../components/Icons";
import { EmptyState, ErrorNote, Modal, RunStatusTag, SkeletonRows } from "../components/Marks";
import { useToast } from "../components/Toast";
import { ago, NODE_NAMES, plural } from "../format";
import { usePageTitle } from "../prefs";
import { useAsync, usePolling } from "../hooks";
import type { SetSummary } from "../types";

const FILTERS: { key: string; label: string; test: (s: SetSummary) => boolean }[] = [
  { key: "", label: "All", test: () => true },
  { key: "unreviewed", label: "Not reviewed", test: (s) => !s.latest_run },
  { key: "open", label: "Has open items", test: (s) => s.open_exceptions > 0 },
  { key: "clean", label: "Clean", test: (s) => s.latest_run?.status === "succeeded" && s.total_exceptions === 0 },
  { key: "running", label: "Running", test: (s) => isActive(s) },
  { key: "failed", label: "Failed", test: (s) => s.latest_run?.status === "failed" || s.latest_run?.status === "cancelled" },
];

function isActive(s: SetSummary) {
  return !!s.latest_run && ["queued", "running"].includes(s.latest_run.status);
}

export function Sets() {
  usePageTitle("Document sets");
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, reload } = useAsync(() => api.sets(), []);
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const year = params.get("year") ?? "";
  const [filter, setFilter] = useState(params.get("q") ?? "");
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const busy = !!data?.some(isActive);
  usePolling(useCallback(() => reload(), [reload]), busy, 1500);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  useEffect(() => {
    const t = window.setTimeout(() => setParam("q", filter.trim()), 250);
    return () => window.clearTimeout(t);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(ids: string[]) {
    setStarting((cur) => new Set([...cur, ...ids]));
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await api.startRun(id);
        ok += 1;
      } catch (e) {
        errors.push(`${id}: ${(e as Error).message}`);
      }
    }
    setStarting(new Set());
    reload();
    if (errors.length) toast(`${plural(ok, "review")} started. ${errors.length} could not start: ${errors[0]}`, { tone: "error" });
    else toast(ids.length === 1 ? `Review of ${ids[0]} started.` : `${plural(ok, "review")} queued. They run a few at a time.`, { link: { to: "/sets?status=running", label: "Watch" } });
  }

  const all = data ?? [];
  const years = [...new Set(all.map((s) => s.fiscal_year))].sort((a, b) => b - a);
  const test = FILTERS.find((f) => f.key === status)?.test ?? (() => true);
  const needle = (params.get("q") ?? "").toLowerCase();
  const rows = all.filter(
    (s) => test(s) && (!year || String(s.fiscal_year) === year) && (!needle || `${s.id} ${s.company_name} ${s.company_id}`.toLowerCase().includes(needle)),
  );
  const startable = rows.filter((s) => !isActive(s));

  return (
    <>
      <header className="page-head with-actions">
        <div>
          <p className="eyebrow">Library</p>
          <h1>Document sets</h1>
          <p className="lede">Each set is one company's documents for one fiscal year. A review reads every document and compares each figure across them.</p>
        </div>
        {can(...ADMIN_ROLES) && (
          <Link className="button" to="/upload">
            <Icon name="upload" size={16} /> Upload a set
          </Link>
        )}
      </header>

      <div className="tabs" role="tablist" aria-label="Review state">
        {FILTERS.map((f) => {
          const n = all.filter(f.test).length;
          if (f.key && n === 0 && status !== f.key) return null;
          return (
            <button key={f.key} role="tab" aria-selected={status === f.key} className={status === f.key ? "is-active" : ""} onClick={() => setParam("status", f.key)}>
              {f.key === "running" && n > 0 && <span className="pulse" aria-hidden="true" />}
              {f.label}
              {data && <span className="tab-count">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" size={16} />
          <span className="visually-hidden">Find a set</span>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Company name or set ID" />
        </label>
        <label className="select-label">
          <span className="visually-hidden">Fiscal year</span>
          <select value={year} onChange={(e) => setParam("year", e.target.value)}>
            <option value="">Every fiscal year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                FY{y}
              </option>
            ))}
          </select>
        </label>
        {can(...RUN_ROLES) && startable.length > 1 && (
          <button onClick={() => setConfirmBulk(true)} disabled={starting.size > 0}>
            <Icon name="play" size={16} /> Review all {startable.length} shown
          </button>
        )}
      </div>

      <ErrorNote message={error} onRetry={reload} />
      {!data && !error && <SkeletonRows />}
      {data && rows.length === 0 && (
        <EmptyState
          icon="folder"
          title={all.length === 0 ? "No document sets yet" : "No sets match"}
          action={
            all.length === 0 && can(...ADMIN_ROLES) ? (
              <Link className="button primary" to="/upload">
                Upload documents
              </Link>
            ) : all.length > 0 ? (
              <button onClick={() => (setFilter(""), setParams(new URLSearchParams()))}>Clear filters</button>
            ) : undefined
          }
        >
          {all.length === 0 ? "An admin uploads a company's documents for one fiscal year, or loads the test corpus with the seed command." : "Try another filter."}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Set</th>
                <th>Company</th>
                <th className="num">Docs</th>
                <th>Latest review</th>
                <th className="num">Open</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const active = isActive(s) || starting.has(s.id);
                const lr = s.latest_run;
                return (
                  <tr
                    key={s.id}
                    className="clickable"
                    onClick={(ev) => {
                      if ((ev.target as HTMLElement).closest("a, button")) return;
                      navigate(`/sets/${s.id}`);
                    }}
                  >
                    <td>
                      <Link to={`/sets/${s.id}`} className="row-link">
                        {s.id}
                        <small>FY{s.fiscal_year}{s.source === "upload" ? " · uploaded" : ""}</small>
                      </Link>
                    </td>
                    <td>
                      {s.company_name}
                      <small className="sub">
                        {s.company_id} · {s.currency}
                      </small>
                    </td>
                    <td className="num">{s.documents}</td>
                    <td>
                      {lr ? (
                        <Link to={`/runs/${lr.id}`} className="plain-link run-cell">
                          <RunStatusTag status={lr.status} />
                          <small className="sub">
                            {isActive(s) && lr.current_node ? `${NODE_NAMES[lr.current_node] ?? lr.current_node}, step ${lr.step_count}` : ago(lr.finished_at ?? lr.created_at)}
                          </small>
                        </Link>
                      ) : (
                        <span className="quiet">Not reviewed</span>
                      )}
                    </td>
                    <td className="num">
                      {s.open_exceptions > 0 ? (
                        <Link to={`/queue?set_id=${s.id}`} className="count-pill" title="Open these in the queue">
                          {s.open_exceptions}
                        </Link>
                      ) : lr?.status === "succeeded" ? (
                        <span className="clean-mark" title={s.total_exceptions ? "All decided" : "No discrepancies found"}>
                          <Icon name="check" size={16} label={s.total_exceptions ? "All decided" : "Clean"} />
                        </span>
                      ) : (
                        <span className="quiet">–</span>
                      )}
                    </td>
                    <td className="actions-cell">
                      {can(...RUN_ROLES) && (
                        <button className={lr ? "" : "primary"} disabled={active} onClick={() => start([s.id])}>
                          {active ? "Reviewing…" : lr ? "Review again" : "Run review"}
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
      {data && rows.length > 0 && (
        <p className="pager quiet">
          Showing {rows.length} of {all.length} sets
        </p>
      )}

      <Modal
        open={confirmBulk}
        title={`Review ${plural(startable.length, "set")}?`}
        onClose={() => setConfirmBulk(false)}
        footer={
          <>
            <button className="quiet-button" onClick={() => setConfirmBulk(false)}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => {
                setConfirmBulk(false);
                start(startable.map((s) => s.id));
              }}
            >
              Start {plural(startable.length, "review")}
            </button>
          </>
        }
      >
        <p>
          Reviews are queued and run a few at a time in the background. Sets reviewed before are checked again: open exceptions that are no longer found are closed
          automatically, and decisions already recorded are kept.
        </p>
      </Modal>
    </>
  );
}
