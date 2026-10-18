import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  BarChart3,
  History,
  Server,
  ShieldCheck,
  LogOut,
  Search,
  RefreshCw,
  Menu,
  ChevronRight,
  X,
  CreditCard,
  DollarSign,
  CheckCircle2,
  Clock,
  Layers,
  Edit,
  Check,
  AlertTriangle,
} from "lucide-react";
import { request } from "../lib/api";
import { ThemeToggle } from "../lib/appearance";
import { Logo, Button, ModalFrame } from "../components/ui";
import "./admin.css";
import AdminUserActions from "../components/AdminUserActions";
import AdminUserDetailModal from "../components/AdminUserDetailModal";
import { toast } from "sonner";

const sections = [
  ["summary", "Overview", LayoutDashboard],
  ["users", "Users", Users],
  ["subscriptions", "Subscriptions & Trials", CreditCard],
  ["payments", "Payments & Approvals", DollarSign],
  ["plans", "Plans & Pricing", Layers],
  ["workspaces", "Workspaces", Building2],
  ["posts", "Posts", FileText],
  ["analytics", "Analytics", BarChart3],
  ["events", "Activity & Logins", History],
  ["audit-logs", "Admin Audit Trail", ShieldCheck],
  ["status", "System Health", Server],
] as const;

const date = (v: any) => (v ? new Date(v).toLocaleString() : "None");
const human = (v: string) => v.replaceAll("_", " ").toLowerCase();

function Badge({ children, variant = "" }: { children: React.ReactNode; variant?: string }) {
  return <span className={`admin-badge ${variant}`}>{children}</span>;
}

function Bars({ rows, name = "status" }: { rows: any[]; name?: string }) {
  return (
    <div className="admin-bars">
      {rows.length ? (
        rows.map((r) => (
          <div key={r[name]}>
            <span>{human(r[name])}</span>
            <strong>{r.count}</strong>
            <progress max={Math.max(1, ...rows.map((row) => row.count))} value={r.count} />
          </div>
        ))
      ) : (
        <p>No content recorded yet.</p>
      )}
    </div>
  );
}

