import { useState, useEffect } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Link2,
  ShieldCheck,
  Search,
  History,
  Users,
  BarChart3,
  ArrowUpRight,
  Settings as SettingsIcon,
  Sparkles,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Zap,
  Calendar,
  Layers,
  Activity as ActivityIcon,
  Bot,
  Loader2,
  Eye,
  EyeOff,
  ChevronDown,
} from "lucide-react";
import "./channels.css";
import {
  Button,
  PlatformIcon,
  Modal,
  Empty,
  StatusBadge,
} from "../components/ui";
import {
  platforms,
  dateLabel,
  type Snapshot,
  type Platform,
} from "../lib/model";
import { data, request } from "../lib/api";
import { useSession } from "../lib/session";

export function Channels() {
  const s = useOutletContext<Snapshot>();
  const demo = useSession((x) => x.demo);
  const query = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectTelegram, setConnectTelegram] = useState(false);
  const [channel, setChannel] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [channelFilter, setChannelFilter] = useState<"all" | "connected">("all");
  const [connectingPlatform, setConnectingPlatform] = useState<Platform | null>(null);
  const [metaPages, setMetaPages] = useState<{id:string;name:string;instagram:string|null}[]>([]);
  const [metaPage, setMetaPage] = useState('');
  const metaPending = searchParams.get('meta_pending');
  useEffect(() => {
    if (!metaPending) return;
    request<{pages: typeof metaPages}>('/social/meta/pages/' + metaPending).then(result => { setMetaPages(result.pages); setMetaPage(result.pages[0]?.id || ''); }).catch(err => setError(err.message));
  }, [metaPending]);
  const [remove, setRemove] = useState<string | null>(null);
  const canManage = ["Owner", "Admin"].includes(s.workspace.role);
  const connectedPlatforms = platforms.filter(p => s.accounts.some(a =>
    a.platform.toLowerCase() === p.toLowerCase() && a.state === "CONNECTED"));
  const visiblePlatforms = channelFilter === "connected" ? connectedPlatforms : platforms;

  useEffect(() => {
    const connectedParam = searchParams.get("connected");
    const errorParam = searchParams.get("error");
    if (connectedParam) {
      const name = connectedParam.charAt(0).toUpperCase() + connectedParam.slice(1);
      toast.success(`${name} account connected successfully!`);
      query.invalidateQueries({ queryKey: ["workspace"] });
      setSearchParams({}, { replace: true });
    } else if (errorParam) {
      toast.error(errorParam);
      setError(errorParam);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, query, setSearchParams]);

  async function handleStartConnect(p: Platform) {
    if (p === "Telegram") {
      setConnectTelegram(true);
      setChannel("");
      setToken("");
      setShowToken(false);
      setError("");
      return;
    }

    try {
      setConnectingPlatform(p);
      const platformKey = ["Instagram", "Facebook"].includes(p) ? "meta" : p.toLowerCase();
      const res = await request<{ configured: boolean; url?: string; message?: string }>(
        `/social/accounts/${platformKey}/connect-oauth`,
        "POST",
      );
      if (res.configured && res.url) {
        window.location.href = res.url;
      } else {
        toast.error(
          `${p} isn't ready to connect yet. Ask your workspace administrator to finish setup.`,
        );
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setConnectingPlatform(null);
    }
  }

  async function submitTelegram() {
    try {
      setBusy(true);
      setError("");
      if (demo) {
        const cleanChannel = channel.trim() || "@hindustan_social_network";
        toast.success(`Demo: ${cleanChannel} connected successfully!`);
        setToken("");
        setChannel("");
        setConnectTelegram(false);
        return;
      }
      const cleanChannel = channel.trim();
      const cleanToken = token.trim();
      if (!cleanChannel) {
        throw new Error("Please enter your Channel @username or Chat ID.");
      }
      if (!cleanToken) {
        throw new Error("Please enter your Telegram Bot token.");
      }
      await request("/social/accounts/telegram/connect", "POST", { chatId: cleanChannel, botToken: cleanToken });
      setToken("");
      setChannel("");
      setConnectTelegram(false);
      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Telegram channel connected successfully");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">MEET YOUR AUDIENCE</span>
          <h1>Every channel. One workspace.</h1>
          <p>Connect your accounts and give your content a destination.</p>
        </div>
        <span className="badge">
          <ShieldCheck size={14} /> Workspace-owned connections
        </span>
      </div>

      <section className="channel-welcome panel" aria-label="Your connection guide">
        <div className="channel-welcome-copy">
          <span className="channel-spark" aria-hidden="true"><Sparkles size={22} /></span>
          <div>
            <span className="overline">YOUR LITTLE LAUNCHPAD</span>
            <h2>{connectedPlatforms.length ? "Your audience is coming together." : "Big ideas. Meet your people."}</h2>
            <p>{canManage ? "Pick a platform, sign in, and let your ideas travel." : "Explore your channels. An owner or admin can connect accounts."}</p>
          </div>
        </div>
        <div className="channel-progress">
          <span><strong>{connectedPlatforms.length}</strong> of {platforms.length} platforms {demo ? "in this preview" : "connected"}</span>
          <progress aria-label={demo ? "Sample connected platforms" : "Connected platforms"} value={connectedPlatforms.length} max={platforms.length} />
          <small>{demo ? "Sample accounts · no live connection" : connectedPlatforms.length ? "A little more connected, a lot more possible." : "Start with one. Grow at your pace."}</small>
        </div>
      </section>

      <details className="channel-guide">
        <summary><span><Sparkles size={15} aria-hidden="true" /> First time here? Three tiny steps.</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <ol>
          <li><span>1</span><div><strong>Pick your people</strong><p>Choose the platform you want to connect.</p></div></li>
          <li><span>2</span><div><strong>Make it yours</strong><p>Sign in and allow access. For Telegram, add your bot token and channel.</p></div></li>
          <li><span>3</span><div><strong>You're connected</strong><p>Check your connection, then head to your content when you're ready.</p></div></li>
        </ol>
      </details>

      <div className="channel-toolbar">
        <div className="channel-filters" role="group" aria-label="Filter platforms">
          <button type="button" aria-pressed={channelFilter === "all"} onClick={() => setChannelFilter("all")}>All platforms <span>{platforms.length}</span></button>
          <button type="button" aria-pressed={channelFilter === "connected"} onClick={() => setChannelFilter("connected")}>Connected <span>{connectedPlatforms.length}</span></button>
        </div>
        <small><ShieldCheck size={14} aria-hidden="true" /> {demo ? "You're exploring sample accounts" : "Choose what to connect. You're in control."}</small>
      </div>

      {!metaPending && error && <p role="alert">{error}</p>}
      {metaPending && <div className="panel" style={{padding:24,marginBottom:20}}>
        <h2>Select your Facebook Page</h2><p>Connect this Page and its linked Instagram Business account.</p>
        {error && <p role="alert">{error}</p>}
        <select aria-label="Facebook Page" value={metaPage} onChange={e=>setMetaPage(e.target.value)}>
          {metaPages.map(p=><option key={p.id} value={p.id}>{p.name} — {p.instagram ? '@'+p.instagram : 'No linked Instagram Business account'}</option>)}
        </select>
        <Button disabled={busy || !metaPage} onClick={async()=>{try {setBusy(true);setError('');await request('/social/meta/pages/'+metaPending+'/select','POST',{pageId:metaPage});setSearchParams({connected:'Meta'},{replace:true});}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>Connect Page + Instagram</Button>
      </div>}
      {!visiblePlatforms.length && <div className="panel channel-empty"><Link2 size={26} aria-hidden="true" /><h2>Your first connection is waiting.</h2><p>Explore the platforms and pick your favorite to get started.</p><Button onClick={() => setChannelFilter("all")}>Explore platforms <ArrowUpRight size={14} /></Button></div>}
      <div className="channel-grid channel-connections">
        {visiblePlatforms.map((p) => {
          const accounts = s.accounts.filter(
            (a) => String(a.platform).toLowerCase() === p.toLowerCase(),
          );
          const supported = true;
          const isConnecting = connectingPlatform === p;
          const isConnected = connectedPlatforms.includes(p);
          const needsAttention = !demo && accounts.some(a => a.state !== "CONNECTED" && a.state !== "DISCONNECTED");

          return (
            <article key={p} className={`panel channel-card ${isConnected ? "channel-is-connected" : ""}`} aria-busy={isConnecting}>
              <div className="channel-card-heading">
                <PlatformIcon platform={p} />
                <h2>{p}</h2>
                <span className={`badge channel-state ${needsAttention ? "channel-state-warning" : isConnected ? "channel-state-ready" : ""}`}>
                  {needsAttention ? <AlertCircle size={12} aria-hidden="true" /> : isConnected ? <CheckCircle2 size={12} aria-hidden="true" /> : <span className="channel-state-dot" />}
                  {demo && accounts.length ? "Sample account" : needsAttention ? "Needs attention" : isConnected ? "Connected" : "Ready to connect"}
                </span>
              </div>
              <p>
                {p === "LinkedIn"
                  ? "Professional ideas and meaningful conversations."
                  : p === "Telegram"
                    ? "Keep your community close and informed."
                    : p === "Facebook" ? "Publish updates and images to your Facebook Page." : p === "Instagram"
                      ? "Visual stories that bring your brand to life."
                      : p === "X"
                        ? "Join the conversation, one thought at a time."
                        : "A home for your longer stories."}
              </p>
              {accounts.map((a) => (
                <div className="account-row" key={a.id} style={a.state?.includes('EXPIRED') ? { borderLeft: "3px solid #f59e0b", paddingLeft: "10px" } : {}}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <strong>{a.name}</strong>
                      {a.state?.includes('EXPIRED') && (
                        <span className="badge" style={{ background: "rgba(245, 158, 11, 0.15)", color: "var(--warning)", border: "1px solid rgba(245, 158, 11, 0.3)", fontSize: "0.7rem", padding: "1px 6px" }}>
                          Token Expired
                        </span>
                      )}
                    </div>
                    <small>
                      {a.state} ·{" "}
                      {a.lastSync ? dateLabel(a.lastSync) : "No live sync"}
                    </small>
                    <small>{p === 'Instagram' ? 'Publishing: JPEG image + caption, Carousel (1-20), Reels' : p === 'Facebook' ? 'Publishing: text, images, Carousel (1-20), videos, Reels' : 'Permission: text & media publishing'}</small>
                  </div>
                  {canManage && (
                    <div className="account-actions" style={{ display: "flex", gap: "8px" }}>
                      {a.state?.includes('EXPIRED') ? (
                        <button
                          className="text-button"
                          style={{ color: "var(--warning)", fontWeight: 600 }}
                          onClick={() => handleStartConnect(p)}
                        >
                          Reconnect
                        </button>
                      ) : (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={async () => {
                            try {
                              setBusy(true);
                              await request(`/social/accounts/${a.id}/validate`, "POST");
                              await query.invalidateQueries({ queryKey: ["workspace"] });
                              toast.success("Connection re-validated");
                            } catch (err) {
                              toast.error((err as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Validate
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => setRemove(a.id)}
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {canManage && (
                <>
                <Button
                  onClick={() => handleStartConnect(p)}
                  disabled={!supported || connectingPlatform !== null || busy}
                >
                  {isConnecting ? <Loader2 className="channel-spinner" size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
                  {isConnecting
                    ? "Connecting…"
                    : supported
                      ? (["Instagram", "Facebook"].includes(p) ? "Connect Meta" : accounts.length ? "Reconnect account" : "Connect account")
                      : "Coming Later"}
                  {supported && !isConnecting && <ArrowUpRight size={14} />}
                </Button>
                <small className="channel-connect-note">{p === "Telegram" ? "Your bot token + channel ID" : ["Instagram", "Facebook"].includes(p) ? "Connect a Facebook Page + linked Instagram" : `Continue securely with ${p}`}</small>
                </>
              )}
            </article>
          );
        })}
      </div>

      <Modal
        open={connectTelegram}
        onOpenChange={(o) => {
          if (!o) {
            setConnectTelegram(false);
            setToken("");
            setShowToken(false);
            setChannel("");
            setError("");
          }
        }}
        title="Connect Telegram Channel"
        description="Enter your channel @username or Chat ID and HTTP API Bot Token."
      >
        <div style={{ padding: "10px 12px", background: "rgba(99, 102, 241, 0.1)", borderRadius: "8px", marginBottom: "14px", border: "1px solid rgba(99, 102, 241, 0.2)", fontSize: "0.82rem", color: "var(--accent)" }}>
          💡 <strong>Setup Step:</strong> Make sure your Telegram bot (from @BotFather) is added as an <strong>Administrator</strong> to your Channel with <em>"Post Messages"</em> permission enabled.
        </div>
        <label>
          Channel @username or Chat ID
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="@your_channel or -100123456789"
            autoComplete="off"
          />
        </label>
        <label htmlFor="channel-bot-token" style={{ marginTop: "12px" }}>
          Bot token (from @BotFather)
        </label>
          <span className="channel-secret-field">
          <input
            id="channel-bot-token"
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            placeholder="e.g. 8818622380:AAFIE6T9Cns..."
          />
          <button type="button" aria-label={showToken ? "Hide bot token" : "Show bot token"} aria-pressed={showToken} onClick={() => setShowToken(value => !value)}>{showToken ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </span>
        <p className="form-note"><ShieldCheck size={13} aria-hidden="true" /> Your token stays hidden until you choose to show it.</p>

        {error && (
          <p className="error-box" role="alert" style={{ marginTop: "12px" }}>
            {error}
          </p>
        )}

        <Button
          onClick={submitTelegram}
          variant="primary"
          disabled={busy}
          style={{ marginTop: "16px", width: "100%", justifyContent: "center" }}
        >
          {busy && <Loader2 className="channel-spinner" size={15} aria-hidden="true" />}
          {busy ? "Connecting…" : "Connect Telegram"}
          <ArrowUpRight size={15} />
        </Button>
      </Modal>
      <Modal
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title="Disconnect this channel?"
        description="Future publishing to this account will be blocked. Your content and activity history will stay in the workspace."
      >
        <Button
          variant="danger"
          onClick={async () => {
            try {
              if (demo)
                throw new Error("Sample connections are fixed in the demo.");
              await request(`/social/accounts/${remove}`, "DELETE");
              setRemove(null);
              await query.invalidateQueries({ queryKey: ["workspace"] });
              toast.success("Channel disconnected");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          Disconnect channel
        </Button>
      </Modal>
    </>
  );
}
export function Activity() {
  const s = useOutletContext<Snapshot>();
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("All members");
  const entries = s.activity.filter(
    (a) =>
      (actor === "All members" || a.actor === actor) &&
      `${a.actor} ${a.action} ${a.entity}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">THE WHO, WHAT & WHEN</span>
          <h1>Every action has a story.</h1>
          <p>
            A shared record of the people and decisions behind your content.
          </p>
        </div>
        <History size={26} />
      </div>
      <div className="filter-bar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search activity"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity…"
          />
        </div>
        <select
          aria-label="Filter by member"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        >
          <option>All members</option>
          {Array.from(new Set(s.activity.map((a) => a.actor))).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Action</th>
              <th>Content / entity</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="member-cell">
                    <span className="avatar tiny">{a.actor[0]}</span>
                    {a.actor}
                  </span>
                </td>
                <td>{a.action}</td>
                <td>{a.entity}</td>
                <td>{dateLabel(a.at, s.workspace.timezone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && (
          <Empty title="No matching activity">
            <p>Try another search or member.</p>
          </Empty>
        )}
      </div>
      <p className="form-note">
        Showing the latest 200 actions. Audit records are written by the server
        and cannot be edited through the application.
      </p>
    </>
  );
}
export function Members() {
  const s = useOutletContext<Snapshot>();
  const demo = useSession((x) => x.demo);
  const query = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Editor");
  const [busy, setBusy] = useState(false);
  const canManage = ["Owner", "Admin"].includes(s.workspace.role);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">BETTER, TOGETHER</span>
          <h1>Good work takes good people.</h1>
          <p>Give every collaborator the access they need.</p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)} variant="primary">
            <Users size={16} />
            Add member
          </Button>
        )}
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Team member</th>
              <th>Email</th>
              <th>Role</th>
              <th>Access</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {s.members.map((m) => (
              <tr key={m.id}>
                <td>
                  <span className="member-cell">
                    <span className="avatar">{m.name[0]}</span>
                    {m.name}
                  </span>
                </td>
                <td>{m.email}</td>
                <td>
                  {canManage && m.role !== "Owner" ? (
                    <select
                      value={m.role}
                      disabled={busy}
                      onChange={async (e) => {
                        try {
                          setBusy(true);
                          await request(`/members/${m.id}`, "PATCH", { role: e.target.value });
                          await query.invalidateQueries({ queryKey: ["workspace"] });
                          toast.success(`Role updated to ${e.target.value}`);
                        } catch (err) {
                          toast.error((err as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      style={{ padding: "4px 8px", borderRadius: "6px", fontSize: "0.85rem" }}
                    >
                      {["Admin", "Content Manager", "Editor", "Approver", "Viewer"].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <StatusBadge status={m.role} />
                  )}
                </td>
                <td>
                  {m.role === "Viewer"
                    ? "Read only"
                    : m.role === "Approver"
                      ? "Review & approve"
                      : m.role === "Editor"
                        ? "Create & edit"
                        : "Workspace & content"}
                </td>
                {canManage && (
                  <td>
                    {m.role !== "Owner" ? (
                      <button
                        className="text-button"
                        style={{ color: "var(--color-danger, #ef4444)" }}
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`Are you sure you want to remove ${m.name} from this workspace?`)) return;
                          try {
                            setBusy(true);
                            await request(`/members/${m.id}`, "DELETE");
                            await query.invalidateQueries({ queryKey: ["workspace"] });
                            toast.success(`${m.name} removed from workspace`);
                          } catch (err) {
                            toast.error((err as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Remove
                      </button>
                    ) : (
                      <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Owner</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="notice">
        <ShieldCheck size={18} />
        <p>
          Roles are enforced by the API. Owners and admins manage the workspace;
          editors create drafts; approvers review content; viewers have
          read-only access.
        </p>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Bring a collaborator on board."
        description="For this MVP, the person must already have an account. Email invitations are a later phase."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (demo)
                throw new Error(
                  "Member changes require the application server.",
                );
              await request("/members", "POST", { email, role });
              await query.invalidateQueries({ queryKey: ["workspace"] });
              setOpen(false);
              toast.success("Member added");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <label>
            Account email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
            />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {["Admin", "Content Manager", "Editor", "Approver", "Viewer"].map(
                (r) => (
                  <option key={r}>{r}</option>
                ),
              )}
            </select>
          </label>
          <Button type="submit" variant="primary">
            Add to workspace
          </Button>
        </form>
      </Modal>
    </>
  );
}
export function Settings() {
  const s = useOutletContext<Snapshot>();
  const query = useQueryClient();
  const [brand, setBrand] = useState(s.brand);
  const [name, setName] = useState(s.workspace.name);
  const [tz, setTz] = useState(s.workspace.timezone);
  const [approval, setApproval] = useState(s.workspace.requireApproval);
  const [busy, setBusy] = useState(false);
  const canManage = ["Owner", "Admin"].includes(s.workspace.role);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">MAKE IT YOURS</span>
          <h1>A consistent voice starts here.</h1>
          <p>Your workspace preferences and the foundations of your brand.</p>
        </div>
        <SettingsIcon size={25} />
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setBusy(true);
            new Intl.DateTimeFormat("en", { timeZone: tz });
            await data.brand(brand);
            await data.settings({
              name,
              timezone: tz,
              requireApproval: approval,
            });
            await query.invalidateQueries({ queryKey: ["workspace"] });
            toast.success("Brand and workspace updated");
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={!canManage || busy}>
          <div className="settings-grid">
            <section className="panel settings-panel">
              <div className="panel-title">
                <div>
                  <h2>Brand Kit</h2>
                  <p>A little context for more recognizable content.</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Company name
                  <input
                    value={brand.name}
                    required
                    maxLength={100}
                    onChange={(e) =>
                      setBrand({ ...brand, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Website URL
                  <input
                    type="url"
                    value={brand.website}
                    placeholder="https://yourcompany.com"
                    onChange={(e) =>
                      setBrand({ ...brand, website: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Company description
                <textarea
                  rows={4}
                  value={brand.description}
                  maxLength={4000}
                  onChange={(e) =>
                    setBrand({ ...brand, description: e.target.value })
                  }
                />
              </label>
              <label>
                Preferred tone
                <select
                  value={brand.tone}
                  onChange={(e) => setBrand({ ...brand, tone: e.target.value })}
                >
                  {[
                    "Professional",
                    "Corporate",
                    "Educational",
                    "Technical",
                    "Conversational",
                    "Bold",
                    "Promotional",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Default call to action
                <input
                  value={brand.cta}
                  maxLength={300}
                  onChange={(e) => setBrand({ ...brand, cta: e.target.value })}
                />
              </label>
              <label>
                Words to avoid
                <input
                  value={brand.forbiddenWords}
                  maxLength={1000}
                  onChange={(e) =>
                    setBrand({ ...brand, forbiddenWords: e.target.value })
                  }
                />
              </label>
              <label>
                Preferred hashtags
                <input
                  value={brand.hashtags}
                  maxLength={500}
                  onChange={(e) =>
                    setBrand({ ...brand, hashtags: e.target.value })
                  }
                />
              </label>
            </section>
            <section className="panel settings-panel">
              <div className="panel-title">
                <div>
                  <h2>Workspace</h2>
                  <p>Keep everyone on the same page.</p>
                </div>
              </div>
              <label>
                Workspace name
                <input
                  value={name}
                  maxLength={100}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Timezone
                <input
                  value={tz}
                  required
                  placeholder="Asia/Kolkata"
                  onChange={(e) => setTz(e.target.value)}
                />
              </label>
              <p className="form-note">
                Use an IANA timezone such as Asia/Kolkata, Europe/London, or
                America/New_York.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={approval}
                  onChange={(e) => setApproval(e.target.checked)}
                />
                <span>
                  Require approval before scheduling
                  <small>Edits to approved content reset its approval.</small>
                </span>
              </label>
              <div className="notice">
                <ShieldCheck size={20} />
                <p>
                  Provider secrets are configured on the server. They are never
                  included in the frontend build.
                </p>
              </div>
            </section>
          </div>
          <div className="settings-save">
            <Button
              type="submit"
              variant="primary"
              disabled={!canManage || busy}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </fieldset>
      </form>
    </>
  );
}

export function Analytics() {
  const s = useOutletContext<Snapshot>();
  const [range, setRange] = useState<string>("30d");
  const [platformFilter, setPlatformFilter] = useState<string>("ALL");

  const [aiInsights, setAiInsights] = useState<{
    healthScore: number;
    statusRating: string;
    executiveSummary: string;
    strengths: string[];
    opportunities: string[];
    bestTimesToPost: Array<{
      platform: string;
      bestDays: string;
      bestTimeSlots: string;
      rationale: string;
    }>;
    actionableRecommendations: string[];
  } | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiModel, setAiModel] = useState<string>("");

  const { data: overview, isLoading, refetch } = useQuery({
    queryKey: ["analytics", "overview", s.workspace.id, range, platformFilter],
    queryFn: () =>
      request<{
        range: string;
        selectedPlatform: string;
        metrics: {
          totalContent: number;
          published: number;
          scheduled: number;
          failed: number;
          drafts: number;
          needsReview: number;
          publishSuccessRate: number;
          channels: number;
        };
        contentSource: {
          aiGenerated: number;
          manual: number;
        };
        batchStats: {
          totalBatches: number;
          completedBatches: number;
          partialBatches: number;
          failedBatches: number;
          totalChildItems: number;
          completedChildItems: number;
          failedChildItems: number;
        };
        accounts: Array<{ platform: string; name: string; state: string; last_sync: string | null }>;
        platformDistribution: Record<string, number>;
        timeline: Array<{ day: string; total: number; published: number; scheduled: number; drafts: number }>;
        recentContent: Array<{
          id: string;
          title: string;
          status: string;
          platforms: string[];
          createdAt: string;
          scheduledAt: string | null;
        }>;
      }>(`/analytics/overview?range=${range}&platform=${platformFilter}`),
  });

  async function handleGenerateAiInsights() {
    try {
      setGeneratingAi(true);
      const res = await request<{
        insights: NonNullable<typeof aiInsights>;
        model: string;
        generatedAt: string;
      }>("/analytics/ai-insights", "POST");
      setAiInsights(res.insights);
      setAiModel(res.model);
      toast.success("AI Analytics generated successfully!");
    } catch (err) {
      toast.error((err as Error).message || "Failed to generate AI insights.");
    } finally {
      setGeneratingAi(false);
    }
  }

  const metrics = overview?.metrics || {
    totalContent: s.posts.length,
    published: s.posts.filter((p) => p.status === "PUBLISHED").length,
    scheduled: s.posts.filter((p) => p.status === "SCHEDULED").length,
    failed: s.posts.filter((p) => p.status === "FAILED").length,
    drafts: s.posts.filter((p) => p.status === "DRAFT").length,
    needsReview: s.posts.filter((p) => p.status === "NEEDS_REVIEW").length,
    publishSuccessRate: 100,
    channels: s.accounts.length,
  };

  const contentSource = overview?.contentSource || {
    aiGenerated: s.posts.filter((p) => (p as any).variants?.aiGenerated || (p as any).variants?.generationPrompt).length,
    manual: Math.max(0, s.posts.length - s.posts.filter((p) => (p as any).variants?.aiGenerated || (p as any).variants?.generationPrompt).length),
  };

  const batchStats = overview?.batchStats || {
    totalBatches: 0,
    completedBatches: 0,
    partialBatches: 0,
    failedBatches: 0,
    totalChildItems: 0,
    completedChildItems: 0,
    failedChildItems: 0,
  };

  const platformsList = ["LinkedIn", "Instagram", "X", "YouTube", "Telegram"] as const;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">INTELLIGENCE &amp; PERFORMANCE</span>
          <h1>Understand your publishing rhythm.</h1>
          <p>
            Real-time workspace activity metrics and AI-driven publishing intelligence.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Range Selector */}
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
              padding: "6px 12px",
              borderRadius: "8px",
              fontSize: "0.8rem",
            }}
          >
            <option value="7d" style={{ background: "var(--surface2)" }}>Last 7 days</option>
            <option value="30d" style={{ background: "var(--surface2)" }}>Last 30 days</option>
            <option value="90d" style={{ background: "var(--surface2)" }}>Last 90 days</option>
            <option value="all" style={{ background: "var(--surface2)" }}>All time</option>
          </select>

          {/* Platform Selector */}
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
              padding: "6px 12px",
              borderRadius: "8px",
              fontSize: "0.8rem",
            }}
          >
            <option value="ALL" style={{ background: "var(--surface2)" }}>All Platforms</option>
            {platformsList.map((p) => (
              <option key={p} value={p} style={{ background: "var(--surface2)" }}>{p}</option>
            ))}
          </select>

          <Button
            variant="secondary"
            onClick={() => refetch()}
            disabled={isLoading}
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
          >
            <RefreshCw size={13} className={isLoading ? "spin" : ""} />
            Sync Data
          </Button>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <div className="stat-card">
          <div>
            Total Content
            <Layers size={17} />
          </div>
          <strong>{metrics.totalContent}</strong>
          <small>Created in range</small>
        </div>

        <div className="stat-card">
          <div>
            Published Posts
            <BarChart3 size={17} />
          </div>
          <strong>{metrics.published}</strong>
          <small>Live on channels</small>
        </div>

        <div className="stat-card">
          <div>
            Scheduled Pipeline
            <Clock size={17} />
          </div>
          <strong>{metrics.scheduled}</strong>
          <small>Queued for release</small>
        </div>

        <div className="stat-card">
          <div>
            Success Rate
            <TrendingUp size={17} style={{ color: "var(--success)" }} />
          </div>
          <strong style={{ color: "var(--success)" }}>{metrics.publishSuccessRate}%</strong>
          <small>{metrics.failed} failed items</small>
        </div>

        <div className="stat-card">
          <div>
            AI vs Manual
            <Sparkles size={17} style={{ color: "var(--accent)" }} />
          </div>
          <strong style={{ color: "var(--accent)" }}>
            {contentSource.aiGenerated} : {contentSource.manual}
          </strong>
          <small>AI-assisted / Manual</small>
        </div>

        <div className="stat-card">
          <div>
            Batch Operations
            <Zap size={17} style={{ color: "var(--warning)" }} />
          </div>
          <strong style={{ color: "var(--warning)" }}>{batchStats.totalBatches}</strong>
          <small>{batchStats.completedBatches} completed jobs</small>
        </div>
      </div>

      {/* AI Intelligence Panel */}
      <div
        className="panel"
        style={{
          marginBottom: "24px",
          border: "1px solid rgba(99, 102, 241, 0.3)",
          background: "linear-gradient(180deg, var(--surface2) 0%, var(--surface2) 100%)",
          padding: "24px",
          borderRadius: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            borderBottom: "1px solid var(--border)",
            paddingBottom: "16px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--ink)" }}>
                AI Content &amp; Rhythm Intelligence
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                {aiModel
                  ? `Synthesized with ${aiModel} from your real workspace posts and schedule`
                  : "Analyze your real content velocity and get AI-recommended publishing strategies"}
              </p>
            </div>
          </div>

          <Button
            variant="primary"
            disabled={generatingAi}
            onClick={handleGenerateAiInsights}
            style={{ fontSize: "0.85rem", gap: "8px" }}
          >
            {generatingAi ? (
              <>
                <Loader2 size={15} className="spin" />
                Analyzing real data…
              </>
            ) : (
              <>
                <Sparkles size={15} />
                {aiInsights ? "Refresh AI Insights" : "Generate AI Insights"}
              </>
            )}
          </Button>
        </div>

        {generatingAi && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <Loader2 size={32} className="spin" style={{ margin: "0 auto 14px", color: "var(--accent)" }} />
            <h4 style={{ margin: "0 0 6px", fontSize: "0.95rem", color: "var(--ink)" }}>
              AI is analyzing your real content trajectory…
            </h4>
            <p style={{ margin: 0, fontSize: "0.825rem", color: "var(--muted)" }}>
              Evaluating publishing cadence, platform balance, and scheduling opportunities.
            </p>
          </div>
        )}

        {!generatingAi && aiInsights && (
          <div>
            {/* Top Score & Summary Banner */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr",
                gap: "20px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "18px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRight: "1px solid var(--border)",
                  paddingRight: "16px",
                  textAlign: "center",
                }}
              >
                <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Content Health
                </span>
                <span style={{ fontSize: "2.4rem", fontWeight: 700, color: "var(--accent)", lineHeight: 1.1, margin: "6px 0" }}>
                  {aiInsights.healthScore}
                  <span style={{ fontSize: "1rem", color: "var(--muted)" }}>/100</span>
                </span>
                <span
                  style={{
                    fontSize: "0.725rem",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(56, 189, 248, 0.12)",
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  {aiInsights.statusRating}
                </span>
              </div>

              <div>
                <span style={{ fontSize: "0.75rem", color: "var(--accent)", fontWeight: 600, textTransform: "uppercase" }}>
                  Executive Brief
                </span>
                <p style={{ margin: "6px 0 0", fontSize: "0.9rem", color: "var(--ink)", lineHeight: 1.6 }}>
                  {aiInsights.executiveSummary}
                </p>
              </div>
            </div>

            {/* Strengths & Opportunities */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "16px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  background: "rgba(34, 197, 94, 0.04)",
                  border: "1px solid rgba(34, 197, 94, 0.15)",
                  borderRadius: "10px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", color: "var(--success)", fontWeight: 600, fontSize: "0.85rem" }}>
                  <CheckCircle2 size={16} />
                  <span>Key Strengths</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "0.825rem", color: "var(--ink)", lineHeight: 1.6 }}>
                  {aiInsights.strengths.map((str, idx) => (
                    <li key={idx} style={{ marginBottom: "6px" }}>
                      {str}
                    </li>
                  ))}
                </ul>
              </div>

              <div
                style={{
                  background: "rgba(245, 158, 11, 0.04)",
                  border: "1px solid rgba(245, 158, 11, 0.15)",
                  borderRadius: "10px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", color: "var(--warning)", fontWeight: 600, fontSize: "0.85rem" }}>
                  <AlertCircle size={16} />
                  <span>Growth Opportunities</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "0.825rem", color: "var(--ink)", lineHeight: 1.6 }}>
                  {aiInsights.opportunities.map((opp, idx) => (
                    <li key={idx} style={{ marginBottom: "6px" }}>
                      {opp}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Optimal Posting Windows */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                <Clock size={16} color="#38bdf8" />
                <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, color: "var(--ink)" }}>
                  AI-Recommended Publishing Windows
                </h4>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "12px",
                }}
              >
                {aiInsights.bestTimesToPost.map((b, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      padding: "12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <strong style={{ fontSize: "0.85rem", color: "var(--ink)" }}>{b.platform}</strong>
                      <span style={{ fontSize: "0.72rem", color: "var(--accent)", fontWeight: 600 }}>{b.bestDays}</span>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--accent)", fontWeight: 500, marginBottom: "4px" }}>
                      ⏰ {b.bestTimeSlots}
                    </div>
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.4 }}>
                      {b.rationale}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Actionable Recommendations */}
            <div
              style={{
                background: "rgba(99, 102, 241, 0.06)",
                border: "1px solid rgba(99, 102, 241, 0.2)",
                borderRadius: "10px",
                padding: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", color: "var(--accent)", fontWeight: 600, fontSize: "0.85rem" }}>
                <Zap size={16} />
                <span>Strategic Action Plan</span>
              </div>
              <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "0.825rem", color: "var(--ink)", lineHeight: 1.6 }}>
                {aiInsights.actionableRecommendations.map((rec, idx) => (
                  <li key={idx} style={{ marginBottom: "6px" }}>
                    {rec}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {!generatingAi && !aiInsights && (
          <div style={{ textAlign: "center", padding: "30px 20px" }}>
            <Sparkles size={28} style={{ color: "var(--accent)", margin: "0 auto 10px" }} />
            <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--muted)", maxWidth: "480px", marginLeft: "auto", marginRight: "auto" }}>
              Click &quot;Generate AI Insights&quot; above to have our LLM engine scan your real workspace content, channel cadence, and draft backlog to provide strategic recommendations.
            </p>
          </div>
        )}
      </div>

      {/* Platform Activity & Recent Posts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
        {/* Platform Coverage */}
        <div className="panel" style={{ padding: "20px", borderRadius: "12px" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
            <ActivityIcon size={16} />
            <span>Platform Coverage</span>
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {platformsList.map((platformName) => {
              const count = overview?.platformDistribution?.[platformName] ?? 0;
              const connectedAccount = overview?.accounts?.find(
                (a) => a.platform.toLowerCase() === platformName.toLowerCase(),
              );

              return (
                <div
                  key={platformName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <PlatformIcon platform={platformName} />
                    <div>
                      <strong style={{ fontSize: "0.85rem", color: "var(--ink)" }}>{platformName}</strong>
                      <span style={{ display: "block", fontSize: "0.72rem", color: "var(--muted)" }}>
                        {connectedAccount ? connectedAccount.name : "Not connected"}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{count} posts</span>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 7px",
                        borderRadius: "999px",
                        background: connectedAccount
                          ? "rgba(34, 197, 94, 0.12)"
                          : "rgba(148, 163, 184, 0.08)",
                        color: connectedAccount ? "var(--success)" : "var(--muted)",
                      }}
                    >
                      {connectedAccount ? "Connected" : "Inactive"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Publishing Activity */}
        <div className="panel" style={{ padding: "20px", borderRadius: "12px" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
            <Calendar size={16} />
            <span>Recent Content Log</span>
          </h3>

          {overview?.recentContent && overview.recentContent.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {overview.recentContent.slice(0, 5).map((post) => (
                <div
                  key={post.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "var(--surface2)",
                    borderRadius: "6px",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1, paddingRight: "10px" }}>
                    <div style={{ fontSize: "0.825rem", color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {post.title}
                    </div>
                    <small style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                      {post.createdAt ? dateLabel(post.createdAt) : "Recently"}
                    </small>
                  </div>
                  <StatusBadge status={post.status} />
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "0.825rem", color: "var(--muted)", margin: 0, padding: "20px 0", textAlign: "center" }}>
              No content published or drafted yet.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
