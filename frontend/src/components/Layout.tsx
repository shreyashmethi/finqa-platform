// App shell: a dark sidebar (grouped navigation with live counts, quick and saved queue views,
// admin tools), a top bar (global search, live review status, help, user menu with theme) and the
// page area wrapped in an error boundary. On narrow screens the sidebar becomes a drawer opened by
// the hamburger; on wide screens it can collapse to icons. The summary is polled so counts stay
// current everywhere.
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { ADMIN_ROLES, ROLE_NAMES, useAuth } from "../auth";
import { useAsync, useHotkeys, usePolling } from "../hooks";
import { useSavedViews, useSidebarCollapsed, useTheme, type Theme } from "../prefs";
import { CommandPalette } from "./CommandPalette";
import { Icon, type IconName } from "./Icons";
import { Kbd, Modal } from "./Marks";

function NavItem({
  to,
  icon,
  label,
  badge,
  tone,
  end,
  live,
  active,
}: {
  to: string;
  icon: IconName;
  label: string;
  badge?: number;
  tone?: "red" | "blue" | "plain";
  end?: boolean;
  live?: boolean;
  /** Overrides route matching (needed where links differ only by query string). */
  active?: boolean;
}) {
  const location = useLocation();
  // Query-string links (quick and saved views) are active only when the query matches too.
  const [path, search = ""] = to.split("?");
  const exact = active ?? (to.includes("?") ? location.pathname === path && location.search === `?${search}` : undefined);
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => ((exact ?? isActive) ? "nav-item active" : "nav-item")}
      title={label}
      aria-current={exact ? "page" : undefined}
    >
      <Icon name={icon} />
      <span className="nav-label">{label}</span>
      {live && <span className="pulse nav-pulse" aria-hidden="true" />}
      {!!badge && <span className={`nav-badge nav-badge-${tone ?? "red"}`}>{badge > 999 ? "999+" : badge.toLocaleString()}</span>}
    </NavLink>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl K", "Search everything / run a command"],
  ["g then o", "Go to overview"],
  ["g then q", "Go to exception queue"],
  ["g then s", "Go to document sets"],
  ["g then r", "Go to reports"],
  ["/", "Search the current list"],
  ["j / k", "Next / previous item"],
  ["Enter", "Open the highlighted item"],
  ["x", "Select the highlighted row in the queue"],
  ["1 / 2 / 3", "Choose a decision on an exception"],
  ["u", "Back to the queue from an exception"],
  ["?", "Show this list"],
];

const THEMES: { key: Theme; label: string; icon: IconName }[] = [
  { key: "light", label: "Light", icon: "sun" },
  { key: "dark", label: "Dark", icon: "moon" },
  { key: "system", label: "System", icon: "monitor" },
];

/** Small dropdown menu that closes on outside click or Escape. */
function UserMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="user-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar" aria-hidden="true">
          {user.username[0].toUpperCase()}
        </span>
        <span className="user-button-text">
          <strong>{user.username[0].toUpperCase() + user.username.slice(1)}</strong>
          <small>{ROLE_NAMES[user.role]}</small>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            Signed in as <strong>{user.username}</strong>
            <span className={`role-badge role-${user.role}`}>{ROLE_NAMES[user.role]}</span>
          </div>
          <div className="menu-section">
            <span className="menu-label">Theme</span>
            <div className="segmented" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.key} aria-pressed={theme === t.key} className={theme === t.key ? "is-active" : ""} onClick={() => setTheme(t.key)}>
                  <Icon name={t.icon} size={14} /> {t.label}
                </button>
              ))}
            </div>
          </div>
          <button role="menuitem" className="menu-item" onClick={() => (setOpen(false), navigate("/help"))}>
            <Icon name="help" size={16} /> Help & guide
          </button>
          <button role="menuitem" className="menu-item" onClick={() => (setOpen(false), onShortcuts())}>
            <Icon name="keyboard" size={16} /> Keyboard shortcuts <Kbd>?</Kbd>
          </button>
          <button
            role="menuitem"
            className="menu-item danger"
            onClick={() => {
              // An explicit sign-out starts the next person on the overview, not on this page.
              navigate("/login", { replace: true });
              signOut();
            }}
          >
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Keeps one broken page from blanking the whole app; resets when the user navigates. */
class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <Icon name="alert" size={26} />
        </span>
        <h3>Something went wrong on this page</h3>
        <p>{this.state.error.message}</p>
        <div className="empty-action">
          <button className="primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}

