// Help & guide: the workflow end to end, what each role does, how to review an exception, what
// each kind of discrepancy and status means, shortcuts, and common questions.
import { Link } from "react-router-dom";
import { ROLE_NAMES, useAuth } from "../auth";
import { Kbd } from "../components/Marks";
import { STATUS_NAMES, TYPE_HINTS, TYPE_NAMES } from "../format";
import { usePageTitle } from "../prefs";
import type { Role } from "../types";

const ROLE_DUTIES: Record<Role, string[]> = {
  analyst: ["Runs reviews on document sets", "Works through the exception queue", "Confirms, rejects or corrects each item"],
  controller: ["Oversees the queue and reports", "Records decisions on exceptions", "Follows progress per company"],
  auditor: ["Reads every exception and its evidence", "Inspects the audit log and review traces", "Cannot change anything"],
  admin: ["Uploads documents and adds companies", "Sets the review rules", "Manages access and watches system status"],
};

const SECTIONS = [
  ["workflow", "How it works"],
  ["roles", "Roles"],
  ["reviewing", "Reviewing an exception"],
  ["kinds", "Kinds of discrepancy"],
  ["statuses", "Severity and status"],
  ["shortcuts", "Keyboard shortcuts"],
  ["faq", "Questions"],
] as const;

export function Help() {
  usePageTitle("Help & guide");
  const { user } = useAuth();
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Help</p>
        <h1>Help & guide</h1>
        <p className="lede">Everything you need to review a company's figures, from upload to sign-off.</p>
      </header>

      <div className="help-layout">
        <nav className="help-toc" aria-label="On this page">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>

        <div>
          <section id="workflow" className="card help-section">
            <h2>How it works</h2>
            <ol>
              <li>
                <strong>Upload</strong> one company's documents for one fiscal year: annual report, board deck, press release, management accounts and KPI file
                (<Link to="/upload">Upload documents</Link>, admins).
              </li>
              <li>
                <strong>Review.</strong> The agents read every document, extract each figure with its exact location, and compare every figure across documents
                and against last year's audited numbers. A typical set takes a few seconds (<Link to="/sets">Document sets</Link>).
              </li>
              <li>
                <strong>Decide.</strong> Each disagreement becomes an exception in the <Link to="/queue">queue</Link>. Open one to see the figure highlighted in
                every source, then confirm it, mark it a false positive, or record the correct value.
              </li>
              <li>
                <strong>Report.</strong> Track progress in <Link to="/reports">Reports</Link>, export CSVs, and use the <Link to="/audit">Audit log</Link> as the
                record of who decided what and why.
              </li>
            </ol>
          </section>

          <section id="roles" className="card help-section">
            <h2>Roles</h2>
            {user && (
              <p>
                You are signed in as <strong>{user.username}</strong> with the <strong>{ROLE_NAMES[user.role]}</strong> role.
              </p>
            )}
            <div className="role-cards">
              {(Object.keys(ROLE_DUTIES) as Role[]).map((r) => (
                <div key={r}>
                  <span className={`role-badge role-${r}`}>{ROLE_NAMES[r]}</span>
                  <ul>
                    {ROLE_DUTIES[r].map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section id="reviewing" className="card help-section">
            <h2>Reviewing an exception</h2>
            <ol>
              <li>The headline compares what most documents say with the outlier, and shows the difference.</li>
              <li>
                <strong>What each document reports</strong> lists every source. A green tick means it agrees; a red circle marks the figure that does not. Click a
                document to see the page or cell with the figure highlighted.
              </li>
              <li>
                Choose a decision: <strong>Confirm discrepancy</strong> (the documents really disagree), <strong>False positive</strong> (needs a reason) or{" "}
                <strong>Record the correct value</strong> (needs the value and its source). Values accept shorthand such as <code>1,234.5m</code> or{" "}
                <code>86.4cr</code>.
              </li>
              <li>With “Then open the next item” ticked, saving takes you straight to the next exception in your list.</li>
              <li>Need many decisions at once? Tick rows in the queue and use the bulk bar.</li>
            </ol>
          </section>

          <section id="kinds" className="card help-section">
            <h2>Kinds of discrepancy</h2>
            <div className="glossary">
              {Object.entries(TYPE_NAMES).map(([k, name]) => (
                <div key={k}>
                  <strong>
                    <Link to={`/queue?type=${k}`}>{name}</Link>
                  </strong>
                  <span>{TYPE_HINTS[k]}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="statuses" className="card help-section">
            <h2>Severity and status</h2>
            <p>
              <strong>Severity</strong> reflects how much the error matters: unit errors, stale figures and sign flips are always high; value differences are high
              or medium depending on size and whether the figure is a headline one (revenue, EBITDA, net income, total assets, cash); missing figures and unusual
              changes are medium.
            </p>
            <ul>
              {Object.entries(STATUS_NAMES).map(([k, v]) => (
                <li key={k}>
                  <strong>{v}</strong>
                  {
                    {
                      open: ": waiting for a decision.",
                      accepted: ": a reviewer confirmed the documents disagree; the source needs fixing.",
                      rejected: ": a reviewer judged it not to be a real problem, with a reason.",
                      overridden: ": a reviewer recorded the correct value and where it comes from.",
                      resolved_by_rerun: ": a later review no longer finds it (the documents were fixed).",
                    }[k]
                  }
                </li>
              ))}
            </ul>
          </section>

          <section id="shortcuts" className="card help-section">
            <h2>Keyboard shortcuts</h2>
            <ul>
              <li>
                <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> search everything and run commands
              </li>
              <li>
                <Kbd>j</Kbd> <Kbd>k</Kbd> move through lists and exceptions, <Kbd>Enter</Kbd> to open
              </li>
              <li>
                <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> choose a decision, <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> to save
              </li>
              <li>
                <Kbd>g</Kbd> then <Kbd>q</Kbd> / <Kbd>s</Kbd> / <Kbd>r</Kbd> / <Kbd>o</Kbd> go to queue, sets, reports, overview
              </li>
              <li>
                <Kbd>?</Kbd> show all shortcuts
              </li>
            </ul>
          </section>

          <section id="faq" className="card help-section">
            <h2>Questions</h2>
            <ul>
              <li>
                <strong>Does re-running a review lose decisions?</strong> No. Decisions are kept. Open exceptions that a re-run no longer finds are closed
                automatically as “No longer found”.
              </li>
              <li>
                <strong>Where do the numbers come from?</strong> From the documents themselves, read by deterministic parsers, so every figure links back to a page
                and position or a spreadsheet cell. AI is only used, when enabled, to recognise unfamiliar row labels.
              </li>
              <li>
                <strong>Can I keep a filtered list?</strong> Yes. Filter the queue and choose <em>Save view</em>; it appears under Quick views in the menu.
              </li>
              <li>
                <strong>How do I share results?</strong> Export CSVs from the queue, Reports or Audit log, or print the Reports page.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
