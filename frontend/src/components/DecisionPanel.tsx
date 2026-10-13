// Reviewer actions as one clear choice: confirm the discrepancy, mark it a false positive, or
// record the corrected value. Each choice says what it means and asks only for what it needs; the
// server validates the same rules (a false positive needs a reason; a correction needs a value and
// a reason). Keys 1/2/3 pick a choice and Ctrl/⌘+Enter saves.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { REVIEW_ROLES, useAuth } from "../auth";
import { ago, amount, dateTime, STATUS_NAMES } from "../format";
import { useHotkeys } from "../hooks";
import type { DecisionAction, ExceptionDetail } from "../types";
import { Icon, type IconName } from "./Icons";
import { ErrorNote, Kbd } from "./Marks";

const ACTION_NAMES: Record<DecisionAction, string> = {
  accept: "Confirmed discrepancy",
  reject: "Marked false positive",
  override: "Recorded corrected value",
  comment: "Commented",
  reopen: "Reopened",
};

type Choice = "accept" | "reject" | "override";

const CHOICES: { key: Choice; icon: IconName; title: string; body: string }[] = [
  { key: "accept", icon: "check", title: "Confirm discrepancy", body: "The documents really disagree. The outlier must be fixed before publishing." },
  { key: "reject", icon: "x", title: "False positive", body: "The figures are fine (e.g. a known restatement or a labelling difference). Needs a reason." },
  { key: "override", icon: "pencil", title: "Record the correct value", body: "Write down the right figure and where it comes from, for the team that fixes it." },
];

const MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, mn: 1e6, bn: 1e9, b: 1e9, cr: 1e7, crore: 1e7, l: 1e5, lakh: 1e5 };

/** "1,234.5m" -> 1234500000; "86.4 cr" -> 864000000; "(12.5)" -> -12.5. Returns null if unparseable. */
export function parseAmount(raw: string): number | null {
  let text = raw.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  if (!text) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  const m = text.match(/^([-−]?\d*\.?\d+)([a-z]*)$/);
  if (!m) return null;
  const mult = m[2] ? MULTIPLIERS[m[2]] : 1;
  if (mult === undefined) return null;
  return sign * Number(m[1].replace("−", "-")) * mult;
}