export default function Admin() {
  const client = useQueryClient();
  const [auth, setAuth] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("summary");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [mobile, setMobile] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Edit plan modal state
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [planMonthly, setPlanMonthly] = useState<number>(0);
  const [planYearly, setPlanYearly] = useState<number>(0);
  const [planLimit, setPlanLimit] = useState<number>(3);

  useEffect(() => {
    let live = true;
    request<any>("/admin/me")
      .then((r) => {
        if (live) {
          setAuth(true);
          setUsername(r.username);
        }
      })
      .catch(() => {
        if (live) setAuth(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const paged = section === "posts" || section === "events" || section === "audit-logs";
  const params = paged
    ? "?" +
      new URLSearchParams({
        page: String(page),
        search: term,
        ...(section === "posts"
          ? { status: filter }
          : { kind: filter || "all" }),
      })
    : section === "payments" && filter
      ? `?status=${filter}`
      : "";

  const query = useQuery<any>({
    queryKey: ["super-admin", section, params],
    queryFn: () => request("/admin/" + section + params),
    enabled: auth === true,
    retry: false,
    staleTime: 15000,
  });

  const stats = useQuery<any>({
    queryKey: ["super-admin", "analytics"],
    queryFn: () => request("/admin/analytics"),
    enabled: auth === true && section === "summary",
    retry: false,
  });

  function go(next: string) {
    setSection(next);
    setSearch("");
    setTerm("");
    setFilter("");
    setPage(1);
    setSelected(null);
    setMobile(false);
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("/admin/login", "POST", { username, password });
      setPassword("");
      setAuth(true);
      toast.success("Welcome back", {
        description: "Signed in to the Super Admin console.",
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await request("/admin/logout", "POST");
      client.removeQueries({ queryKey: ["super-admin"] });
      setAuth(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Payment approval actions
  async function handleVerifyPayment(paymentId: string) {
    try {
      await request(`/admin/payments/${paymentId}/verify`, "POST", { note: "Approved in Super Admin console" });
      toast.success("Payment verified! Subscription activated.");
      query.refetch();
    } catch (err: any) {
      toast.error("Verification failed", { description: err.message });
    }
  }

  async function handleRejectPayment(paymentId: string) {
    const reason = prompt("Enter reason for rejecting this payment:");
    if (!reason) return;
    try {
      await request(`/admin/payments/${paymentId}/reject`, "POST", { reason });
      toast.success("Payment rejected");
      query.refetch();
    } catch (err: any) {
      toast.error("Action failed", { description: err.message });
    }
  }

  async function handleSavePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPlan) return;
    try {
      await request(`/admin/plans/${editingPlan.id}`, "PATCH", {
        monthlyPrice: Number(planMonthly),
        yearlyPrice: Number(planYearly),
        dailyPostLimit: Number(planLimit),
      });
      toast.success("Plan updated successfully");
      setEditingPlan(null);
      query.refetch();
    } catch (err: any) {
      toast.error("Failed to update plan", { description: err.message });
    }
  }

  if (auth === null)
    return <div className="admin-loading">Checking Super Admin access…</div>;

  if (!auth)
    return (
      <div className="admin-login">
        <div>
          <Logo />
          <p className="admin-eyebrow">SUPER ADMIN CONSOLE</p>
          <h1>Welcome back.</h1>
          <p>Dedicated platform administration.</p>
          <form onSubmit={login}>
            <label>
              Username
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in securely"}
            </Button>
          </form>
          <small>Workspace accounts do not grant platform access.</small>
          <ThemeToggle />
        </div>
      </div>
    );

  const title = sections.find((s) => s[0] === section)?.[1] || "Console";
  const data = query.data;
  const analytics = section === "analytics" ? data : stats.data;

  // Records resolution
  const all =
    section === "users"
      ? data?.users
      : section === "subscriptions"
        ? data?.subscriptions
        : section === "payments"
          ? data?.payments
          : section === "plans"
            ? data?.plans
            : section === "workspaces"
              ? data?.workspaces
              : section === "posts"
                ? data?.posts
                : section === "audit-logs"
                  ? data?.logs
                  : data?.events;

  const records = (all || [])
    .filter(
      (r: any) =>
        paged || JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
    )
    .filter(
      (r: any) =>
        section !== "users" ||
        (filter === "DELETED"
          ? r.accountStatus === "DELETED"
          : r.accountStatus !== "DELETED" &&
            (!filter ||
              (filter === "logged"
                ? r.lastLoginAt
                : filter === "verified"
                  ? r.emailVerified
                  : filter === "unverified"
                    ? !r.emailVerified
                    : filter === "trial"
                      ? r.subscriptionStatus === "TRIALING"
                      : filter === "paid"
                        ? ["ACTIVE", "ADMIN_GRANTED"].includes(r.subscriptionStatus)
                        : filter === "expired"
                          ? r.subscriptionStatus === "EXPIRED"
                          : r.accountStatus === filter))),
    );

  const metrics =
    section === "summary" && data?.metrics
      ? [
          ["Registered accounts", data.metrics.totalUsers, `${data.metrics.verifiedUsers} verified emails`, "users"],
          ["Active subscribers", data.metrics.paidSubscribers, `${data.metrics.trialUsers} free trials active`, "subscriptions"],
          ["Verified revenue", `₹${(data.metrics.totalVerifiedRevenue || 0).toLocaleString("en-IN")}`, `₹${(data.metrics.monthlyRevenue || 0).toLocaleString("en-IN")} monthly / ₹${(data.metrics.annualRevenue || 0).toLocaleString("en-IN")} annual`, "payments"],
          ["Pending approvals", data.metrics.pendingPayments, `${data.metrics.expiringSubscriptions} expiring within 7 days`, "payments"],
        ]
      : section === "analytics" && data
        ? [
            ["Unique users", data.users.total, "All registered accounts", "users"],
            ["Users who logged in", data.users.logged_in, "At least one recorded login", "users"],
            ["Logins · 30 days", data.logins.events, `${data.logins.users} distinct users`, "events"],
            ["Total content", data.statuses.reduce((n: number, r: any) => n + r.count, 0), "Across all workspaces", "posts"],
          ]
        : [];

  return (
    <div className="admin-shell">
      {mobile && (
        <button
          className="admin-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`admin-sidebar ${mobile ? "open" : ""}`}>
        <Logo />
        <p className="admin-eyebrow">
          <ShieldCheck size={14} /> SUPER ADMIN
        </p>
        <small className="admin-nav-label">PLATFORM</small>
        <nav aria-label="Admin navigation">
          {sections.map(([id, name, Icon]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              {name}
              {section === id && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>
        <div className="admin-identity">
          <span>A</span>
          <div>
            <strong>{username}</strong>
            <small>Platform administrator</small>
          </div>
          <button title="Log out" aria-label="Log out" onClick={logout} disabled={busy}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button
            className="admin-menu"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <span>
            Administration <ChevronRight size={13} /> <strong>{title}</strong>
          </span>
          <div>
            <ThemeToggle />
            <button
              aria-label="Refresh data"
              onClick={() => {
                query.refetch();
                if (section === "summary") stats.refetch();
              }}
            >
              <RefreshCw size={17} />
            </button>
            <Badge>Super Admin</Badge>
          </div>
        </header>

        <main className="admin-content">
          <div className="admin-heading">
            <p className="admin-eyebrow">CONTENTOS / PLATFORM CONSOLE</p>
            <h1>{title}</h1>
            <p>
              {section === "summary"
                ? "SaaS subscription health, revenue, verified accounts, and recent events."
                : section === "users"
                  ? "Every database account with subscription status, phone number, and administrative controls."
                  : section === "subscriptions"
                    ? "Manage workspace entitlements, free trials, plan assignments, and daily limits."
                    : section === "payments"
                      ? "Review and approve manual subscription payments."
                      : section === "plans"
                        ? "Configure subscription pricing, currency, and daily posting allowances."
                        : section === "audit-logs"
                          ? "Immutable audit trail of administrator actions, overrides, and security events."
                          : `Platform-wide management of ${title.toLowerCase()}.`}
            </p>
          </div>

          {(error || query.error) && (
            <p className="admin-error" role="alert">
              {error || query.error?.message}
            </p>
          )}

          {query.isPending ? (
            <div className="admin-skeleton" role="status" aria-label="Loading data">
              <div />
              <div />
              <div />
            </div>
          ) : query.isError ? null : (
            <>
              {metrics.length > 0 && (
                <div className="admin-metrics">
                  {metrics.map(([name, value, note, to]) => (
                    <button key={String(name)} onClick={() => go(String(to))}>
                      <div>
                        <span>{name}</span>
                        <ChevronRight size={16} />
                      </div>
                      <strong>{value}</strong>
                      <small>{note}</small>
                    </button>
                  ))}
                </div>
              )}

              {/* SECTION: SUMMARY */}
              {section === "summary" && data && (
                <>
                  <div className="admin-insight">
                    <ShieldCheck size={22} />
                    <div>
                      <strong>Full SaaS Access & Entitlement Control</strong>
                      <p>
                        New accounts automatically receive 5-day trials with 3 posts/day. Paid plans unlock Growth (5/day) or Scale (10/day).
                      </p>
                    </div>
                  </div>
                  <div className="admin-grid">
                    <section className="admin-panel">
                      <h2>Plan Distribution</h2>
                      <div className="admin-bars">
                        {(data.planDistribution || []).map((row: any) => (
                          <div key={row.plan_name}>
                            <span>{row.plan_name}</span>
                            <strong>{row.count}</strong>
                            <progress
                              max={Math.max(1, ...(data.planDistribution || []).map((r: any) => r.count))}
                              value={row.count}
                            />
                          </div>
                        ))}
                      </div>
                      <button onClick={() => go("subscriptions")}>Manage all subscriptions →</button>
                    </section>
                    <section className="admin-panel">
                      <h2>Recent System Activity</h2>
                      {data.recentSystemActivity.slice(0, 5).map((r: any) => (
                        <div className="admin-event" key={r.id}>
                          <div>
                            <strong>{human(r.action)}</strong>
                            <small>{r.userEmail}</small>
                          </div>
                          <small>{date(r.at)}</small>
                        </div>
                      ))}
                      <button onClick={() => go("events")}>View all activity →</button>
                    </section>
                  </div>
                </>
              )}

              {/* SECTION: USERS */}
              {section === "users" && (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <Search size={17} />
                      <input
                        aria-label="Search records"
                        placeholder="Search by name, email, phone..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter records"
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">All users</option>
                      <option value="ACTIVE">Active accounts</option>
                      <option value="SUSPENDED">Suspended accounts</option>
                      <option value="trial">Free Trial</option>
                      <option value="paid">Paid subscribers</option>
                      <option value="expired">Expired users</option>
                      <option value="verified">Verified email</option>
                      <option value="unverified">Unverified email</option>
                    </select>
                    <small>{records.length} accounts</small>
                  </div>

                  <div className="admin-table">
                    {!records.length ? (
                      <div className="admin-empty">
                        <Search size={26} />
                        <h3>No accounts match your filters.</h3>
                      </div>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Account</th>
                            <th>Status</th>
                            <th>Verification</th>
                            <th>Workspace roles</th>
                            <th>Plan & Access</th>
                            <th>Posts</th>
                            <th>Logins</th>
                            <th>Last login</th>
                            <th>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.map((r: any) => (
                            <tr key={r.id}>
                              <td>
                                <strong>{r.name}</strong>
                                <small>{r.email}</small>
                                {r.phone && r.phone !== "Not recorded" && (
                                  <small style={{ color: "var(--muted)", display: "block" }}>
                                    {r.phone}
                                  </small>
                                )}
                              </td>
                              <td>
                                <span
                                  className={`admin-status admin-status-${
                                    r.accountStatus === "ACTIVE" ? "active" : "suspended"
                                  }`}
                                >
                                  {r.accountStatus === "ACTIVE" ? "Active" : "Inactive"}
                                </span>
                              </td>
                              <td>
                                <Badge variant={r.emailVerified ? "success" : ""}>
                                  {r.emailVerified ? "Verified" : "Unverified"}
                                </Badge>
                              </td>
                              <td>
                                {r.memberships && r.memberships.length ? (
                                  r.memberships.map((m: any) => (
                                    <small key={m.workspaceId || m.workspaceName}>
                                      {m.workspaceName} · {m.role}
                                    </small>
                                  ))
                                ) : (
                                  <small>No workspace</small>
                                )}
                              </td>
                              <td>
                                <Badge
                                  variant={
                                    r.subscriptionStatus === "ACTIVE" ||
                                    r.subscriptionStatus === "ADMIN_GRANTED"
                                      ? "success"
                                      : r.subscriptionStatus === "TRIALING"
                                        ? "warning"
                                        : "danger"
                                  }
                                >
                                  {r.planName || r.subscriptionStatus}
                                </Badge>
                                <small
                                  style={{
                                    display: "block",
                                    color: "var(--accent)",
                                    marginTop: "3px",
                                    fontWeight: 600,
                                  }}
                                >
                                  {r.dailyPostingLimit} posts/day
                                </small>
                              </td>
                              <td>{r.postCount}</td>
                              <td>{r.loginCount}</td>
                              <td>
                                {r.lastLoginAt ? date(r.lastLoginAt) : "No recorded login"}
                              </td>
                              <td>
                                <AdminUserActions
                                  user={r}
                                  onView={() => setSelectedUserId(r.id)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <p className="admin-note" style={{ marginTop: "14px" }}>
                    Login counts are recorded successful login events. Historical user IP/device and continuous last-active tracking are not available yet.
                  </p>
                </>
              )}

              {/* SECTION: SUBSCRIPTIONS */}
              {section === "subscriptions" && (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <Search size={17} />
                      <input
                        aria-label="Search subscriptions"
                        placeholder="Search workspace or owner..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter status"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="">All statuses</option>
                      <option value="TRIALING">TRIALING</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="ADMIN_GRANTED">ADMIN_GRANTED</option>
                      <option value="EXPIRED">EXPIRED</option>
                      <option value="SUSPENDED">SUSPENDED</option>
                    </select>
                    <small>{records.length} subscriptions</small>
                  </div>

                  <div className="admin-table">
                    {!records.length ? (
                      <div className="admin-empty">
                        <CreditCard size={26} />
                        <h3>No subscriptions match filters.</h3>
                      </div>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Workspace</th>
                            <th>Owner</th>
                            <th>Status</th>
                            <th>Plan</th>
                            <th>Cycle</th>
                            <th>Daily Allowance</th>
                            <th>Current Period End</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.map((s: any) => (
                            <tr key={s.id}>
                              <td>
                                <strong>{s.workspaceName}</strong>
                              </td>
                              <td>{s.ownerEmail}</td>
                              <td>
                                <Badge variant={s.status === "ACTIVE" || s.status === "ADMIN_GRANTED" ? "success" : s.status === "TRIALING" ? "warning" : "danger"}>
                                  {s.status}
                                </Badge>
                              </td>
                              <td>{s.planName}</td>
                              <td>{s.billingPeriod}</td>
                              <td>
                                <strong>{s.dailyPostingLimit} posts/day</strong>
                              </td>
                              <td>{date(s.currentPeriodEnd || s.trialEndsAt)}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => setSelected(s)}
                                  style={{
                                    padding: "5px 10px",
                                    borderRadius: "6px",
                                    background: "var(--surface2)",
                                    border: "1px solid var(--border)",
                                    fontSize: "0.8rem",
                                    cursor: "pointer",
                                  }}
                                >
                                  Details
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}

              {/* SECTION: PAYMENTS */}
              {section === "payments" && (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <Search size={17} />
                      <input
                        placeholder="Search reference or user..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="">All payment statuses</option>
                      <option value="PENDING">PENDING (Action required)</option>
                      <option value="VERIFIED">VERIFIED</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>
                    <small>{records.length} requests</small>
                  </div>

                  <div className="admin-table">
                    {!records.length ? (
                      <div className="admin-empty">
                        <DollarSign size={26} />
                        <h3>No payment records.</h3>
                      </div>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Workspace</th>
                            <th>User</th>
                            <th>Plan</th>
                            <th>Amount</th>
                            <th>Billing Cycle</th>
                            <th>Reference / UTR</th>
                            <th>Status</th>
                            <th>Submitted</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.map((p: any) => (
                            <tr key={p.id}>
                              <td>
                                <strong>{p.workspaceName}</strong>
                              </td>
                              <td>{p.userEmail}</td>
                              <td>{p.planName}</td>
                              <td>
                                <strong style={{ color: "var(--accent)" }}>
                                  ₹{p.amount.toLocaleString("en-IN")}
                                </strong>
                              </td>
                              <td>{p.billingPeriod}</td>
                              <td>
                                <code style={{ fontSize: "0.85rem" }}>
                                  {p.providerReference}
                                </code>
                              </td>
                              <td>
                                <Badge variant={p.status === "VERIFIED" ? "success" : p.status === "PENDING" ? "warning" : "danger"}>
                                  {p.status}
                                </Badge>
                              </td>
                              <td>{date(p.createdAt)}</td>
                              <td>
                                {p.status === "PENDING" ? (
                                  <div style={{ display: "flex", gap: "6px" }}>
                                    <button
                                      type="button"
                                      onClick={() => handleVerifyPayment(p.id)}
                                      style={{
                                        padding: "4px 8px",
                                        borderRadius: "6px",
                                        background: "#22c55e",
                                        color: "#ffffff",
                                        border: "none",
                                        fontSize: "0.78rem",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                      }}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRejectPayment(p.id)}
                                      style={{
                                        padding: "4px 8px",
                                        borderRadius: "6px",
                                        background: "rgba(239, 68, 68, 0.15)",
                                        color: "#ef4444",
                                        border: "1px solid rgba(239, 68, 68, 0.3)",
                                        fontSize: "0.78rem",
                                        cursor: "pointer",
                                      }}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : (
                                  <small style={{ color: "var(--muted)" }}>
                                    {p.verifiedBy ? `By ${p.verifiedBy}` : "Completed"}
                                  </small>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}

              {/* SECTION: PLANS */}
              {section === "plans" && (
                <div className="admin-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Monthly Price</th>
                        <th>Yearly Price</th>
                        <th>Daily Limit</th>
                        <th>Active</th>
                        <th>Features</th>
                        <th>Edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(records || []).map((pl: any) => (
                        <tr key={pl.id}>
                          <td>
                            <strong>{pl.code}</strong>
                          </td>
                          <td>{pl.name}</td>
                          <td>₹{pl.monthlyPrice.toLocaleString("en-IN")} / mo</td>
                          <td>
                            {pl.yearlyPrice ? `₹${pl.yearlyPrice.toLocaleString("en-IN")} / yr` : "Not set"}
                          </td>
                          <td>
                            <strong>{pl.dailyPostLimit} posts/day</strong>
                          </td>
                          <td>
                            <Badge variant={pl.isActive ? "success" : "danger"}>
                              {pl.isActive ? "Active" : "Disabled"}
                            </Badge>
                          </td>
                          <td>
                            <small>{(pl.features || []).join(", ")}</small>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPlan(pl);
                                setPlanMonthly(pl.monthlyPrice);
                                setPlanYearly(pl.yearlyPrice || pl.monthlyPrice * 10);
                                setPlanLimit(pl.dailyPostLimit);
                              }}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "6px",
                                background: "var(--surface2)",
                                border: "1px solid var(--border)",
                                fontSize: "0.8rem",
                                cursor: "pointer",
                              }}
                            >
                              Edit Pricing
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* SECTION: AUDIT LOGS */}
              {section === "audit-logs" && (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <Search size={17} />
                      <input
                        placeholder="Search audit trail..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <small>{data?.total || 0} audit entries</small>
                  </div>
                  <div className="admin-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>Administrator</th>
                          <th>Target Type</th>
                          <th>Target ID</th>
                          <th>Reason</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data?.logs || []).map((log: any) => (
                          <tr key={log.id}>
                            <td>
                              <strong>{log.action}</strong>
                            </td>
                            <td>{log.actor_username}</td>
                            <td>
                              <Badge>{log.target_type}</Badge>
                            </td>
                            <td>
                              <code style={{ fontSize: "0.8rem" }}>{log.target_id}</code>
                            </td>
                            <td>{log.reason || "—"}</td>
                            <td>{date(log.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* SECTION: WORKSPACES */}
              {section === "workspaces" && (
                <div className="admin-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>Owner</th>
                        <th>Subscription</th>
                        <th>Members</th>
                        <th>Posts</th>
                        <th>Channels</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(records || []).map((w: any) => (
                        <tr key={w.id}>
                          <td>
                            <strong>{w.name}</strong>
                            <small>{w.timezone}</small>
                          </td>
                          <td>{w.owner}</td>
                          <td>
                            <Badge>{w.status}</Badge>
                          </td>
                          <td>{w.memberCount}</td>
                          <td>{w.contentCount}</td>
                          <td>{w.socialAccountsCount}</td>
                          <td>{date(w.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* SECTION: POSTS */}
              {section === "posts" && (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <Search size={17} />
                      <input
                        placeholder="Search posts..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">All statuses</option>
                      {["DRAFT", "NEEDS_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "UNCERTAIN"].map((s) => (
                        <option key={s} value={s}>
                          {human(s)}
                        </option>
                      ))}
                    </select>
                    <small>{data?.total || 0} posts</small>
                  </div>
                  <div className="admin-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Workspace</th>
                          <th>Creator</th>
                          <th>Status</th>
                          <th>Platforms</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(records || []).map((p: any) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.title || "Untitled Post"}</strong>
                            </td>
                            <td>{p.workspace}</td>
                            <td>{p.creator}</td>
                            <td>
                              <Badge>{human(p.status)}</Badge>
                            </td>
                            <td>{p.platforms?.join(", ") || "None"}</td>
                            <td>{date(p.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* SECTION: EVENTS */}
              {section === "events" && (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <Search size={17} />
                      <input
                        placeholder="Search events..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="all">All kinds</option>
                      <option value="login">Logins</option>
                      <option value="workspace">Workspace</option>
                      <option value="admin">Admin</option>
                    </select>
                    <small>{data?.total || 0} records</small>
                  </div>
                  <div className="admin-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>Actor</th>
                          <th>Type</th>
                          <th>Workspace</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(records || []).map((e: any) => (
                          <tr key={e.id}>
                            <td>
                              <strong>{human(e.action)}</strong>
                            </td>
                            <td>{e.actor || "System"}</td>
                            <td>
                              <Badge>{e.kind}</Badge>
                            </td>
                            <td>{e.workspace || "—"}</td>
                            <td>{date(e.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* SECTION: STATUS */}
              {section === "status" && data && (
                <div className="admin-grid">
                  {Object.entries(data.services).map(([name, v]: [string, any]) => (
                    <section className="admin-panel" key={name}>
                      <h2>
                        {name === "postgres"
                          ? "PostgreSQL Database"
                          : name === "smtp"
                            ? "Email Delivery (SMTP)"
                            : name === "queue"
                              ? "PostgreSQL Queue Workers"
                              : "Redis Cache"}
                      </h2>
                      <Badge variant={v.status === "healthy" || v.status === "configured" ? "success" : "danger"}>
                        {human(v.status)}
                      </Badge>
                      <p>{v.note}</p>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}

          {/* User Detail Modal */}
          {selectedUserId && (
            <AdminUserDetailModal
              userId={selectedUserId}
              onClose={() => setSelectedUserId(null)}
            />
          )}

          {/* Edit Plan Modal */}
          {editingPlan && (
            <ModalFrame
              open={!!editingPlan}
              onClose={() => setEditingPlan(null)}
              title={`Edit Plan: ${editingPlan.name}`}
            >
              <form onSubmit={handleSavePlan} style={{ padding: "20px 24px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <label>
                    <span>Monthly Price (₹ INR)</span>
                    <input
                      type="number"
                      required
                      min={0}
                      value={planMonthly}
                      onChange={(e) => setPlanMonthly(Number(e.target.value))}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    />
                  </label>
                  <label>
                    <span>Annual Price (₹ INR)</span>
                    <input
                      type="number"
                      required
                      min={0}
                      value={planYearly}
                      onChange={(e) => setPlanYearly(Number(e.target.value))}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    />
                  </label>
                  <label>
                    <span>Daily Post Allowance (posts/day)</span>
                    <input
                      type="number"
                      required
                      min={1}
                      max={50}
                      value={planLimit}
                      onChange={(e) => setPlanLimit(Number(e.target.value))}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                  <Button type="button" variant="secondary" onClick={() => setEditingPlan(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary">
                    Save Plan Pricing
                  </Button>
                </div>
              </form>
            </ModalFrame>
          )}
        </main>
      </div>
    </div>
  );
}
