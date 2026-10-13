// Command palette (Ctrl/⌘ + K): one search box for pages, actions, document sets, companies and
// exceptions. Arrow keys move, Enter runs, Escape closes. Sets and companies are fetched once per
// opening and filtered locally; exceptions are searched on the server as the user types.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ADMIN_ROLES, RUN_ROLES, useAuth } from "../auth";
import { metricName, periodName, TYPE_NAMES } from "../format";
import { useDebounced } from "../hooks";
import { useTheme } from "../prefs";
import type { Company, ExceptionItem, SetSummary } from "../types";
import { Icon, type IconName } from "./Icons";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette({ open, onClose, onShortcuts }: { open: boolean; onClose: () => void; onShortcuts: () => void }) {
  const navigate = useNavigate();
  const { can, signOut } = useAuth();
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const q = useDebounced(query.trim(), 200);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
      setQuery("");
      setActive(0);
      api.sets().then(setSets).catch(() => setSets([]));
      api.companies().then(setCompanies).catch(() => setCompanies([]));
      window.setTimeout(() => input.current?.focus(), 0);
    } else if (d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (q.length < 2) {
      setExceptions([]);
      return;
    }
    let live = true;
    api
      .exceptions({ q, limit: 6 })
      .then((p) => live && setExceptions(p.items))
      .catch(() => live && setExceptions([]));
    return () => {
      live = false;
    };
  }, [q]);

  const go = (to: string) => () => {
    onClose();
    navigate(to);
  };

  const items = useMemo<Item[]>(() => {
    const needle = query.trim().toLowerCase();
    const match = (...texts: (string | undefined | null)[]) => !needle || texts.some((t) => t?.toLowerCase().includes(needle));
    const pages: Item[] = [
      { id: "p-overview", group: "Go to", label: "Overview", icon: "home", run: go("/") },
      { id: "p-queue", group: "Go to", label: "Exception queue", icon: "inbox", run: go("/queue") },
      { id: "p-high", group: "Go to", label: "High-severity exceptions", icon: "alert", run: go("/queue?severity=high") },
      { id: "p-sets", group: "Go to", label: "Document sets", icon: "folder", run: go("/sets") },
      { id: "p-companies", group: "Go to", label: "Companies", icon: "building", run: go("/companies") },
      { id: "p-runs", group: "Go to", label: "Reviews", icon: "activity", run: go("/runs") },
      { id: "p-reports", group: "Go to", label: "Reports", icon: "chart", run: go("/reports") },
      { id: "p-audit", group: "Go to", label: "Audit log", icon: "shield", run: go("/audit") },
      { id: "p-help", group: "Go to", label: "Help & guide", icon: "help", run: go("/help") },
      ...(can(...ADMIN_ROLES)
        ? ([
            { id: "p-upload", group: "Go to", label: "Upload documents", icon: "upload", run: go("/upload") },
            { id: "p-rules", group: "Go to", label: "Review rules", icon: "sliders", run: go("/rules") },
            { id: "p-users", group: "Go to", label: "Users & access", icon: "users", run: go("/admin/users") },
            { id: "p-system", group: "Go to", label: "System status", icon: "server", run: go("/admin/system") },
          ] as Item[])
        : []),
    ];
    const actions: Item[] = [
      ...(can(...RUN_ROLES)
        ? [{ id: "a-review", group: "Actions", label: "Review sets that were never reviewed", icon: "play" as IconName, run: go("/sets?status=unreviewed") }]
        : []),
      {
        id: "a-theme",
        group: "Actions",
        label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
        icon: theme === "dark" ? "sun" : "moon",
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
      { id: "a-keys", group: "Actions", label: "Keyboard shortcuts", icon: "keyboard", run: () => (onClose(), onShortcuts()) },
      { id: "a-out", group: "Actions", label: "Sign out", icon: "logout", run: () => (onClose(), navigate("/login", { replace: true }), signOut()) },
    ];
    const setItems: Item[] = needle
      ? sets
          .filter((s) => match(s.id, s.company_name, s.company_id))
          .slice(0, 6)
          .map((s) => ({
            id: `s-${s.id}`,
            group: "Document sets",
            label: `${s.company_name} · FY${s.fiscal_year}`,
            hint: `${s.id}${s.open_exceptions ? ` · ${s.open_exceptions} open` : ""}`,
            icon: "folder",
            run: go(`/sets/${s.id}`),
          }))
      : [];
    const companyItems: Item[] = needle
      ? companies
          .filter((c) => match(c.id, c.name, c.sector))
          .slice(0, 4)
          .map((c) => ({ id: `c-${c.id}`, group: "Companies", label: c.name, hint: `${c.id} · ${c.currency}`, icon: "building", run: go(`/companies/${c.id}`) }))
      : [];
    const excItems: Item[] = exceptions.map((e) => ({
      id: `e-${e.id}`,
      group: "Exceptions",
      label: `${metricName(e.metric)}, ${periodName(e.period)}`,
      hint: `${e.set_id} · ${TYPE_NAMES[e.type] ?? e.type}`,
      icon: "alert",
      run: go(`/exceptions/${e.id}`),
    }));
    return [
      ...pages.filter((p) => match(p.label)),
      ...setItems,
      ...companyItems,
      ...excItems,
      ...actions.filter((a) => match(a.label)),
    ];
  }, [query, sets, companies, exceptions, theme, can]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    document.getElementById(`cmd-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  }

  let lastGroup = "";
  return (
    <dialog ref={dialog} className="palette" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()} aria-label="Search and commands">
      <div className="palette-body" onKeyDown={onKeyDown}>
        <div className="palette-search">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sets, companies, exceptions or pages…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `cmd-${active}` : undefined}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox">
          {items.length === 0 && <li className="palette-empty">No matches for “{query}”.</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <button
                  id={`cmd-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item${i === active ? " is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={it.run}
                >
                  <Icon name={it.icon} size={16} />
                  <span className="palette-label">{it.label}</span>
                  {it.hint && <span className="palette-hint">{it.hint}</span>}
                  {i === active && <Icon name="arrowRight" size={14} />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> open
          </span>
        </div>
      </div>
    </dialog>
  );
}