export function DecisionPanel({
  exception,
  onChange,
  autoAdvance,
  setAutoAdvance,
  hasNext,
}: {
  exception: ExceptionDetail;
  onChange: (e: ExceptionDetail, action: DecisionAction) => void;
  autoAdvance: boolean;
  setAutoAdvance: (v: boolean) => void;
  hasNext: boolean;
}) {
  const { can } = useAuth();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [comment, setComment] = useState("");
  const [correctValue, setCorrectValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentOnly, setCommentOnly] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const allowed = can(...REVIEW_ROLES);
  const isOpen = exception.status === "open";
  const unitWord = exception.unit === "persons" ? "people" : exception.unit;

  // Fresh form for each exception.
  useEffect(() => {
    setChoice(null);
    setComment("");
    setCorrectValue("");
    setError(null);
    setCommentOnly(false);
  }, [exception.id]);

  function pick(c: Choice) {
    setChoice(c);
    setCommentOnly(false);
    setError(null);
    if (c === "override" && !correctValue && exception.expected_value !== null) setCorrectValue(String(exception.expected_value));
    // Focus the field the choice needs next.
    window.setTimeout(() => (c === "override" ? valueRef.current?.select() : commentRef.current?.focus()), 0);
  }

  useHotkeys({ "1": () => pick("accept"), "2": () => pick("reject"), "3": () => pick("override") }, allowed && isOpen && !busy);

  if (!allowed) {
    return (
      <p className="quiet role-note">
        <Icon name="alert" size={16} /> Your role can read this exception and its audit trail but cannot record decisions.
      </p>
    );
  }

  async function submit(action: DecisionAction) {
    setError(null);
    if ((action === "reject" || action === "comment") && !comment.trim()) {
      setError(action === "reject" ? "Say why this is a false positive. The reason goes on the audit trail." : "Write a comment first.");
      commentRef.current?.focus();
      return;
    }
    let override_value: number | undefined;
    if (action === "override") {
      const parsed = parseAmount(correctValue);
      if (parsed === null) {
        setError(`Enter the correct value in ${unitWord}, e.g. 1234500000 or 1,234.5m.`);
        valueRef.current?.focus();
        return;
      }
      override_value = parsed;
      if (!comment.trim()) {
        setError("Say where the correct value comes from (document, page or cell).");
        commentRef.current?.focus();
        return;
      }
    }
    setBusy(true);
    try {
      const updated = await api.decide(exception.id, { action, comment: comment.trim() || undefined, override_value });
      setComment("");
      setCorrectValue("");
      setChoice(null);
      setCommentOnly(false);
      onChange(updated, action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (isOpen && choice) submit(choice);
      else if (!isOpen) submit(comment.trim() ? "comment" : "reopen");
    }
  };

  const preview = choice === "override" ? parseAmount(correctValue) : null;
  const last = exception.decisions[exception.decisions.length - 1];

  if (!isOpen) {
    return (
      <section className="decision" aria-label="Decision" onKeyDown={onKeyDown}>
        <div className={`outcome outcome-${exception.status}`}>
          <strong>{STATUS_NAMES[exception.status]}</strong>
          {last && (
            <span>
              by {last.username}, {ago(last.created_at)}
            </span>
          )}
          {exception.override_value !== null && <span>Correct value: {amount(exception.override_value, exception.unit)}</span>}
        </div>
        <label htmlFor="comment" className="field-label">
          Add a note
        </label>
        <textarea id="comment" ref={commentRef} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional: anything the next reviewer should know." />
        <ErrorNote message={error} />
        <div className="actions">
          <button className="primary" disabled={busy || !comment.trim()} onClick={() => submit("comment")}>
            <Icon name="chat" size={16} /> Add note
          </button>
          <button disabled={busy} onClick={() => submit("reopen")}>
            <Icon name="undo" size={16} /> Reopen for review
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="decision" aria-label="Record a decision" onKeyDown={onKeyDown}>
      <div className="choices" role="radiogroup" aria-label="Decision">
        {CHOICES.map((c, i) => (
          <button
            key={c.key}
            role="radio"
            aria-checked={choice === c.key}
            className={`choice choice-${c.key}${choice === c.key ? " is-chosen" : ""}`}
            onClick={() => pick(c.key)}
            disabled={busy}
          >
            <span className="choice-icon">
              <Icon name={c.icon} size={18} />
            </span>
            <span className="choice-text">
              <strong>{c.title}</strong>
              <small>{c.body}</small>
            </span>
            <Kbd>{i + 1}</Kbd>
          </button>
        ))}
      </div>

      {choice === "override" && (
        <div className="field">
          <label htmlFor="correct" className="field-label">
            Correct value ({unitWord})
          </label>
          <input
            id="correct"
            ref={valueRef}
            inputMode="decimal"
            value={correctValue}
            onChange={(e) => setCorrectValue(e.target.value)}
            placeholder="e.g. 1,234.5m or 1234500000"
            aria-describedby="correct-help"
          />
          <small id="correct-help" className="field-help">
            {preview !== null ? (
              <>
                Will be recorded as <strong>{amount(preview, exception.unit)}</strong>.
              </>
            ) : (
              "Use full units, or a suffix: k, m, bn, lakh, cr. Pre-filled with the value most documents agree on."
            )}
          </small>
        </div>
      )}

      {choice && (
        <div className="field">
          <label htmlFor="comment" className="field-label">
            {choice === "accept" ? "Note for the audit trail (optional)" : choice === "reject" ? "Why is this a false positive? (required)" : "Where does the correct value come from? (required)"}
          </label>
          <textarea
            id="comment"
            ref={commentRef}
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              choice === "reject"
                ? "e.g. Deck figure is the restated amount agreed with the auditors."
                : choice === "override"
                  ? "e.g. Annual report p.32, signed off by the auditors."
                  : "e.g. Board deck used the draft figure; annual report is final."
            }
          />
        </div>
      )}

      <ErrorNote message={error} />

      <div className="decision-foot">
        <button className="primary" disabled={busy || !choice} onClick={() => choice && submit(choice)}>
          {busy ? "Saving…" : choice ? `Save: ${CHOICES.find((c) => c.key === choice)!.title.toLowerCase()}` : "Choose a decision above"}
        </button>
        {choice && <span className="quiet hint">or Ctrl/⌘ + Enter</span>}
        {hasNext && (
          <label className="check auto-advance">
            <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
            Then open the next item
          </label>
        )}
      </div>
      {!choice &&
        (commentOnly ? (
          <div className="field comment-only-field">
            <label htmlFor="comment-only" className="field-label">
              Comment (does not change the status)
            </label>
            <textarea id="comment-only" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
            <div className="actions">
              <button disabled={busy || !comment.trim()} onClick={() => submit("comment")}>
                <Icon name="chat" size={16} /> Add comment
              </button>
              <button className="quiet-button" onClick={() => (setCommentOnly(false), setComment(""))}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="link-button comment-only" onClick={() => setCommentOnly(true)}>
            Add a comment without deciding
          </button>
        ))}
    </section>
  );
}

export function AuditTrail({ exception }: { exception: ExceptionDetail }) {
  return (
    <ol className="audit">
      {[...exception.decisions].reverse().map((d) => (
        <li key={d.id} className={`audit-${d.action}`}>
          <p>
            <strong>{d.username}</strong> <span className="quiet">({d.role})</span> {ACTION_NAMES[d.action].toLowerCase()}
            {d.action !== "comment" && d.status_before !== d.status_after && (
              <span className="quiet">
                {" "}
                · {STATUS_NAMES[d.status_before]} → {STATUS_NAMES[d.status_after]}
              </span>
            )}
          </p>
          {d.override_value !== null && <p className="audit-value">Correct value: {amount(d.override_value, exception.unit)}</p>}
          {d.comment && <blockquote>{d.comment}</blockquote>}
          <time dateTime={d.created_at} title={dateTime(d.created_at)}>
            {ago(d.created_at)}
          </time>
        </li>
      ))}
      <li className="audit-found">
        <p>
          Found by the review agents <span className="quiet">· first seen</span>
        </p>
        <time dateTime={exception.created_at} title={dateTime(exception.created_at)}>
          {ago(exception.created_at)}
        </time>
      </li>
    </ol>
  );
}
