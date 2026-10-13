// Exception queue: a ruled ledger of discrepancies, most severe first. Filters live in the URL so
// a filtered view can be bookmarked or shared, and the current filter is remembered so the
// exception page can step to the next/previous item in the same list. Rows can be selected for
// bulk decisions, and j/k/Enter/x move through the list from the keyboard.
import { forwardRef, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, qs } from "../api";
import { REVIEW_ROLES, useAuth } from "../auth";
import { Icon } from "../components/Icons";
import { EmptyState, ErrorNote, Modal, SeverityMark, SkeletonRows, StatusTag } from "../components/Marks";
import { useToast } from "../components/Toast";
import { amount, metricName, diffText, periodName, plural, STATUS_NAMES, TYPE_HINTS, TYPE_NAMES } from "../format";
import { useAsync, useDebounced, useHotkeys } from "../hooks";
import { usePageTitle, useSavedViews } from "../prefs";
import type { ExceptionItem } from "../types";

const PAGE = 50;
export const QUEUE_CONTEXT_KEY = "finqa.queue";

/** Remember the queue's filters so the exception page can offer previous/next in the same list. */
export function saveQueueContext(params: URLSearchParams) {
  try {
    sessionStorage.setItem(QUEUE_CONTEXT_KEY, params.toString());
  } catch {
    /* storage unavailable: prev/next falls back to the default queue */
  }
}

const STATUS_TABS = ["open", "accepted", "rejected", "overridden", "all"] as const;

