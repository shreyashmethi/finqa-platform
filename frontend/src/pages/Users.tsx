// Users & access (admins): who can sign in, their role and recent activity, and exactly what each
// role may do. The permission matrix mirrors backend/app/core/security.py, which enforces it.
import { Link } from "react-router-dom";
import { api } from "../api";
import { ROLE_NAMES } from "../auth";
import { Icon } from "../components/Icons";
import { ErrorNote, SkeletonRows } from "../components/Marks";
import { ago, dateTime } from "../format";
import { useAsync } from "../hooks";
import { usePageTitle } from "../prefs";
import type { Role } from "../types";

const ROLES: Role[] = ["analyst", "controller", "auditor", "admin"];
const PERMISSIONS: { what: string; roles: Role[] }[] = [
  { what: "View exceptions, evidence, reports and the audit log", roles: ["analyst", "controller", "auditor", "admin"] },
  { what: "Confirm, reject or correct exceptions", roles: ["analyst", "controller", "admin"] },
  { what: "Start, cancel and resume reviews", roles: ["analyst", "admin"] },
  { what: "Upload documents and add companies", roles: ["admin"] },
  { what: "Change review rules", roles: ["admin"] },
  { what: "Manage users and view system status", roles: ["admin"] },
];

export function Users() {
  usePageTitle("Users & access");
  const users = useAsync(() => api.users(), []);
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Administration</p>
        <h1>Users & access</h1>
        <p className="lede">Who can sign in and what each role is allowed to do. The server enforces these rules on every request.</p>
      </header>

      <div className="info-note">
        <Icon name="alert" size={16} />
        <span>
          This deployment uses demo access tokens configured in <code>FINQA_AUTH_TOKENS</code>. Before going live, replace them with your identity provider
          (SSO/OIDC); only the sign-in step changes.
        </span>
      </div>

      <ErrorNote message={users.error} onRetry={users.reload} />
      {!users.data && !users.error && <SkeletonRows rows={4} />}
      {users.data && (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th className="num">Decisions</th>
                <th className="num">Reviews started</th>
                <th>Last active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.username}>
                  <td>
                    <span className="company-cell">
                      <span className="avatar" aria-hidden="true">
                        {u.username[0].toUpperCase()}
                      </span>
                      <strong>{u.username[0].toUpperCase() + u.username.slice(1)}</strong>
                    </span>
                  </td>
                  <td>
                    <span className={`role-badge role-${u.role}`}>{ROLE_NAMES[u.role]}</span>
                  </td>
                  <td className="num">{u.decisions}</td>
                  <td className="num">{u.runs_started}</td>
                  <td title={dateTime(u.last_active)}>{u.last_active ? ago(u.last_active) : <span className="quiet">Never</span>}</td>
                  <td className="actions-cell">
                    {u.decisions > 0 && <Link to={`/audit?username=${u.username}`}>View decisions</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-head">
        <h2>What each role can do</h2>
      </div>
      <div className="table-wrap">
        <table className="ledger matrix">
          <thead>
            <tr>
              <th>Permission</th>
              {ROLES.map((r) => (
                <th key={r}>{ROLE_NAMES[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p.what}>
                <td>{p.what}</td>
                {ROLES.map((r) => (
                  <td key={r}>
                    {p.roles.includes(r) ? (
                      <span className="perm-yes">
                        <Icon name="check" size={18} label="Allowed" />
                      </span>
                    ) : (
                      <span className="perm-no">
                        <Icon name="x" size={16} label="Not allowed" />
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
