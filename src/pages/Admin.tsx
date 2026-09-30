import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ShieldAlert,
  Users,
  Building2,
  History,
  Activity,
  LogOut,
  CheckCircle2,
  XCircle,
  Clock,
  Database,
  Server,
  Mail,
  Layers,
} from "lucide-react";
import { request } from "../lib/api";
import { Button, Logo } from "../components/ui";
import "../dashboard.css";

type Tab = "overview" | "users" | "workspaces" | "activity" | "status";

export default function Admin() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const [summary, setSummary] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [workspacesList, setWorkspacesList] = useState<any[]>([]);
  const [activityList, setActivityList] = useState<any[]>([]);
  const [systemStatus, setSystemStatus] = useState<any>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const res = await request<{ authenticated: boolean }>("/admin/me");
      setAuthenticated(res.authenticated);
      if (res.authenticated) loadTabData(activeTab);
    } catch {
      setAuthenticated(false);
    }
  }

  useEffect(() => {
    if (authenticated) {
      loadTabData(activeTab);
    }
  }, [activeTab, authenticated]);

  async function loadTabData(tab: Tab) {
    try {
      if (tab === "overview") {
        const data = await request<any>("/admin/summary");
        setSummary(data);
      } else if (tab === "users") {
        const data = await request<any>("/admin/users");
        setUsersList(data.users || []);
      } else if (tab === "workspaces") {
        const data = await request<any>("/admin/workspaces");
        setWorkspacesList(data.workspaces || []);
      } else if (tab === "activity") {
        const data = await request<any>("/admin/activity");
        setActivityList(data.activities || []);
      } else if (tab === "status") {
        const data = await request<any>("/admin/status");
        setSystemStatus(data.services || {});
      }
    } catch (e: any) {
      console.error(e);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await request("/admin/login", "POST", { username, password });
      setAuthenticated(true);
    } catch (err: any) {
      setError(err.message || "Invalid System Admin credentials");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await request("/admin/logout", "POST");
    } catch {}
    setAuthenticated(false);
  }

  if (authenticated === null) {
    return <div className="loading-state">Checking System Admin session…</div>;
  }

  if (!authenticated) {
    return (
      <div className="auth-card-container" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="auth-card" style={{ maxWidth: 400, width: "100%", padding: 32 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <Logo />
            <h2 style={{ marginTop: 16, fontSize: 20 }}>System Admin Panel</h2>
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Enter administrator credentials to manage ContentOS</p>
          </div>
          {error && <div className="auth-error" style={{ color: "#ff6b6b", marginBottom: 16, fontSize: 13 }}>{error}</div>}
          <form onSubmit={handleLogin}>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Admin Username</label>
              <input
                type="text"
                className="input"
                style={{ width: "100%" }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Password</label>
              <input
                type="password"
                className="input"
                style={{ width: "100%" }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="primary" style={{ width: "100%" }} disabled={loading}>
              {loading ? "Authenticating…" : "Sign In to Admin Panel"}
            </Button>
          </form>
          <div style={{ marginTop: 24, textAlign: "center" }}>
            <Link to="/app" style={{ fontSize: 13, color: "var(--muted-foreground)" }}>← Return to User Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Logo />
          <span className="badge" style={{ background: "#ff475722", color: "#ff4757", border: "1px solid #ff475744" }}>SYS ADMIN</span>
        </div>
        <nav>
          <div className="nav-group">ADMINISTRATION</div>
          <button className={`nav-item ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
            <Activity size={18} /> Overview
          </button>
          <button className={`nav-item ${activeTab === "users" ? "active" : ""}`} onClick={() => setActiveTab("users")}>
            <Users size={18} /> Users
          </button>
          <button className={`nav-item ${activeTab === "workspaces" ? "active" : ""}`} onClick={() => setActiveTab("workspaces")}>
            <Building2 size={18} /> Workspaces
          </button>
          <button className={`nav-item ${activeTab === "activity" ? "active" : ""}`} onClick={() => setActiveTab("activity")}>
            <History size={18} /> System Audit Log
          </button>
          <button className={`nav-item ${activeTab === "status" ? "active" : ""}`} onClick={() => setActiveTab("status")}>
            <Server size={18} /> System Status
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-row">
            <div>
              <strong>System Admin</strong>
              <small style={{ color: "var(--muted-foreground)" }}>Global Management</small>
            </div>
            <button className="icon-button" onClick={handleLogout} title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="app-topbar">
          <span className="breadcrumb">
            System Admin <span>/</span> <strong>{activeTab.toUpperCase()}</strong>
          </span>
          <div className="row">
            <Link to="/app" className="button secondary" style={{ fontSize: 12 }}>
              Switch to Workspace App →
            </Link>
          </div>
        </header>

        <main className="app-main">
          {activeTab === "overview" && summary && (
            <>
              <div className="page-heading">
                <h1>System Overview</h1>
                <p>Real-time system-wide statistics across all ContentOS tenants.</p>
              </div>
              <div className="overview-stats">
                <div className="stat-card">
                  <div><span className="stat-glyph"><Users size={20} /></span> Total Users</div>
                  <strong>{summary.metrics.totalUsers}</strong>
                  <small>{summary.metrics.verifiedUsers} verified accounts</small>
                </div>
                <div className="stat-card">
                  <div><span className="stat-glyph"><Building2 size={20} /></span> Workspaces</div>
                  <strong>{summary.metrics.activeWorkspaces}</strong>
                  <small>{summary.metrics.workspaceMembers} member assignments</small>
                </div>
                <div className="stat-card">
                  <div><span className="stat-glyph"><Layers size={20} /></span> Draft Posts</div>
                  <strong>{summary.metrics.draftContent}</strong>
                  <small>Content items in draft</small>
                </div>
                <div className="stat-card">
                  <div><span className="stat-glyph"><Clock size={20} /></span> Scheduled Content</div>
                  <strong>{summary.metrics.scheduledContent}</strong>
                  <small>Queued for publishing</small>
                </div>
              </div>

              <div className="panel" style={{ marginTop: 24 }}>
                <div className="panel-title">
                  <h2>Recent System Events</h2>
                </div>
                {summary.recentSystemActivity?.map((a: any) => (
                  <div className="dashboard-row" key={a.id}>
                    <span>
                      <strong>{a.userEmail}</strong> — {a.action}
                    </span>
                    <small>{new Date(a.at).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "users" && (
            <>
              <div className="page-heading">
                <h1>Registered Users</h1>
                <p>System-wide user directory and workspace role assignments.</p>
              </div>
              <div className="panel">
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                      <th style={{ padding: 12 }}>Name</th>
                      <th style={{ padding: 12 }}>Email</th>
                      <th style={{ padding: 12 }}>Verified</th>
                      <th style={{ padding: 12 }}>Workspaces & Roles</th>
                      <th style={{ padding: 12 }}>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersList.map((u) => (
                      <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: 12, fontWeight: 600 }}>{u.name}</td>
                        <td style={{ padding: 12 }}>{u.email}</td>
                        <td style={{ padding: 12 }}>
                          {u.emailVerified ? (
                            <span style={{ color: "#2ed573", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <CheckCircle2 size={14} /> Verified
                            </span>
                          ) : (
                            <span style={{ color: "#ffa502", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Clock size={14} /> Pending
                            </span>
                          )}
                        </td>
                        <td style={{ padding: 12 }}>
                          {u.memberships?.length ? (
                            u.memberships.map((m: any, i: number) => (
                              <div key={i} style={{ fontSize: 11 }}>
                                {m.workspaceName} (<strong>{m.role}</strong>)
                              </div>
                            ))
                          ) : (
                            <span style={{ color: "var(--muted-foreground)" }}>No workspace</span>
                          )}
                        </td>
                        <td style={{ padding: 12, color: "var(--muted-foreground)" }}>
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeTab === "workspaces" && (
            <>
              <div className="page-heading">
                <h1>Tenant Workspaces</h1>
                <p>All active workspace environments across ContentOS.</p>
              </div>
              <div className="panel">
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                      <th style={{ padding: 12 }}>Workspace Name</th>
                      <th style={{ padding: 12 }}>Owner</th>
                      <th style={{ padding: 12 }}>Members</th>
                      <th style={{ padding: 12 }}>Content Items</th>
                      <th style={{ padding: 12 }}>Connected Social</th>
                      <th style={{ padding: 12 }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspacesList.map((w) => (
                      <tr key={w.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: 12, fontWeight: 600 }}>{w.name}</td>
                        <td style={{ padding: 12 }}>{w.owner}</td>
                        <td style={{ padding: 12 }}>{w.memberCount}</td>
                        <td style={{ padding: 12 }}>{w.contentCount}</td>
                        <td style={{ padding: 12 }}>{w.socialAccountsCount}</td>
                        <td style={{ padding: 12, color: "var(--muted-foreground)" }}>
                          {new Date(w.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeTab === "activity" && (
            <>
              <div className="page-heading">
                <h1>Global Activity Log</h1>
                <p>Audit trail of authentication and system operations.</p>
              </div>
              <div className="panel">
                {activityList.map((a) => (
                  <div className="dashboard-row" key={a.id} style={{ padding: "12px 0" }}>
                    <span>
                      <strong>{a.action}</strong> by {a.user}
                      {a.requestId && <small style={{ display: "block", color: "var(--muted-foreground)", fontSize: 11 }}>Request ID: {a.requestId}</small>}
                    </span>
                    <small>{new Date(a.at).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "status" && systemStatus && (
            <>
              <div className="page-heading">
                <h1>System Infrastructure Status</h1>
                <p>Health checks and configuration status for core infrastructure components.</p>
              </div>
              <div className="overview-stats">
                <div className="stat-card">
                  <div><span className="stat-glyph"><Database size={20} /></span> PostgreSQL DB</div>
                  <strong style={{ color: systemStatus.postgres?.status === "healthy" ? "#2ed573" : "#ff4757" }}>
                    {systemStatus.postgres?.status?.toUpperCase()}
                  </strong>
                  <small>{systemStatus.postgres?.note}</small>
                </div>
                <div className="stat-card">
                  <div><span className="stat-glyph"><Server size={20} /></span> Redis Memory Store</div>
                  <strong style={{ color: systemStatus.redis?.status === "healthy" ? "#2ed573" : "#ff4757" }}>
                    {systemStatus.redis?.status?.toUpperCase()}
                  </strong>
                  <small>{systemStatus.redis?.note}</small>
                </div>
                <div className="stat-card">
                  <div><span className="stat-glyph"><Layers size={20} /></span> BullMQ Job Queue</div>
                  <strong style={{ color: systemStatus.queue?.status === "healthy" ? "#2ed573" : "#ffa502" }}>
                    {systemStatus.queue?.status?.toUpperCase()}
                  </strong>
                  <small>{systemStatus.queue?.note}</small>
                </div>
                <div className="stat-card">
                  <div><span className="stat-glyph"><Mail size={20} /></span> Gmail SMTP Service</div>
                  <strong style={{ color: systemStatus.smtp?.status === "configured" ? "#2ed573" : "#ffa502" }}>
                    {systemStatus.smtp?.status?.toUpperCase()}
                  </strong>
                  <small>{systemStatus.smtp?.note}</small>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