export function Layout() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [pendingG, setPendingG] = useState(false);
  const { views, remove } = useSavedViews();

  const summary = useAsync(() => api.summary(), []);
  const s = summary.data;
  const running = (s?.runs_by_status.running ?? 0) + (s?.runs_by_status.queued ?? 0);
  usePolling(
    useCallback(() => summary.reload(), [summary.reload]), // eslint-disable-line react-hooks/exhaustive-deps
    true,
    running > 0 ? 3000 : 20000,
  );
  useEffect(() => {
    summary.reload(); // decisions made on one page change counts shown everywhere
    setDrawer(false);
  }, [location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/⌘+K works even while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useHotkeys(
    {
      "?": () => setHelp(true),
      g: () => {
        setPendingG(true);
        window.setTimeout(() => setPendingG(false), 1200);
      },
      o: () => pendingG && navigate("/"),
      q: () => pendingG && navigate("/queue"),
      s: () => pendingG && navigate("/sets"),
      r: () => pendingG && navigate("/reports"),
    },
    !palette,
  );

  const open = s?.exceptions_by_status.open ?? 0;
  const here = location.pathname + location.search;
  const quickViews: { to: string; label: string; icon: IconName; count?: number }[] = [
    { to: "/queue?severity=high", label: "High severity", icon: "alert", count: s?.open_by_severity.high },
    { to: "/queue?type=missing_item", label: "Missing figures", icon: "file", count: s?.open_by_type.missing_item },
    { to: "/queue?type=baseline_anomaly", label: "Unusual changes", icon: "activity", count: s?.open_by_type.baseline_anomaly },
  ];

  return (
    <div className={`shell${collapsed ? " is-collapsed" : ""}${drawer ? " drawer-open" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="check" size={16} />
            </span>
            <span className="brand-name">Tick &amp; Tie</span>
          </Link>
          <button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setDrawer(false)}>
            <Icon name="x" />
          </button>
        </div>

        <nav className="sidebar-scroll">
          <div className="nav-group">
            <NavItem to="/" end icon="home" label="Overview" />
            <NavItem
              to="/queue"
              icon="inbox"
              label="Exception queue"
              badge={open}
              active={
                location.pathname.startsWith("/exceptions") ||
                (location.pathname === "/queue" && ![...quickViews.map((v) => v.to), ...views.map((v) => `/queue?${v.query}`)].includes(here))
              }
            />
            <NavItem to="/sets" icon="folder" label="Document sets" />
            <NavItem to="/companies" icon="building" label="Companies" />
            <NavItem to="/runs" icon="activity" label="Reviews" badge={running} tone="blue" live={running > 0} />
          </div>

          <div className="nav-group">
            <span className="nav-heading">Insights</span>
            <NavItem to="/reports" icon="chart" label="Reports" />
            <NavItem to="/audit" icon="shield" label="Audit log" />
          </div>

          <div className="nav-group">
            <span className="nav-heading">Quick views</span>
            {quickViews.map((v) => (
              <NavItem key={v.to} to={v.to} icon={v.icon} label={v.label} badge={v.count} tone="plain" />
            ))}
            {views.map((v) => (
              <div key={v.id} className="saved-view">
                <NavItem to={`/queue${v.query ? `?${v.query}` : ""}`} icon="bookmark" label={v.name} />
                <button className="saved-view-remove" aria-label={`Remove saved view ${v.name}`} title="Remove this view" onClick={() => remove(v.id)}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            {views.length === 0 && !collapsed && <p className="nav-tip">Save any filtered queue with “Save view” to pin it here.</p>}
          </div>

          {can(...ADMIN_ROLES) && (
            <div className="nav-group">
              <span className="nav-heading">Administration</span>
              <NavItem to="/upload" icon="upload" label="Upload documents" />
              <NavItem to="/rules" icon="sliders" label="Review rules" />
              <NavItem to="/admin/users" icon="users" label="Users & access" />
              <NavItem to="/admin/system" icon="server" label="System status" />
            </div>
          )}
        </nav>

        <div className="sidebar-foot">
          <NavItem to="/help" icon="help" label="Help & guide" />
          <button className="nav-item collapse-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <Icon name="sidebar" />
            <span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>
      <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />

      <div className="main-col">
        <header className="topbar">
          <button className="icon-button hamburger" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Icon name="menu" />
          </button>
          <button className="search-trigger" onClick={() => setPalette(true)}>
            <Icon name="search" size={16} />
            <span>Search sets, companies, exceptions…</span>
            <kbd className="kbd">Ctrl K</kbd>
          </button>
          <div className="topbar-right">
            {running > 0 && (
              <Link to="/runs?status=running,queued" className="live-pill">
                <span className="pulse" aria-hidden="true" />
                {running === 1 ? "1 review running" : `${running} reviews running`}
              </Link>
            )}
            <button className="icon-button" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setHelp(true)}>
              <Icon name="keyboard" />
            </button>
            <Link to="/help" className="icon-button" title="Help & guide" aria-label="Help & guide">
              <Icon name="help" />
            </Link>
            <UserMenu onShortcuts={() => setHelp(true)} />
          </div>
        </header>
        <main className="page" id="main">
          <PageBoundary resetKey={location.pathname}>
            <Outlet />
          </PageBoundary>
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} onShortcuts={() => setHelp(true)} />
      <Modal open={help} title="Keyboard shortcuts" onClose={() => setHelp(false)}>
        <table className="shortcut-table">
          <tbody>
            {SHORTCUTS.map(([k, what]) => (
              <tr key={k}>
                <td>
                  {k.split(" ").map((part, i, parts) =>
                    // "then" and the "/" between alternatives are words; everything else is a key.
                    part === "then" || (part === "/" && parts.length > 1) ? (
                      <span key={i} className="quiet">
                        {` ${part} `}
                      </span>
                    ) : (
                      <Kbd key={i}>{part}</Kbd>
                    ),
                  )}
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
