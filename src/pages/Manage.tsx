import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
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
  const [connect, setConnect] = useState<Platform | null>(null);
  const [channel, setChannel] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  const canManage = ["Owner", "Admin"].includes(s.workspace.role);
  async function submit() {
    try {
      setBusy(true);
      setError("");
      if (demo) {
        throw new Error(
          "Live connections are disabled in the demo. Run the application server and configure provider credentials to connect your accounts.",
        );
      }
      if (connect === "LinkedIn") {
        const r = await request<{ url: string }>(
          "/social/accounts/linkedin/connect",
          "POST",
        );
        window.location.assign(r.url);
      } else {
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
        setConnect(null);
        await query.invalidateQueries({ queryKey: ["workspace"] });
        toast.success("Telegram channel connected securely");
      }
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
      <div className="channel-grid">
        {platforms.map((p) => {
          const accounts = s.accounts.filter((a) => String(a.platform).toLowerCase() === p.toLowerCase());
          const supported = p === "Telegram";
          return (
            <article key={p} className="panel channel-card">
              <div className="channel-card-heading">
                <PlatformIcon platform={p} />
                <h2>{p}</h2>
                <span className="badge">
                  {accounts.length
                    ? "Connected"
                    : supported
                      ? "Not connected"
                      : "Planned"}
                </span>
              </div>
              <p>
                {p === "LinkedIn"
                  ? "Professional ideas and meaningful conversations."
                  : p === "Telegram"
                    ? "Keep your community close and informed."
                    : p === "Instagram"
                      ? "Visual stories that bring your brand to life."
                      : p === "X"
                        ? "Join the conversation, one thought at a time."
                        : "A home for your longer stories."}
              </p>
              {accounts.map((a) => (
                <div className="account-row" key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {a.state} ·{" "}
                      {a.lastSync ? dateLabel(a.lastSync) : "No live sync"}
                    </small>
                    <small>Permission: text publishing</small>
                  </div>
                  {canManage && (
                    <div className="account-actions" style={{ display: "flex", gap: "8px" }}>
                      <button
                        className="text-button"
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
                <Button
                  onClick={() => {
                    setConnect(p);
                    setError("");
                  }}
                  disabled={!supported}
                >
                  <Link2 size={15} />
                  {supported ? (accounts.length ? "Add another channel" : "Connect account") : "Coming Later"}
                  {supported && <ArrowUpRight size={14} />}
                </Button>
              )}
            </article>
          );
        })}
      </div>
      <Modal
        open={!!connect}
        onOpenChange={(o) => {
          if (!o) {
            setConnect(null);
            setToken("");
          }
        }}
        title={`Connect ${connect || "account"}`}
        description={
          connect === "Telegram"
            ? "Add your bot as a channel administrator with permission to post."
            : "You’ll authorize publishing on LinkedIn and return to this workspace."
        }
      >
        {connect === "Telegram" && (
          <>
            <details className="notice" style={{ marginBottom: "16px", cursor: "pointer" }} open>
              <summary style={{ fontWeight: 600, color: "var(--color-primary-light, #38bdf8)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span>📖 How to connect Telegram (Step-by-Step Guide)</span>
              </summary>
              <ol style={{ marginTop: "10px", paddingLeft: "18px", fontSize: "0.875rem", lineHeight: "1.5" }}>
                <li style={{ marginBottom: "6px" }}>
                  <strong>Create a Bot:</strong> Open Telegram and search for <code>@BotFather</code>. Send <code>/newbot</code>, choose a name and username for your bot, and copy the <strong>HTTP API Bot Token</strong>.
                </li>
                <li style={{ marginBottom: "6px" }}>
                  <strong>Add Bot to Channel/Group:</strong> Go to your Telegram channel or group, open <i>Channel Info &rarr; Administrators &rarr; Add Admin</i>, search for your bot, and give it <strong>Post Messages</strong> permission.
                </li>
                <li>
                  <strong>Enter Credentials:</strong> Paste your Channel Username (e.g. <code>@hindustan_social_network</code>) and your Bot Token below, then click <strong>Continue securely</strong>.
                </li>
              </ol>
            </details>

            <label>
              Channel / Group @username or Chat ID
              <input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="@your_channel or @hindustan_social_network"
                autoComplete="off"
              />
            </label>
            {!demo && (
              <label>
                Bot token
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  placeholder="e.g. 8818622380:AAFIE6T9Cns..."
                />
              </label>
            )}
          </>
        )}
        {demo && (
          <p className="notice">
            This preview cannot connect real accounts. Credentials belong in
            your own application deployment.
          </p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <Button onClick={submit} variant="primary" disabled={busy}>
          {busy ? "Connecting…" : "Continue securely"}
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
                  <StatusBadge status={m.role} />
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
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">A CLEARER PICTURE</span>
          <h1>Understand your publishing rhythm.</h1>
          <p>
            Workspace counts are available now. Provider engagement sync is
            planned.
          </p>
        </div>
        <span className="badge">Workspace data</span>
      </div>
      <div className="stats-grid">
        {[
          ["Published", s.posts.filter((p) => p.status === "PUBLISHED").length],
          ["Scheduled", s.posts.filter((p) => p.status === "SCHEDULED").length],
          ["Drafts", s.posts.filter((p) => p.status === "DRAFT").length],
          ["Channels", s.accounts.length],
        ].map(([t, n]) => (
          <div className="stat-card" key={t}>
            <div>
              {t}
              <BarChart3 size={17} />
            </div>
            <strong>{n}</strong>
            <small>Current workspace</small>
          </div>
        ))}
      </div>
      <div className="panel">
        <Empty
          icon={<BarChart3 size={36} />}
          title="Performance insights are next."
        >
          <p>
            Reach, engagement, and audience growth will appear after provider
            analytics integrations are implemented. No estimated metrics are
            shown.
          </p>
        </Empty>
      </div>
    </>
  );
}
