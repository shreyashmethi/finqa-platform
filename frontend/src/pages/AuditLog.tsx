// Audit log: every reviewer decision across all exceptions, newest first, filterable by reviewer
// and action, exportable as CSV. Entries are append-only on the server; this page only reads.
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Icon } from "../components/Icons";
import { EmptyState, ErrorNote, SeverityMark, SkeletonRows, StatusTag } from "../components/Marks";
import { amount, ago, dateTime, metricName, periodName } from "../format";
import { useAsync } from "../hooks";
import { usePageTitle } from "../prefs";
import type { AuditEntry } from "../types";

const PAGE = 50;
const ACTIONS: Record<string, string> = {
  accept: "Confirmed",
  reject: "False positive",
  override: "Corrected value",
  comment: "Comment",
  reopen: "Reopened",
};

function toCsv(items: AuditEntry[]): string {
  const cols = ["created_at", "username", "role", "action", "set_id", "metric", "period", "status_before", "status_after", "override_value", "comment"] as const;
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [cols.join(","), ...items.map((e) => cols.map((c) => esc(e[c])).join(","))].join("\n");
}

export function AuditLog() {
  usePageTitle("Audit log");
  const [params, setParams] = useSearchParams();
  const username = params.get("username") ?? "";
  const action = params.get("action") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const log = useAsync(() => api.decisions({ username: username || undefined, action: action || undefined, limit: PAGE, offset }), [username, action, offset]);
  const reports = useAsync(() => api.reports(), []);
  const users = Object.keys(reports.data?.decisions_by_user ?? {}).sort();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("offset");
    setParams(next);
  }

  async function exportCsv() {
    // Fetch the whole filtered log (in pages of 500) so the export is complete, not just this page.
    const all: AuditEntry[] = [];
    for (let off = 0; ; off += 500) {
      const page = await api.decisions({ username: username || undefined, action: action || undefined, limit: 500, offset: off });
      all.push(...page.items);
      if (all.length >= page.total || page.items.length === 0) break;
    }
    const url = URL.createObjectURL(new Blob([toCsv(all)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-log.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const items = log.data?.items ?? [];
  return (
    <>
      <header className="page-head with-actions">
        <div>
          <p className="eyebrow">Insights</p>
          <h1>Audit log</h1>
          <p className="lede">Every decision recorded on an exception: who, when, what changed and why. Entries cannot be edited or deleted.</p>
        </div>
        <button onClick={exportCsv} disabled={!log.data?.total}>
          <Icon name="download" size={16} /> Export CSV
        </button>
      </header>

      <div className="toolbar">
        <div className="chip-group" role="group" aria-label="Action">
          {["", ...Object.keys(ACTIONS)].map((a) => (
            <button key={a || "all"} className={`chip${action === a ? " is-active" : ""}`} aria-pressed={action === a} onClick={() => set("action", a)}>
              {a ? ACTIONS[a] : "All actions"}
            </button>
          ))}
        </div>
        <label className="select-label">
          <span className="visually-hidden">Reviewer</span>
          <select value={username} onChange={(e) => set("username", e.target.value)}>
            <option value="">Every reviewer</option>
            {users.map((u) => (
              <option key={u} value={u}>
                {u[0].toUpperCase() + u.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorNote message={log.error} onRetry={log.reload} />
      {!log.data && !log.error && <SkeletonRows />}
      {log.data && items.length === 0 && (
        <EmptyState icon="shield" title="No decisions yet" action={<Link className="button primary" to="/queue">Open the queue</Link>}>
          {username || action ? "No decisions match these filters." : "Decisions appear here as soon as reviewers confirm, reject or correct exceptions."}
        </EmptyState>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>When</th>
                <th>Reviewer</th>
                <th>Action</th>
                <th>Exception</th>
                <th>Status change</th>
                <th className="wide">Note</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap" title={dateTime(e.created_at)}>
                    {ago(e.created_at)}
                    <small className="sub">{dateTime(e.created_at)}</small>
                  </td>
                  <td>
                    <strong>{e.username}</strong>
                    <small className="sub">{e.role}</small>
                  </td>
                  <td className="nowrap">
                    <strong>{ACTIONS[e.action] ?? e.action}</strong>
                    {e.override_value !== null && <small className="sub">{amount(e.override_value, e.unit)}</small>}
                  </td>
                  <td>
                    <Link to={`/exceptions/${e.exception_id}`} className="row-link">
                      {metricName(e.metric)}, {periodName(e.period)}
                      <small>{e.set_id}</small>
                    </Link>
                    <SeverityMark severity={e.severity} />
                  </td>
                  <td className="nowrap">
                    {e.status_before === e.status_after ? (
                      <span className="quiet">No change</span>
                    ) : (
                      <span className="actions">
                        <StatusTag status={e.status_before} /> <Icon name="arrowRight" size={14} /> <StatusTag status={e.status_after} />
                      </span>
                    )}
                  </td>
                  <td className="wide explanation-cell">{e.comment ?? <span className="quiet">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log.data && log.data.total > 0 && (
        <nav className="pager" aria-label="Pages">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, log.data.total)} of {log.data.total.toLocaleString()}
          </span>
          {log.data.total > PAGE && (
            <>
              <button disabled={offset === 0} onClick={() => set("offset", String(Math.max(0, offset - PAGE)))}>
                <Icon name="chevronLeft" size={16} /> Newer
              </button>
              <button
                disabled={offset + PAGE >= log.data.total}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("offset", String(offset + PAGE));
                  setParams(next);
                }}
              >
                Older <Icon name="chevronRight" size={16} />
              </button>
            </>
          )}
        </nav>
      )}
    </>
  );
}
