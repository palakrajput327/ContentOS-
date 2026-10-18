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
  Search,
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
    ["", "Dashboard", LayoutDashboard],
    ["library", "Posts", SquarePen],
    ["calendar", "Calendar", CalendarDays],
    ["studio", "AI Studio", Sparkles],
    ["library?view=media", "Media Library", Library],
    ["analytics", "Analytics", BarChart3],
    ["settings", "Settings", Settings],
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
        <div className="sidebar-action-wrap">
          <Link to="/app/compose" className="sidebar-create-post-btn" onClick={() => setMobile(false)}>
            <Plus size={16} />
            <span>Create Post</span>
          </Link>
        </div>
        <nav onClick={() => setMobile(false)} className="sidebar-main-nav">
          <div className="nav-group-label">WORKSPACE</div>
          {links.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path ? `/app/${path}` : "/app"}
              end={path === ""}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}

          <div className="nav-group-heading channels-heading">
            <span>CONNECTED CHANNELS</span>
            <Link to="/app/channels" aria-label="Manage channels" className="add-channel-btn">
              <Plus size={14} />
            </Link>
          </div>
          {platforms.map((p) => {
            const isConnected = s?.accounts.some(
              (a) => a.platform?.toLowerCase() === p.toLowerCase() && a.state?.toLowerCase() === "connected"
            );
            return (
              <NavLink
                key={p}
                to={`/app/channels?platform=${p}`}
                className="nav-item channel-item"
              >
                <PlatformIcon platform={p} />
                <span>{p}</span>
                <span className={`connection-dot ${isConnected ? "connected" : ""}`} />
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-status-card">
            <div className="system-status-row">
              <div className="system-status-badge">
                <span className="pulsing-green-dot" />
                <span className="status-label">System Online</span>
              </div>
              <div className="waveform-indicator" aria-hidden="true">
                <span className="wave-bar bar-1" />
                <span className="wave-bar bar-2" />
                <span className="wave-bar bar-3" />
                <span className="wave-bar bar-4" />
              </div>
            </div>
            <div className="system-status-sub">All systems operational</div>
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
            onSubmit={(e) => {
              e.preventDefault();
              nav("/app/library?q=" + encodeURIComponent(search));
            }}
          >
            <Search size={14} className="search-lens-icon" />
            <input
              className="dashboard-search-input"
              aria-label="Search content"
              placeholder="Search content, posts, or commands..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd className="search-kbd-badge">
              {typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K"}
            </kbd>
          </form>
          <div className="topbar-right-actions">
            <button
              ref={menuRef}
              className="icon-button mobile-only"
              aria-label="Open navigation"
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <ThemeToggle />
            <NotificationBell />
            <button
              className="topbar-user-pill"
              title="Account: click to log out"
              onClick={async () => {
                if (window.confirm("Do you want to log out?")) {
                  if (!session.demo) await request("/auth/logout", "POST");
                  session.logout();
                  query.clear();
                  window.location.assign("/login");
                }
              }}
            >
              <span className="user-pill-avatar">
                {session.user?.name?.[0] || "P"}
              </span>
              <span className="user-pill-name">
                {session.user?.name || "Palak Gemini"}
              </span>
            </button>
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
      </div>
    </div>
  );
}
export type WorkspaceContext = Snapshot;
