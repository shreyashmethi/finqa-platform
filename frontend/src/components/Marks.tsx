// Small visual vocabulary borrowed from audit practice: a pencil tick for figures that agree and a
// hand-drawn circle for the figure that does not. Severity and status are plain words with a
// coloured rule, so meaning never depends on colour alone. Also the shared page furniture:
// loading skeletons, empty states, KPI tiles and the modal dialog.
import { useEffect, useRef, type ReactNode } from "react";
import { companyColour, initials, STATUS_NAMES } from "../format";
import type { Severity } from "../types";
import { Icon, type IconName } from "./Icons";

export function Tick({ title = "Agrees" }: { title?: string }) {
  return (
    <svg className="tick" viewBox="0 0 24 20" width="22" height="18" role="img" aria-label={title}>
      <path d="M2 11 C5 13, 7 16, 9 18 C12 11, 17 5, 22 2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** A loose red-pencil ellipse drawn around its children (the conflicting figure). */
export function PencilCircle({ children }: { children: ReactNode }) {
  return (
    <span className="pencil-circle">
      {children}
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="M8 22 C6 8, 40 3, 62 4 C88 5, 98 14, 95 24 C92 35, 55 38, 33 36 C14 34, 3 29, 6 18 C8 12, 18 8, 26 7" />
      </svg>
    </span>
  );
}

export function SeverityMark({ severity }: { severity: Severity }) {
  const label = { high: "High", medium: "Medium", low: "Low" }[severity];
  return <span className={`severity severity-${severity}`}>{label}</span>;
}

export function StatusTag({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{STATUS_NAMES[status] ?? status}</span>;
}

export const RUN_STATUS_NAMES: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function RunStatusTag({ status }: { status: string }) {
  const live = status === "running" || status === "queued";
  return (
    <span className={`run-status run-${status}`}>
      {live && <span className="pulse" aria-hidden="true" />}
      {RUN_STATUS_NAMES[status] ?? status}
    </span>
  );
}

export function ErrorNote({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="error-note" role="alert">
      <Icon name="alert" size={16} />
      <span>{message}</span>
      {onRetry && (
        <button className="link-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="quiet loading" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

/** Grey placeholder rows while a table loads, so the layout does not jump. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <span style={{ width: "12%" }} />
          <span style={{ width: "22%" }} />
          <span style={{ width: "14%" }} />
          <span style={{ width: "38%" }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "red" | "green" | "blue" | "ochre";
  children?: ReactNode;
}) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ""}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
      {children}
    </div>
  );
}

/** Keyboard key cap for shortcut hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Modal dialog on the native <dialog> element: focus trapping and Escape come for free. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()} // click on the backdrop closes
      aria-labelledby="modal-title"
    >
      <div className="modal-body">
        <header className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        {children}
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

/** Coloured initials standing in for a company logo. */
export function CompanyLogo({ id, name }: { id: string; name: string }) {
  return (
    <span className="company-logo" style={{ background: companyColour(id) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
