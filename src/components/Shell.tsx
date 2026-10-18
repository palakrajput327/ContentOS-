import { useEffect, useRef, useState } from "react";
import { NavLink, Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Sparkles,
  SquarePen,
  CalendarDays,
  Library,
  Users,
  History,
  CheckCheck,
  BarChart3,
  Settings,
  ChevronsUpDown,
  Menu,
  PanelLeftClose,
  LogOut,
  ArrowUpRight,
  Plus,
  Link2,
  Bell,
  CreditCard,
} from "lucide-react";
import { Logo, Button, PlatformIcon } from "./ui";
import { data, request } from "../lib/api";
import { useSession } from "../lib/session";
import { platforms, type Snapshot } from "../lib/model";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from '../lib/appearance';
import WorkspaceSkeleton from './WorkspaceSkeleton';
export const useWorkspace = () => {
  const id = useSession((x) => x.workspaceId);
  return useQuery({ queryKey: ["workspace", id], queryFn: data.snapshot, refetchInterval: 15000 });
};
export default function Shell() {
  const { data: s, error, isLoading } = useWorkspace();
  const [mobile, setMobile] = useState(false);
  const [narrow,setNarrow] = useState(()=>window.matchMedia('(max-width: 850px)').matches);
  useEffect(()=>{
    const media=window.matchMedia('(max-width: 850px)');
    const resize=()=>{setNarrow(media.matches);if(!media.matches)setMobile(false);};
    media.addEventListener('change',resize);
    return ()=>media.removeEventListener('change',resize);
  },[]);
  const location = useLocation();
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if (!mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow='hidden';
    sidebarRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if (event.key==='Escape') setMobile(false);
      if (event.key==='Tab') {
        const focusable=Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button,select')||[]).filter(el=>el.getClientRects().length && !el.hasAttribute('disabled'));
        const first=focusable[0],last=focusable[focusable.length-1];
        if (event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',onKey);
    return ()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',onKey);menuRef.current?.focus();};
  },[mobile]);
  const session = useSession();
  const [search, setSearch] = useState("");
  const [notifications, setNotifications] = useState(false);
  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => request<{ id: string; name: string }[]>("/workspaces"),
  });
  const { data: billingData } = useQuery({
    queryKey: ["billing-current"],
    queryFn: () => request<any>("/billing/current"),
    staleTime: 20000,
  });
  const nav = useNavigate();
  const query = useQueryClient();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(".dashboard-search input");
        input?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  const links = [
    ["", "Overview", LayoutDashboard],
    ["studio", "AI Studio", Sparkles],
    ["compose", "Create post", SquarePen],
    ["calendar", "Calendar", CalendarDays],
    ["festivals", "Festival Automation", Sparkles],
    ["library", "Content library", Library],
  ] as const;
  return (
    <div className="app-shell">
      <a href="#workspace-main" className="skip-link">Skip to content</a>
      <aside ref={sidebarRef} inert={narrow && !mobile} id="workspace-navigation" aria-label="Workspace navigation" className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <div className="sidebar-logo">
          <Link to="/">
            <Logo />
          </Link>
          <button
            className="mobile-only icon-button"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <PanelLeftClose size={19} />
          </button>
        </div>
        <nav onClick={() => setMobile(false)}>
          <div className="nav-group">WORKSPACE</div>
          {links.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path ? `/app/${path}` : "/app"}
              end
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} />
              {label}
              {path === "studio" && <span className="ai-chip">AI</span>}
            </NavLink>
          ))}
          <div className="nav-group channels-heading">
            CONNECTED CHANNELS
            <Link to="/app/channels" aria-label="Manage channels">
              <Plus size={15} />
            </Link>
          </div>
          {platforms.map((p) => (
            <NavLink
              key={p}
              to={`/app/channels?platform=${p}`}
              className="nav-item channel-item"
            >
              <PlatformIcon platform={p} />
              {p}
              <span
                className={`connection-dot ${s?.accounts.some((a) => a.platform === p) ? "connected" : ""}`}
              />
            </NavLink>
          ))}
          <div className="nav-group">TEAM</div>
          {[
            ["members", "Members", Users],
            ["activity", "Activity log", History],
            ["approvals", "Approvals", CheckCheck],
          ].map(([path, label, Icon]) => {
            const I = Icon as typeof Users;
            return (
              <NavLink
                to={`/app/${path}`}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
                key={String(path)}
              >
                <I size={18} />
                {String(label)}
                {path === "approvals" &&
                  !!s?.posts.filter((p) => p.status === "NEEDS_REVIEW")
                    .length && (
                    <span className="nav-count">
                      {
                        s.posts.filter((p) => p.status === "NEEDS_REVIEW")
                          .length
                      }
                    </span>
                  )}
              </NavLink>
            );
          })}
          <div className="nav-divider" />
          <NavLink to="/app/analytics" className="nav-item">
            <BarChart3 size={18} />
            Analytics
          </NavLink>
          <NavLink to="/app/settings" className="nav-item">
            <Settings size={18} />
            Settings
          </NavLink>
          <NavLink to="/app/billing" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
            <CreditCard size={18} />
            Plans & Billing
            {billingData?.entitlement?.effectiveState === "TRIAL_ACTIVE" && (
              <span className="ai-chip" style={{ background: "rgba(249, 115, 22, 0.2)", color: "#f97316" }}>
                Trial
              </span>
            )}
            {billingData?.entitlement?.isLocked && (
              <span className="ai-chip" style={{ background: "rgba(239, 68, 68, 0.2)", color: "#ef4444" }}>
                Expired
              </span>
            )}
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-help">
            <Sparkles size={17} />
            <strong>A voice that’s yours.</strong>
            <p>Set up your Brand Kit for more consistent content.</p>
            <Link to="/app/settings">
              Configure your brand <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="user-row">
            <span className="avatar">
              {session.user?.name
                ?.split(" ")
                .map((x) => x[0])
                .slice(0, 2)
                .join("") || "U"}
            </span>
            <div>
              {session.user?.name || "Your account"}
              <small>
                {session.demo ? "Demo workspace" : session.user?.email}
              </small>
            </div>
            <button
              className="icon-button"
              title="Log out"
              aria-label="Log out"
              onClick={async () => {
                if (!session.demo) await request("/auth/logout", "POST");
                session.logout();
                query.clear();
                window.location.assign("/login");
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-column">
        <header className="app-topbar">
          <form
            className="dashboard-search"
            style={{ position: "relative", display: "flex", alignItems: "center" }}
            onSubmit={(e) => {
              e.preventDefault();
              nav("/app/library?q=" + encodeURIComponent(search));
            }}
          >
            <input
              aria-label="Search content"
              placeholder="Search content or type commands… (⌘K)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", paddingRight: "50px" }}
            />
            <kbd
              style={{
                position: "absolute",
                right: "12px",
                fontSize: ".68rem",
                fontFamily: "inherit",
                color: "var(--muted)",
                background: "var(--surface3)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "2px 7px",
                pointerEvents: "none",
                userSelect: "none",
                fontWeight: 600,
              }}
            >
              ⌘K
            </kbd>
          </form>
          <div className="row">
            <button
              ref={menuRef}
              className="icon-button mobile-only"
              aria-label="Open navigation"
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span>{" "}
              {workspaces.length > 1 ? (
                <select
                  aria-label="Switch workspace"
                  className="breadcrumb-workspace-select"
                  value={session.workspaceId || ""}
                  onChange={async (e) => {
                    const r = await request<{ workspaceId: string }>(
                      "/workspaces/select",
                      "POST",
                      { id: e.target.value },
                    );
                    session.login(session.user!, r.workspaceId);
                    query.removeQueries({ queryKey: ["workspace"] });
                  }}
                  style={{
                    background: "transparent",
                    color: "inherit",
                    border: "none",
                    fontWeight: 600,
                    cursor: "pointer",
                    outline: "none",
                  }}
                >
                  {workspaces.map((w) => (
                    <option
                      value={w.id}
                      key={w.id}
                      style={{ background: "var(--surface2)", color: "var(--ink)" }}
                    >
                      {w.name}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{s?.workspace.name || "Loading"}</strong>
              )}
            </span>
          </div>
          <div className="row">
            <ThemeToggle />
            <NotificationBell />
            <span className="timezone-label">{session.user?.name}</span>
            <Link
              to="/app/channels"
              className="icon-button"
              aria-label="Manage channels"
            >
              <Link2 size={18} />
            </Link>
            <span className="avatar small">
              {session.user?.name?.[0] || "A"}
            </span>
          </div>
        </header>
        {billingData?.entitlement?.effectiveState === "TRIAL_ACTIVE" && (
          <div
            className="trial-top-banner"
            style={{
              background: "linear-gradient(90deg, rgba(249, 115, 22, 0.12) 0%, rgba(168, 85, 247, 0.1) 100%)",
              borderBottom: "1px solid rgba(249, 115, 22, 0.22)",
              padding: "8px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.85rem",
              color: "var(--ink)",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={15} style={{ color: "var(--accent)" }} />
              <span>
                <strong>Your free trial is active:</strong> Explore ContentOS with {billingData.usage?.dailyLimit || 3} posts/day. {billingData.entitlement.trial.daysRemaining} days remaining in your trial.
              </span>
            </div>
            <Link
              to="/app/billing"
              style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "var(--accent)",
                textDecoration: "underline",
                whiteSpace: "nowrap",
              }}
            >
              Upgrade anytime →
            </Link>
          </div>
        )}
        {billingData?.entitlement?.isLocked && (
          <div
            className="locked-top-banner"
            style={{
              background: "rgba(239, 68, 68, 0.12)",
              borderBottom: "1px solid rgba(239, 68, 68, 0.25)",
              padding: "10px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.85rem",
              color: "var(--ink)",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#ef4444", fontWeight: "bold" }}>●</span>
              <span>
                <strong>Subscription Required:</strong> Your free trial has ended. Post publishing and AI Studio are paused. Your content and connected channels are safe.
              </span>
            </div>
            <Link
              to="/app/billing"
              style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "#ef4444",
                textDecoration: "underline",
                whiteSpace: "nowrap",
              }}
            >
              Select a Plan →
            </Link>
          </div>
        )}
        {session.demo && (
          <div className="demo-banner">
            <span>
              <strong>Demo workspace</strong> · Sample data. Changes reset on
              reload. No content is published.
            </span>
            <Link to="/signup">
              Set up your workspace <ArrowUpRight size={13} />
            </Link>
          </div>
        )}
        <main className="app-main" id="workspace-main" tabIndex={-1}>
          {isLoading ? (
            <WorkspaceSkeleton />
          ) : error ? (
            <div className="empty">
              <h2>We couldn’t load your workspace.</h2>
              <p>{error.message}</p>
              <Button
                onClick={() =>
                  query.invalidateQueries({ queryKey: ["workspace"] })
                }
              >
                Try again
              </Button>
            </div>
          ) : (
            s && <div className="page-enter" key={location.pathname}><Outlet context={s} /></div>
          )}
        </main>
        <footer className="app-footer">
          A little structure. More space to create.<span>Hindustan Social Network · ContentOS</span>
        </footer>
      </div>
    </div>
  );
}
export type WorkspaceContext = Snapshot;