export function Queue() {
  const navigate = useNavigate();
  const toast = useToast();
  usePageTitle("Exception queue");
  const savedViews = useSavedViews();
  const [saving, setSaving] = useState(false);
  const [viewName, setViewName] = useState("");
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const severity = params.get("severity") ?? "";
  const type = params.get("type") ?? "";
  const q = params.get("q") ?? "";
  const setId = params.get("set_id") ?? "";
  const companyId = params.get("company_id") ?? "";
  const metric = params.get("metric") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const [search, setSearch] = useState(q);
  const debounced = useDebounced(search.trim(), 350);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "accept" | "reject">(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canDecide = can(...REVIEW_ROLES);

  const summary = useAsync(() => api.summary(), []);
  const page = useAsync(
    () =>
      api.exceptions({
        status: status === "all" ? undefined : status,
        severity,
        type,
        q,
        set_id: setId,
        company_id: companyId,
        metric,
        limit: PAGE,
        offset,
      }),
    [status, severity, type, q, setId, companyId, metric, offset],
  );
  const items = page.data?.items ?? [];

  useEffect(() => {
    saveQueueContext(params);
  }, [params]);
  useEffect(() => {
    setCursor(0);
    setSelected(new Set());
  }, [status, severity, type, q, setId, companyId, metric, offset]);
  // Search as you type (debounced) instead of requiring Enter.
  useEffect(() => {
    if (debounced !== q) update("q", debounced);
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "status" && value === "open") next.delete("status");
    next.delete("offset");
    setParams(next, { replace: key === "q" });
  }

  function clearFilters() {
    setSearch("");
    setParams(status !== "open" ? new URLSearchParams({ status }) : new URLSearchParams());
  }

  async function exportCsv() {
    const query = qs({ status: status === "all" ? undefined : status, severity, type, set_id: setId, company_id: companyId });
    try {
      await api.download(`/exceptions/export.csv${query}`, "exceptions.csv");
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, { tone: "error" });
    }
  }

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  useHotkeys(
    {
      j: () => setCursor((c) => Math.min(c + 1, items.length - 1)),
      k: () => setCursor((c) => Math.max(c - 1, 0)),
      Enter: () => items[cursor] && navigate(`/exceptions/${items[cursor].id}`),
      x: () => items[cursor] && canDecide && toggle(items[cursor].id),
      "/": () => searchRef.current?.focus(),
      Escape: () => (document.activeElement as HTMLElement | null)?.blur(),
    },
    !bulk,
  );

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const selectable = items.filter((e) => e.status === "open");
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id));

  const s = summary.data;
  const counts: Record<string, number | undefined> = s
    ? {
        ...s.exceptions_by_status,
        all: Object.entries(s.exceptions_by_status)
          .filter(([k]) => k !== "resolved_by_rerun")
          .reduce((a, [, v]) => a + v, 0),
      }
    : {};
  const filtered = !!(severity || type || q || setId || companyId || metric);

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Review</p>
        <h1>Exception queue</h1>
        {s && (
          <p className="lede">
            {(s.exceptions_by_status.open ?? 0) === 0
              ? "Nothing waiting for review."
              : `${plural(s.exceptions_by_status.open ?? 0, "discrepancy", "discrepancies")} waiting for review, ${(s.open_by_severity.high ?? 0).toLocaleString()} of them high severity.`}{" "}
            Open one to see the figure in each source document and record a decision.
          </p>
        )}
      </header>

      <div className="tabs" role="tablist" aria-label="Status">
        {STATUS_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={status === t} className={status === t ? "is-active" : ""} onClick={() => update("status", t)}>
            {t === "all" ? "All" : STATUS_NAMES[t]}
            {counts[t] !== undefined && <span className="tab-count">{counts[t]!.toLocaleString()}</span>}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="chip-group" role="group" aria-label="Severity">
          {(["", "high", "medium", "low"] as const).map((sv) => (
            <button key={sv || "any"} className={`chip${severity === sv ? " is-active" : ""}${sv ? ` chip-${sv}` : ""}`} aria-pressed={severity === sv} onClick={() => update("severity", sv)}>
              {sv ? sv[0].toUpperCase() + sv.slice(1) : "Any severity"}
              {status === "open" && sv && s && <span className="chip-count">{s.open_by_severity[sv] ?? 0}</span>}
            </button>
          ))}
        </div>
        <label className="select-label">
          <span className="visually-hidden">Kind</span>
          <select value={type} onChange={(e) => update("type", e.target.value)} title={TYPE_HINTS[type]}>
            <option value="">Any kind</option>
            {Object.entries(TYPE_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
                {status === "open" && s?.open_by_type[k] ? ` (${s.open_by_type[k]})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <Icon name="search" size={16} />
          <span className="visually-hidden">Search</span>
          <input
            ref={searchRef}
            type="search"
            value={search}
            placeholder="Search set, metric or explanation  ( / )"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button type="button" onClick={() => setSaving(true)} title="Pin this filtered list to the menu">
          <Icon name="bookmark" size={16} /> Save view
        </button>
        <button type="button" onClick={exportCsv} title="Download the filtered list as CSV">
          <Icon name="download" size={16} /> Export
        </button>
      </div>

      {filtered && (
        <div className="active-filters">
          {setId && (
            <span className="filter-pill">
              Set <strong>{setId}</strong>
              <button aria-label="Remove set filter" onClick={() => update("set_id", "")}>
                <Icon name="x" size={14} />
              </button>
            </span>
          )}
          {companyId && (
            <span className="filter-pill">
              Company <strong>{companyId}</strong>
              <button aria-label="Remove company filter" onClick={() => update("company_id", "")}>
                <Icon name="x" size={14} />
              </button>
            </span>
          )}
          {metric && (
            <span className="filter-pill">
              {metricName(metric)}
              <button aria-label="Remove figure filter" onClick={() => update("metric", "")}>
                <Icon name="x" size={14} />
              </button>
            </span>
          )}
          {type && (
            <span className="filter-pill">
              {TYPE_NAMES[type] ?? type}
              <button aria-label="Remove kind filter" onClick={() => update("type", "")}>
                <Icon name="x" size={14} />
              </button>
            </span>
          )}
          {q && (
            <span className="filter-pill">
              “{q}”
              <button aria-label="Clear search" onClick={() => (setSearch(""), update("q", ""))}>
                <Icon name="x" size={14} />
              </button>
            </span>
          )}
          <button className="link-button" onClick={clearFilters}>
            Clear all filters
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <strong>{plural(selected.size, "item")} selected</strong>
          <button className="primary" onClick={() => setBulk("accept")}>
            <Icon name="check" size={16} /> Confirm discrepancies
          </button>
          <button onClick={() => setBulk("reject")}>
            <Icon name="x" size={16} /> Mark false positives
          </button>
          <button className="quiet-button" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <ErrorNote message={page.error} onRetry={page.reload} />
      {page.loading && !page.data && <SkeletonRows />}
      {page.data && items.length === 0 && (
        <EmptyState
          icon={status === "open" && !filtered ? "check" : "search"}
          title={status === "open" && !filtered ? "The queue is clear" : "No exceptions match these filters"}
          action={
            filtered ? (
              <button onClick={clearFilters}>Clear filters</button>
            ) : (
              <Link className="button" to="/sets">
                Go to document sets
              </Link>
            )
          }
        >
          {status === "open" && !filtered
            ? "Every discrepancy found so far has a decision. Run a review on a document set to look for new ones."
            : "Try a different status tab or remove a filter."}
        </EmptyState>
      )}
      {items.length > 0 && (
        <div className={`table-wrap${page.loading ? " is-refreshing" : ""}`}>
          <table className="ledger queue-table">
            <thead>
              <tr>
                {canDecide && (
                  <th className="check-col">
                    <input
                      type="checkbox"
                      aria-label="Select all open items on this page"
                      checked={allSelected}
                      disabled={selectable.length === 0}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((e) => e.id)))}
                    />
                  </th>
                )}
                <th>Severity</th>
                <th>Figure</th>
                <th>Set</th>
                <th>Kind</th>
                <th className="num">Expected → reported</th>
                <th className="wide">What was found</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e, i) => (
                <QueueRow
                  key={e.id}
                  e={e}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  active={i === cursor}
                  checked={selected.has(e.id)}
                  canDecide={canDecide}
                  onToggle={() => toggle(e.id)}
                  onOpen={() => navigate(`/exceptions/${e.id}`)}
                  onHover={() => setCursor(i)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.data && page.data.total > 0 && (
        <nav className="pager" aria-label="Pages">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, page.data.total)} of {page.data.total.toLocaleString()}
          </span>
          {page.data.total > PAGE && (
            <>
              <button disabled={offset === 0} onClick={() => update("offset", String(Math.max(0, offset - PAGE)))}>
                <Icon name="chevronLeft" size={16} /> Previous
              </button>
              <button
                disabled={offset + PAGE >= page.data.total}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("offset", String(offset + PAGE));
                  setParams(next);
                }}
              >
                Next <Icon name="chevronRight" size={16} />
              </button>
            </>
          )}
          <span className="pager-hint">
            <kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> to move, <kbd className="kbd">Enter</kbd> to open
          </span>
        </nav>
      )}

      <Modal
        open={saving}
        title="Save this view"
        onClose={() => setSaving(false)}
        footer={
          <>
            <button className="quiet-button" onClick={() => setSaving(false)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!viewName.trim()}
              onClick={() => {
                const query = new URLSearchParams(params);
                query.delete("offset");
                savedViews.add(viewName.trim(), query.toString());
                setSaving(false);
                setViewName("");
                toast(`Saved “${viewName.trim()}”. Find it under Quick views in the menu.`);
              }}
            >
              Save view
            </button>
          </>
        }
      >
        <p className="quiet">Pins the current tab, filters and search to the menu so you can come back to this list in one click.</p>
        <label htmlFor="view-name" className="field-label">
          Name
        </label>
        <input
          id="view-name"
          style={{ width: "100%" }}
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          placeholder={setId ? `${setId} open items` : type ? `${TYPE_NAMES[type]} to review` : "My review list"}
          autoFocus
        />
      </Modal>

      <BulkDecision
        action={bulk}
        ids={[...selected]}
        onClose={() => setBulk(null)}
        onDone={(ok, failed) => {
          setBulk(null);
          setSelected(new Set());
          page.reload();
          summary.reload();
          toast(
            failed
              ? `${plural(ok, "decision")} recorded, ${failed} failed. Try the failed ones again.`
              : `${plural(ok, "decision")} recorded.`,
            { tone: failed ? "error" : "ok" },
          );
        }}
      />
    </>
  );
}

const QueueRow = forwardRef<
  HTMLTableRowElement,
  {
    e: ExceptionItem;
    active: boolean;
    checked: boolean;
    canDecide: boolean;
    onToggle: () => void;
    onOpen: () => void;
    onHover: () => void;
  }
>(function QueueRow({ e, active, checked, canDecide, onToggle, onOpen, onHover }, ref) {
  const diff = diffText(e.type, e.expected_value, e.reported_value);
  return (
    <tr
      ref={ref}
      className={`clickable${active ? " is-cursor" : ""}${checked ? " is-checked" : ""}`}
      onClick={(ev) => {
        // Let real links, checkboxes and modified clicks behave normally.
        if ((ev.target as HTMLElement).closest("a, input, button") || ev.metaKey || ev.ctrlKey) return;
        onOpen();
      }}
      onMouseEnter={onHover}
    >
      {canDecide && (
        <td className="check-col">
          <input type="checkbox" aria-label={`Select ${metricName(e.metric)} ${e.set_id}`} checked={checked} disabled={e.status !== "open"} onChange={onToggle} />
        </td>
      )}
      <td>
        <SeverityMark severity={e.severity} />
      </td>
      <td>
        <Link to={`/exceptions/${e.id}`} className="row-link">
          {metricName(e.metric)}
          <small>{periodName(e.period)}</small>
        </Link>
      </td>
      <td className="nowrap set-cell">{e.set_id}</td>
      <td className="nowrap" title={TYPE_HINTS[e.type]}>
        {TYPE_NAMES[e.type] ?? e.type}
      </td>
      <td className="num nowrap figures">
        {e.type === "missing_item" ? (
          <>
            {amount(e.expected_value, e.unit)} <span className="quiet">→ blank</span>
          </>
        ) : (
          <>
            <span className="quiet">{amount(e.expected_value, e.unit)}</span>
            <span className="arrow">→</span>
            {amount(e.reported_value, e.unit)}
            {diff && <small className="diff">{diff}</small>}
          </>
        )}
      </td>
      <td className="wide explanation-cell">
        <span className="clamp-2" title={e.explanation}>
          {e.explanation}
        </span>
      </td>
      <td>
        <StatusTag status={e.status} />
      </td>
    </tr>
  );
});

/** Confirm or reject several exceptions at once. A false positive needs a reason, as on one item. */
function BulkDecision({
  action,
  ids,
  onClose,
  onDone,
}: {
  action: null | "accept" | "reject";
  ids: string[];
  onClose: () => void;
  onDone: (ok: number, failed: number) => void;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setComment("");
    setError(null);
    setProgress(0);
  }, [action]);

  const needsComment = action === "reject";
  const title = action === "accept" ? `Confirm ${plural(ids.length, "discrepancy", "discrepancies")}` : `Mark ${plural(ids.length, "item")} as false positives`;

  async function run() {
    if (!action) return;
    if (needsComment && !comment.trim()) {
      setError("Say why these are false positives. The reason is saved on each item's audit trail.");
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await api.decide(id, { action, comment: comment.trim() || undefined });
        ok += 1;
      } catch {
        failed += 1;
      }
      setProgress(ok + failed);
    }
    setBusy(false);
    onDone(ok, failed);
  }

  return (
    <Modal
      open={action !== null}
      title={title}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="quiet-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? `Saving ${progress}/${ids.length}…` : action === "accept" ? "Confirm all" : "Mark all as false positives"}
          </button>
        </>
      }
    >
      <p className="quiet">
        {action === "accept"
          ? "Each item is recorded as a confirmed discrepancy, with your name and the time, on its own audit trail."
          : "Each item is closed as a false positive. Your reason is copied to every item's audit trail."}
      </p>
      <label htmlFor="bulk-comment" className="field-label">
        {needsComment ? "Reason (required)" : "Note for the audit trail (optional)"}
      </label>
      <textarea id="bulk-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
      <ErrorNote message={error} />
    </Modal>
  );
}
