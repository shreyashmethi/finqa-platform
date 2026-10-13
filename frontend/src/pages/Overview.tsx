// Overview: where things stand and what to do next. A role-aware call to action, the headline
// counts, what kinds of discrepancies are open (each bar opens the filtered queue), the sets with
// the most open items and the latest reviews.
import { Link } from "react-router-dom";
import { api } from "../api";
import { ADMIN_ROLES, REVIEW_ROLES, RUN_ROLES, useAuth } from "../auth";
import { Icon } from "../components/Icons";
import { EmptyState, ErrorNote, Kpi, Loading, RunStatusTag } from "../components/Marks";
import { ago, pctOf, plural, TYPE_HINTS, TYPE_NAMES } from "../format";
import { usePageTitle } from "../prefs";
import { useAsync } from "../hooks";

function Bars({
  rows,
  hrefFor,
  tone,
}: {
  rows: { key: string; label: string; value: number; hint?: string }[];
  hrefFor: (key: string) => string;
  tone?: (key: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.key}>
          <Link to={hrefFor(r.key)} title={r.hint}>
            <span className="bar-label">{r.label}</span>
            <span className="bar-track">
              <span className={`bar-fill ${tone?.(r.key) ?? ""}`} style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="bar-value">{r.value.toLocaleString()}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Overview() {
  usePageTitle("Overview");
  const { user, can } = useAuth();
  const summary = useAsync(() => api.summary(), []);
  const sets = useAsync(() => api.sets(), []);
  const runs = useAsync(() => api.runs(undefined, 8), []);

  const error = summary.error ?? sets.error;
  if (error) return <ErrorNote message={error} onRetry={() => (summary.reload(), sets.reload())} />;
  if (!summary.data || !sets.data) return <Loading />;

  const s = summary.data;
  const allSets = sets.data;
  const open = s.exceptions_by_status.open ?? 0;
  const high = s.open_by_severity.high ?? 0;
  const decided =
    (s.exceptions_by_status.accepted ?? 0) + (s.exceptions_by_status.rejected ?? 0) + (s.exceptions_by_status.overridden ?? 0);
  const reviewed = allSets.filter((x) => x.latest_run?.status === "succeeded").length;
  const notReviewed = allSets.filter((x) => !x.latest_run).length;
  const running = (s.runs_by_status.running ?? 0) + (s.runs_by_status.queued ?? 0);
  const attention = [...allSets].filter((x) => x.open_exceptions > 0).sort((a, b) => b.open_exceptions - a.open_exceptions).slice(0, 6);
  const progress = decided + open > 0 ? Math.round((decided / (decided + open)) * 100) : 0;

  // The single most useful next step for this person, given the state of the system.
  let next: { title: string; body: string; to: string; cta: string } | null = null;
  if (allSets.length === 0 && can(...ADMIN_ROLES))
    next = { title: "Upload your first document set", body: "Add a company's documents for one fiscal year and a review starts automatically.", to: "/upload", cta: "Upload documents" };
  else if (open > 0 && can(...REVIEW_ROLES))
    next = {
      title: high > 0 ? `Start with the ${plural(high, "high-severity item")}` : "Work through the open queue",
      body: `${plural(open, "discrepancy", "discrepancies")} ${open === 1 ? "is" : "are"} waiting for a decision. Each one shows the figure in every source document side by side.`,
      to: high > 0 ? "/queue?severity=high" : "/queue",
      cta: "Start reviewing",
    };
  else if (notReviewed > 0 && can(...RUN_ROLES))
    next = { title: `${plural(notReviewed, "set")} not reviewed yet`, body: "Run a review to compare every figure across the documents in each set.", to: "/sets?status=unreviewed", cta: "Choose sets to review" };
  else if (open > 0)
    next = { title: "Browse the open exceptions", body: "Your role can read every exception, its evidence and its audit trail.", to: "/queue", cta: "Open the queue" };

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Overview</p>
        <h1>
          Good {greeting()}, {user ? user.username[0].toUpperCase() + user.username.slice(1) : ""}.
        </h1>
        <p className="lede">
          {open === 0 && reviewed > 0
            ? "Every discrepancy found so far has a decision. Nothing is waiting for review."
            : `${reviewed} of ${plural(allSets.length, "document set")} reviewed. ${plural(open, "discrepancy", "discrepancies")} open.`}
        </p>
      </header>

      {next && (
        <section className="next-step">
          <div>
            <h2>{next.title}</h2>
            <p>{next.body}</p>
          </div>
          <Link className="button primary" to={next.to}>
            {next.cta} <Icon name="arrowRight" size={16} />
          </Link>
        </section>
      )}

      <nav className="workflow" aria-label="Workflow">
        {[
          { n: 1, title: "Upload documents", text: `${plural(allSets.length, "set")} loaded`, to: can(...ADMIN_ROLES) ? "/upload" : "/sets", done: allSets.length > 0 },
          { n: 2, title: "Run reviews", text: `${reviewed} of ${allSets.length} reviewed`, to: "/sets?status=unreviewed", done: allSets.length > 0 && reviewed === allSets.length },
          { n: 3, title: "Decide exceptions", text: open ? `${open.toLocaleString()} waiting` : "Nothing waiting", to: "/queue", done: reviewed > 0 && open === 0 },
          { n: 4, title: "Report & export", text: `${pctOf(decided, decided + open)} decided`, to: "/reports", done: reviewed > 0 && open === 0 && decided > 0 },
        ].map((st) => (
          <Link key={st.n} to={st.to} className={st.done ? "wf-done" : ""}>
            <span className="wf-num">{st.done ? <Icon name="check" size={14} /> : st.n}</span>
            <span className="wf-text">
              <strong>{st.title}</strong>
              <small>{st.text}</small>
            </span>
          </Link>
        ))}
      </nav>

      <div className="kpis">
        <Kpi label="Open exceptions" value={open.toLocaleString()} tone={open ? "red" : "green"} hint={<Link to="/queue">Open the queue</Link>} />
        <Kpi label="High severity open" value={high.toLocaleString()} tone={high ? "red" : undefined} hint={high ? <Link to="/queue?severity=high">Review these first</Link> : "None"} />
        <Kpi label="Decided" value={pctOf(decided, decided + open)} tone="green" hint={`${decided.toLocaleString()} of ${(decided + open).toLocaleString()} have a decision`}>
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </span>
        </Kpi>
        <Kpi
          label="Sets reviewed"
          value={`${reviewed}/${allSets.length}`}
          tone={running ? "blue" : undefined}
          hint={running ? <Link to="/sets?status=running">{plural(running, "review")} running now</Link> : notReviewed ? <Link to="/sets?status=unreviewed">{notReviewed} not reviewed</Link> : "All reviewed"}
        />
      </div>

      {open > 0 && (
        <div className="overview-grid">
          <section className="panel">
            <h2>Open, by kind</h2>
            <Bars
              rows={Object.entries(s.open_by_type)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => ({ key: k, label: TYPE_NAMES[k] ?? k, value: v, hint: TYPE_HINTS[k] }))}
              hrefFor={(k) => `/queue?type=${k}`}
            />
          </section>
          <section className="panel">
            <h2>Open, by severity</h2>
            <Bars
              rows={(["high", "medium", "low"] as const).map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), value: s.open_by_severity[k] ?? 0 }))}
              hrefFor={(k) => `/queue?severity=${k}`}
              tone={(k) => `bar-${k}`}
            />
            <h2 className="panel-sub">Sets with the most open items</h2>
            <ul className="attention">
              {attention.map((x) => (
                <li key={x.id}>
                  <Link to={`/queue?set_id=${x.id}`}>
                    <span>
                      <strong>{x.company_name}</strong>
                      <small>
                        {x.id} · FY{x.fiscal_year}
                      </small>
                    </span>
                    <span className="count-pill">{x.open_exceptions}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>Latest reviews</h2>
          <Link to="/sets">All document sets</Link>
        </div>
        {runs.data && runs.data.length === 0 ? (
          <EmptyState icon="play" title="No reviews yet" action={can(...RUN_ROLES) && <Link className="button primary" to="/sets">Choose a set to review</Link>}>
            A review reads every document in a set and compares each figure across them.
          </EmptyState>
        ) : (
          <ul className="activity">
            {(runs.data ?? []).map((r) => (
              <li key={r.id}>
                <Link to={`/runs/${r.id}`}>
                  <RunStatusTag status={r.status} />
                  <span className="activity-what">
                    <strong>{r.set_id}</strong>
                    {r.status === "succeeded" && ` found ${plural(r.stats?.exceptions ?? 0, "exception")}`}
                    {r.status === "failed" && " stopped with an error"}
                  </span>
                  <span className="activity-when">
                    {r.created_by} · {ago(r.finished_at ?? r.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}
