// Reviews: every review run across all sets, newest first, filterable by status and by who
// started it. Refreshes while any review is running; failed or cancelled ones can be resumed.
import { useCallback, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { RUN_ROLES, useAuth } from "../auth";
import { Icon } from "../components/Icons";
import { EmptyState, ErrorNote, RunStatusTag, SkeletonRows } from "../components/Marks";
import { useToast } from "../components/Toast";
import { ago, dateTime, NODE_NAMES } from "../format";
import { useAsync, usePolling } from "../hooks";
import { usePageTitle } from "../prefs";

const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "running,queued", label: "In progress" },
  { key: "succeeded", label: "Finished" },
  { key: "failed,cancelled", label: "Failed or cancelled" },
];
const PAGE = 50;

export function Runs() {
  usePageTitle("Reviews");
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const by = params.get("by") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const [filter, setFilter] = useState("");
  const runs = useAsync(() => api.runList({ status: status || undefined, created_by: by || undefined, limit: PAGE, offset }), [status, by, offset]);
  const summary = useAsync(() => api.summary(), []);
  const live = (runs.data ?? []).some((r) => r.status === "running" || r.status === "queued");
  usePolling(
    useCallback(() => {
      runs.reload();
      summary.reload();
    }, [runs.reload, summary.reload]), // eslint-disable-line react-hooks/exhaustive-deps
    live,
    2000,
  );

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("offset");
    setParams(next);
  }

  async function resume(id: string) {
    try {
      await api.resumeRun(id);
      toast("Resuming from the last checkpoint.");
      runs.reload();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  }

  const counts = summary.data?.runs_by_status ?? {};
  const countFor = (key: string) => (key ? key.split(",").reduce((a, k) => a + (counts[k] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0));
  const needle = filter.trim().toLowerCase();
  const rows = (runs.data ?? []).filter((r) => !needle || `${r.set_id} ${r.created_by}`.toLowerCase().includes(needle));

  return (
    <>
      <header className="page-head with-actions">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Reviews</h1>
          <p className="lede">Every review the agents have run, with what it found and how long it took. Open one to see each agent step and tool call.</p>
        </div>
        {can(...RUN_ROLES) && (
          <Link className="button primary" to="/sets?status=unreviewed">
            <Icon name="play" size={16} /> Start a review
          </Link>
        )}
      </header>

      <div className="tabs" role="tablist" aria-label="Status">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={status === t.key} className={status === t.key ? "is-active" : ""} onClick={() => set("status", t.key)}>
            {t.key === "running,queued" && countFor(t.key) > 0 && <span className="pulse" aria-hidden="true" />}
            {t.label}
            {summary.data && <span className="tab-count">{countFor(t.key).toLocaleString()}</span>}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" size={16} />
          <span className="visually-hidden">Filter</span>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this page by set or user" />
        </label>
        <label className="select-label">
          <span className="visually-hidden">Started by</span>
          <select value={by} onChange={(e) => set("by", e.target.value)}>
            <option value="">Started by anyone</option>
            {[...new Set([...(runs.data ?? []).map((r) => r.created_by), ...(by ? [by] : [])])].sort().map((u) => (
              <option key={u} value={u}>
                {u === "cli" ? "Command line" : u[0].toUpperCase() + u.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorNote message={runs.error} onRetry={runs.reload} />
      {!runs.data && !runs.error && <SkeletonRows />}
      {runs.data && rows.length === 0 && (
        <EmptyState icon="activity" title="No reviews here">
          {status ? "No reviews have this status." : "Start a review from Document sets."}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Status</th>
                <th>Set</th>
                <th>Started</th>
                <th>By</th>
                <th className="num">Figures</th>
                <th className="num">Exceptions</th>
                <th className="num">Time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={(e) => !(e.target as HTMLElement).closest("a, button") && navigate(`/runs/${r.id}`)}>
                  <td>
                    <span className="run-cell">
                      <RunStatusTag status={r.status} />
                      {(r.status === "running" || r.status === "queued") && r.current_node && (
                        <small className="sub">
                          {NODE_NAMES[r.current_node] ?? r.current_node}, step {r.step_count}
                        </small>
                      )}
                    </span>
                  </td>
                  <td>
                    <Link to={`/runs/${r.id}`} className="row-link">
                      {r.set_id}
                    </Link>
                  </td>
                  <td title={dateTime(r.created_at)}>{ago(r.created_at)}</td>
                  <td>{r.created_by}</td>
                  <td className="num">{r.stats?.line_items?.toLocaleString() ?? ""}</td>
                  <td className="num">
                    {r.stats?.exceptions !== undefined ? (
                      r.stats.exceptions > 0 ? (
                        <Link to={`/queue?set_id=${r.set_id}`} className="count-pill">
                          {r.stats.exceptions}
                        </Link>
                      ) : (
                        <span className="clean-mark">
                          <Icon name="check" size={16} label="None" />
                        </span>
                      )
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="num nowrap">{r.stats?.elapsed_seconds !== undefined ? `${r.stats.elapsed_seconds} s` : ""}</td>
                  <td className="actions-cell">
                    {can(...RUN_ROLES) && (r.status === "failed" || r.status === "cancelled") && (
                      <button onClick={() => resume(r.id)}>
                        <Icon name="refresh" size={14} /> Resume
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {runs.data && (runs.data.length === PAGE || offset > 0) && (
        <nav className="pager" aria-label="Pages">
          <span>
            Showing {offset + 1}–{offset + runs.data.length}
          </span>
          <button disabled={offset === 0} onClick={() => set("offset", String(Math.max(0, offset - PAGE)))}>
            <Icon name="chevronLeft" size={16} /> Newer
          </button>
          <button
            disabled={runs.data.length < PAGE}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("offset", String(offset + PAGE));
              setParams(next);
            }}
          >
            Older <Icon name="chevronRight" size={16} />
          </button>
        </nav>
      )}
    </>
  );
}
