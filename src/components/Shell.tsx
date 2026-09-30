import { useState } from "react";
import { NavLink, Link, Outlet, useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { Logo, Button, PlatformIcon } from "./ui";
import { data, request } from "../lib/api";
import { useSession } from "../lib/session";
import { platforms, type Snapshot } from "../lib/model";
export const useWorkspace = () => {
  const id = useSession((x) => x.workspaceId);
  return useQuery({ queryKey: ["workspace", id], queryFn: data.snapshot, refetchInterval: 15000 });
};
export default function Shell() {
  const { data: s, error, isLoading } = useWorkspace();
  const [mobile, setMobile] = useState(false);
  const session = useSession();
  const [search, setSearch] = useState("");
  const [notifications, setNotifications] = useState(false);
  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => request<{ id: string; name: string }[]>("/workspaces"),
  });
  const nav = useNavigate();
  const query = useQueryClient();
  const links = [
    ["", "Overview", LayoutDashboard],
    ["studio", "AI Studio", Sparkles],
    ["compose", "Create post", SquarePen],
    ["calendar", "Calendar", CalendarDays],
    ["library", "Content library", Library],
  ] as const;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
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
            onSubmit={(e) => {
              e.preventDefault();
              nav("/app/library?q=" + encodeURIComponent(search));
            }}
          >
            <input
              aria-label="Search content"
              placeholder="Search your content…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <div className="row">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
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
                      style={{ background: "#18222b", color: "#f1f5f9" }}
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
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => setNotifications(!notifications)}
            >
              <Bell size={18} />
            </button>
            {notifications && (
              <div className="notification-popover">
                No notifications yet. Workspace actions appear in Activity log.
              </div>
            )}
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
        <main className="app-main">
          {isLoading ? (
            <div className="loading-state">Loading your workspace…</div>
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
            s && <Outlet context={s} />
          )}
        </main>
        <footer className="app-footer">
          A little structure. More space to create.<span>ContentOS / MVP</span>
        </footer>
      </div>
    </div>
  );
}
export type WorkspaceContext = Snapshot;
