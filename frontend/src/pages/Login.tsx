// Sign-in. The demo backend issues fixed tokens per role; production would redirect to SSO here.
// Each demo user card says what that role can do, so a first-time visitor can pick the right one.
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Icon } from "../components/Icons";
import { ErrorNote } from "../components/Marks";
import { usePageTitle } from "../prefs";

const DEMO_USERS = [
  { token: "analyst-token", key: "analyst", name: "Alice", role: "Analyst", does: "Runs reviews and decides exceptions" },
  { token: "controller-token", key: "controller", name: "Carol", role: "Finance controller", does: "Oversees the queue and decides" },
  { token: "auditor-token", key: "auditor", name: "Arun", role: "Auditor", does: "Reads everything, changes nothing" },
  { token: "admin-token", key: "admin", name: "Adam", role: "Admin", does: "Uploads documents and sets rules" },
];

export function Login() {
  const { user, signIn, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  usePageTitle("Sign in");

  if (user) return <Navigate to={from} replace />;

  async function go(t: string) {
    setError(null);
    setBusy(t);
    try {
      await signIn(t);
      navigate(from, { replace: true });
    } catch (e) {
      setError((e as Error).message === "Invalid token" ? "That token is not recognised." : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="check" size={16} />
          </span>
          Tick &amp; Tie
        </span>
        <h1>Every figure, ticked and tied.</h1>
        <p className="login-tagline">
          Reconcile the annual report, board deck, press release and management accounts against each other, and against last year's audited numbers, in
          seconds.
        </p>
        <ol className="how-it-works">
          <li>
            <span>
              <strong>Review a document set.</strong> Agents read each document and compare every figure across them.
            </span>
          </li>
          <li>
            <span>
              <strong>See each discrepancy in its source.</strong> The page or cell is shown with the figure highlighted.
            </span>
          </li>
          <li>
            <span>
              <strong>Decide and move on.</strong> Every decision goes on an audit trail.
            </span>
          </li>
        </ol>
      </section>

      <div className="login-side">
        <section className="login-card">
          <h2>Sign in</h2>
          {notice && <p className="notice">{notice}</p>}
          <p className="quiet">Choose a demo user. Each role sees the same data with different permissions.</p>
          <ul className="demo-users">
            {DEMO_USERS.map((u) => (
              <li key={u.token}>
                <button onClick={() => go(u.token)} disabled={!!busy}>
                  <span className="avatar" aria-hidden="true">
                    {u.name[0]}
                  </span>
                  <span className="demo-text">
                    <strong>
                      {u.name} <span className={`role-badge role-${u.key}`}>{u.role}</span>
                    </strong>
                    <small>{u.does}</small>
                  </span>
                  {busy === u.token ? <span className="spinner" aria-hidden="true" /> : <Icon name="chevronRight" />}
                </button>
              </li>
            ))}
          </ul>
          <details className="token-form">
            <summary>Sign in with an access token</summary>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                go(token.trim());
              }}
            >
              <label htmlFor="token" className="visually-hidden">
                Access token
              </label>
              <div className="inline-field">
                <input id="token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="Paste a token" />
                <button type="submit" disabled={!token.trim() || !!busy}>
                  Sign in
                </button>
              </div>
            </form>
          </details>
          <ErrorNote message={error} />
        </section>
      </div>
    </main>
  );
}
