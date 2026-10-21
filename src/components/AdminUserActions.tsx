import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Eye,
  Pencil,
  Trash2,
  X,
  ShieldCheck,
  TriangleAlert,
  LoaderCircle,
  User,
  CreditCard,
  History,
} from "lucide-react";
import { ModalFrame, Button } from "./ui";
import { request } from "../lib/api";

export default function AdminUserActions({
  user,
  onView,
}: {
  user: any;
  onView: () => void;
}) {
  const client = useQueryClient();
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [dialogMode, setDialogMode] = useState<"edit" | "delete">("edit");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [countryCode, setCountryCode] = useState("+91");
  const [subscriptionMode, setSubscriptionMode] = useState("KEEP");
  const [billingPeriod, setBillingPeriod] = useState("MONTHLY");
  const [expiresAt, setExpiresAt] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [note, setNote] = useState("");
  const [impact, setImpact] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editTab, setEditTab] = useState("profile");
  const [tempPassword, setTempPassword] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [version, setVersion] = useState(user.adminVersion);
  const [planCode, setPlanCode] = useState("GROWTH");
  const [customLimit, setCustomLimit] = useState<number | "">("");
  const [complimentary, setComplimentary] = useState(false);
  const [extensionDays, setExtensionDays] = useState(5);
  const [extensionReason, setExtensionReason] = useState("");
  const [ready, setReady] = useState(false);

  function close() {
    if (!busy && !loading) {
      setMode(null);
      setError("");
    }
  }

  async function open(next: "edit" | "delete") {
    setMode(next);
    setDialogMode(next);
    setEditTab("profile");
    setError("");
    setName(user.name || "");
    setTempPassword("");
    setEmail(user.email || "");
    setEmailVerified(!!user.emailVerified);
    setCountryCode(user.phoneCountryCode || "+91");
    setSubscriptionMode("KEEP");
    setComplimentary(false);
    setExtensionDays(5);
    setExtensionReason("");
    setReady(false);
    setDetail(null);
    setVersion(user.adminVersion);
    setBillingPeriod("MONTHLY");
    const expiry = user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date()
      ? new Date(user.subscriptionExpiry) : new Date(Date.now() + 30 * 86400000);
    setExpiresAt(new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000).toISOString().slice(0,16));
    setPhone(user.phoneNumber || (user.phone !== "Not recorded" ? user.phone : "") || "");
    setStatus(user.accountStatus || "ACTIVE");
    setNote(user.adminNote || "");
    setImpact(null);
    if (next === "edit") {
      setLoading(true);
      try {
        const record = await request<any>(`/admin/users/${user.id}/details`);
        setDetail(record);
        setVersion(record.profile.adminVersion);
        setName(record.profile.name || "");
        setEmail(record.profile.email || "");
        setEmailVerified(!!record.security.emailVerified);
        setPhone(record.profile.phoneNumber || "");
        setCountryCode(record.profile.phoneCountryCode || "+91");
        setStatus(record.profile.accountStatus);
        setNote(record.profile.adminNote || "");
        setPlanCode(["STARTER", "GROWTH", "SCALE"].includes(record.entitlement?.plan?.code) ? record.entitlement.plan.code : "GROWTH");
        setBillingPeriod(record.entitlement?.plan?.billingPeriod || "MONTHLY");
        setCustomLimit(record.entitlement?.subscription?.customDailyLimit ?? "");
        const currentExpiry = record.entitlement?.subscription?.currentPeriodEnd;
        const nextExpiry = currentExpiry && new Date(currentExpiry).getTime() > Date.now() ? new Date(currentExpiry) : new Date(Date.now() + 30 * 86400000);
        setExpiresAt(new Date(nextExpiry.getTime() - nextExpiry.getTimezoneOffset() * 60000).toISOString().slice(0,16));
        setReady(true);
      } catch (e: any) {
        setError(e.message || "Unable to load current account details. Close and retry.");
      } finally {
        setLoading(false);
      }
    }
    if (next === "delete") {
      setLoading(true);
      try {
        setImpact(await request(`/admin/users/${user.id}/impact`));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  }

  async function resetPassword() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ tempPassword: string }>(`/admin/users/${user.id}/password-reset`, "POST", {});
      setTempPassword(result.tempPassword);
      toast.success("Temporary password generated. Existing sessions revoked.");
      await client.invalidateQueries({ queryKey: ["super-admin"] });
      await client.invalidateQueries({ queryKey: ["admin-user-detail", user.id] });
    } catch (e: any) {
      setError(e.message || "Password reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "edit" && !ready) return;
    if (mode === "edit") {
      const form = e.currentTarget as HTMLFormElement;
      const invalid = Array.from(form.elements).find(element => element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? !element.checkValidity() : false) as HTMLInputElement | undefined;
      if (invalid) {
        setEditTab(invalid.closest<HTMLElement>("[data-edit-section]")?.dataset.editSection || "profile");
        setError(invalid.validationMessage);
        requestAnimationFrame(() => { invalid.focus(); invalid.reportValidity(); });
        return;
      }
      if (!name.trim()) { setEditTab("profile"); setError("Enter a full name."); return; }
      if (!["KEEP", "INACTIVE", "EXTEND"].includes(subscriptionMode) && (!expiresAt || !Number.isFinite(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= Date.now())) {
        setEditTab("subscription"); setError("Select a future expiry date."); return;
      }
    }
    if (mode === "edit" && subscriptionMode === "EXTEND" && !extensionReason.trim()) {
      setEditTab("subscription");
      setError("Enter a reason for the extension.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload =
        mode === "delete"
          ? { confirmation: user.email, version: user.adminVersion }
          : {
              name: name.trim(),
              email: email.trim(),
              emailVerified,
              countryCode: countryCode.trim(),
              ...(subscriptionMode !== "KEEP" ? { subscription: {
                status: subscriptionMode === "EXTEND" ? "EXTEND" : subscriptionMode === "INACTIVE" ? "INACTIVE" : "ACTIVE",
                planCode,
                billingPeriod,
                complimentary,
                customDailyLimit: customLimit === "" ? null : customLimit,
                ...(subscriptionMode === "EXTEND" ? { extensionDays, extensionReason: extensionReason.trim() } : {}),
                ...(!["EXTEND", "INACTIVE"].includes(subscriptionMode) ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
              }} : {}),
              phone: phone.trim(),
              status,
              note: note.trim(),
              version,
            };
      const result = await request<any>(
        `/admin/users/${user.id}`,
        mode === "delete" ? "DELETE" : "PATCH",
        payload,
      );
      await client.invalidateQueries({ queryKey: ["super-admin"] });
      await client.invalidateQueries({ queryKey: ["admin-user-detail", user.id] });
      setMode(null);
      toast.success(
        mode === "delete"
          ? "User deleted"
          : "User details updated",
        { description: result.message || "Changes saved successfully." },
      );
    } catch (e: any) {
      setError(e.message || "Failed to update user");
      toast.error("Changes could not be saved", { description: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-user-actions">
        <button type="button" onClick={onView} title="View user details">
          <Eye size={14} />
          <span>View</span>
        </button>
        <button
          type="button"
          onClick={() => open("edit")}
          disabled={user.accountStatus === "DELETED"}
          title="Edit user info & status"
        >
          <Pencil size={14} />
          <span>Edit</span>
        </button>
        <button
          type="button"
          className="admin-delete-action"
          onClick={() => open("delete")}
          disabled={user.accountStatus === "DELETED"}
          title="Delete user"
        >
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      </div>

      <ModalFrame
        open={!!mode}
        onClose={close}
        title={dialogMode === "edit" ? "Edit user" : "Delete user"}
        className={`admin-user-dialog ${dialogMode === "edit" ? "admin-user-editor" : ""}`}
      >
        <div className="admin-user-dialog-header">
          <span className={`admin-dialog-icon ${dialogMode === "delete" ? "danger" : ""}`}>
            {dialogMode === "edit" ? <ShieldCheck size={22} /> : <TriangleAlert size={22} />}
          </span>
          <button
            type="button"
            aria-label="Close dialog"
            disabled={busy || loading}
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>

        <h2>{dialogMode === "edit" ? detail?.profile?.name || user.name || "Edit user" : "Delete this account?"}</h2>
        <p className="admin-dialog-description">{dialogMode === "edit" ? detail?.profile?.email || user.email : user.email}{dialogMode === "edit" && <span className="admin-edit-id">User ID: {user.id}</span>}</p>
        {dialogMode === "edit" && <div className="admin-edit-tabs" role="tablist" aria-label="Edit user sections">
          {[{id:"profile",label:"Profile",icon:User},{id:"security",label:"Security",icon:ShieldCheck},{id:"subscription",label:"Subscription & Limits",icon:CreditCard},{id:"activity",label:"Activity Logs",icon:History}].map(({id,label,icon:Icon}) =>
            <button type="button" key={id} role="tab" id={`edit-user-tab-${id}`} aria-controls={`edit-user-panel-${id}`} aria-selected={editTab === id} onClick={() => setEditTab(id)}><Icon size={17}/>{label}</button>)}
        </div>}

        <form onSubmit={save} className="admin-dialog-form" noValidate onInvalidCapture={(event) => {
          const field = event.target as HTMLInputElement;
          const panel = field.closest<HTMLElement>("[data-edit-section]");
          if (panel?.dataset.editSection) { setEditTab(panel.dataset.editSection); requestAnimationFrame(() => field.focus()); }
        }}>
          <div className="admin-dialog-body">
            {dialogMode === "edit" && loading ? <p role="status"><LoaderCircle size={18} className="admin-spin"/> Loading current user details…</p> : dialogMode === "edit" && ready ? (
              <>
                <section hidden={editTab !== "profile"} data-edit-section="profile" role="tabpanel" id="edit-user-panel-profile" aria-labelledby="edit-user-tab-profile">
                  <div className="admin-edit-card">
                    <h3>Personal & Account Information</h3><p className="admin-edit-help">Full control over contact information, active/inactive status, and subscription tier.</p>
                    <div className="admin-edit-grid">
                      <label><span>Full name</span><input required maxLength={100} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="User full name" /></label>
                      <label><span>Email address</span><input required type="email" maxLength={254} value={email} onChange={e => {setEmail(e.target.value);setEmailVerified(false);}} disabled={busy} /></label>
                      <label><span>Country code</span><input maxLength={10} value={countryCode} onChange={e => setCountryCode(e.target.value)} disabled={busy} placeholder="+91" /></label>
                      <label><span>Phone number</span><input type="tel" maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} disabled={busy} placeholder="9876543210" /></label>
                      <label><span>Account status</span>
                        <select value={status} onChange={e => setStatus(e.target.value)} disabled={busy}>
                          <option value="ACTIVE">Active · Sign-in enabled</option>
                          <option value="SUSPENDED">Inactive · Sign-in blocked</option>
                        </select>
                      </label>
                      <label><span>Subscription Category</span>
                        <select
                          value={subscriptionMode === "INACTIVE" ? "INACTIVE" : subscriptionMode === "ACTIVE" ? planCode : "KEEP"}
                          onChange={e => {
                            const val = e.target.value;
                            if (val === "KEEP") {
                              setSubscriptionMode("KEEP");
                            } else if (val === "INACTIVE") {
                              setSubscriptionMode("INACTIVE");
                            } else {
                              setSubscriptionMode("ACTIVE");
                              setPlanCode(val);
                              setComplimentary(true);
                              const nextExpiry = new Date(Date.now() + 30 * 86400000);
                              setExpiresAt(new Date(nextExpiry.getTime() - nextExpiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
                            }
                          }}
                          disabled={busy || !detail?.workspaceId}
                        >
                          <option value="KEEP">Current: {detail?.entitlement?.isLocked ? "Inactive" : (detail?.entitlement?.plan?.name ? `${detail.entitlement.plan.name} (Active)` : "Active")}</option>
                          <option value="INACTIVE">Inactive · No subscription</option>
                          <option value="STARTER">Active · Starter (15k · ₹14,999/mo)</option>
                          <option value="GROWTH">Active · Growth (25k · ₹24,999/mo)</option>
                          <option value="SCALE">Active · Scale (50k · ₹49,999/mo)</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="admin-edit-card">
                    <h3>Internal admin note</h3>
                    <label><span className="sr-only">Internal admin note</span><textarea maxLength={500} rows={3} value={note} onChange={e => setNote(e.target.value)} disabled={busy} placeholder="Add payment context, account notes or a support request…"/><small>{note.length}/500 · Visible to administrators only</small></label>
                  </div>
                </section>
                <section hidden={editTab !== "security"} data-edit-section="security" role="tabpanel" id="edit-user-panel-security" aria-labelledby="edit-user-tab-security">
                  <div className="admin-edit-card">
                    <h3>Account access</h3><p className="admin-edit-help">Control sign-in access and email verification.</p>
                    <div className="admin-edit-grid">
                      <label><span>Sign-in access</span><select value={status} onChange={e => setStatus(e.target.value)} disabled={busy}><option value="ACTIVE">Enabled · Can sign in</option><option value="SUSPENDED">Disabled · Sign-in blocked</option></select></label>
                      <label><span>Email verification</span><select value={emailVerified ? "verified" : "unverified"} onChange={e => setEmailVerified(e.target.value === "verified")} disabled={busy}><option value="verified">Verified</option><option value="unverified">Unverified</option></select></label>
                    </div>
                    {status === "SUSPENDED" && <p className="admin-dialog-notice">Saving will revoke active sessions and block further logins. User content and history are preserved.</p>}
                  </div>
                  <div className="admin-edit-card">
                    <h3>Password reset</h3><p className="admin-edit-help">Generate a temporary password and sign the user out of existing sessions. This action takes effect immediately.</p>
                    <Button type="button" variant="secondary" disabled={busy} onClick={resetPassword}>Generate temporary password</Button>
                    {tempPassword && <p className="admin-dialog-notice" role="status">Copy and share securely: <code>{tempPassword}</code></p>}
                  </div>
                </section>
                <section hidden={editTab !== "subscription"} data-edit-section="subscription" role="tabpanel" id="edit-user-panel-subscription" aria-labelledby="edit-user-tab-subscription">
                  <div className="admin-edit-summary">
                    <div><span>Effective state</span><strong>{detail?.entitlement?.effectiveState?.replaceAll("_", " ") || "No workspace"}</strong><small>{detail?.entitlement?.plan?.name || "No plan"}</small></div>
                    <div><span>Daily posting allowance</span><strong>{detail?.entitlement?.dailyPostingLimit != null ? detail.entitlement.dailyPostingLimit + " posts / day" : "Not assigned"}</strong></div>
                    <div><span>Expiration</span><strong>{detail?.entitlement?.subscription?.currentPeriodEnd || detail?.entitlement?.trial?.endsAt ? new Date(detail.entitlement.subscription.currentPeriodEnd || detail.entitlement.trial.endsAt).toLocaleDateString() : "No expiry set"}</strong></div>
                  </div>
                  {!detail?.workspaceId ? <p className="admin-dialog-notice">This user has no billing workspace. Profile and security details can still be edited.</p> : <>
                  <div className="admin-edit-card">
                    <h3>Change Plan or Activate Subscription</h3>
                    <div className="admin-edit-grid admin-edit-grid-three">
                      <label><span>Plan</span><select value={planCode} onChange={e => {setPlanCode(e.target.value);if(!["KEEP","INACTIVE","EXTEND"].includes(subscriptionMode))setSubscriptionMode(e.target.value);}} disabled={busy}>
                        <option value="STARTER">Starter · ₹15,000/month · 3 posts/day</option><option value="GROWTH">Growth · ₹25,000/month · 5 posts/day</option><option value="SCALE">Scale · ₹50,000/month · 10 posts/day</option>
                      </select></label>
                      <label><span>Billing frequency</span><select value={billingPeriod} onChange={e => setBillingPeriod(e.target.value)} disabled={busy}><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></label>
                      <label><span>Custom posting limit</span><input type="number" min={1} max={50} step={1} value={customLimit} onChange={e => setCustomLimit(e.target.value ? Number(e.target.value) : "")} disabled={busy} placeholder="Default from plan"/></label>
                    </div>
                    <label className="admin-edit-spacing"><span>Active until</span><input type="datetime-local" required={!["KEEP","INACTIVE","EXTEND"].includes(subscriptionMode)} value={expiresAt} onChange={e => setExpiresAt(e.target.value)} disabled={busy}/></label>
                    <div className="admin-edit-actions">
                      <Button type="button" variant={!complimentary && !["KEEP","INACTIVE","EXTEND"].includes(subscriptionMode) ? "primary" : "secondary"} disabled={busy} onClick={() => {setSubscriptionMode(planCode);setComplimentary(false);}}>Activate Paid Plan</Button>
                      <Button type="button" variant={complimentary && !["KEEP","INACTIVE","EXTEND"].includes(subscriptionMode) ? "primary" : "secondary"} disabled={busy} onClick={() => {setSubscriptionMode(planCode);setComplimentary(true);}}>Grant Complimentary (Admin)</Button>
                      <Button type="button" variant={subscriptionMode === "INACTIVE" ? "danger" : "secondary"} disabled={busy} onClick={() => setSubscriptionMode("INACTIVE")} style={{color:"var(--danger)"}}>Suspend Subscription</Button>
                    </div>
                    <p className="admin-edit-help admin-edit-spacing">Select an action, then Save changes to apply it. Changes affect this billing workspace and its members. Sign-in access is managed under Security.</p>
                  </div>
                  <div className="admin-edit-card">
                    <h3>Extend Trial or Active Subscription</h3>
                    <div className="admin-edit-extension">
                      <label><span>Add days</span><select value={extensionDays} disabled={busy} onChange={e => setExtensionDays(Number(e.target.value))}>{[3,5,7,14,30].map(days => <option key={days} value={days}>{days} days</option>)}</select></label>
                      <label><span>Reason for extension</span><input maxLength={500} value={extensionReason} disabled={busy} onChange={e => setExtensionReason(e.target.value)} placeholder="Reason for extending this account"/></label>
                      <Button type="button" variant={subscriptionMode === "EXTEND" ? "primary" : "secondary"} disabled={busy || !detail?.entitlement?.subscription?.id || !["ACTIVE","TRIALING","EXPIRED","ADMIN_GRANTED"].includes(detail?.entitlement?.subscription?.status)} onClick={() => setSubscriptionMode("EXTEND")}>Extend Period</Button>
                    </div>
                  </div>
                  {subscriptionMode !== "KEEP" && <div className="admin-edit-pending" role="status">Pending: {subscriptionMode === "INACTIVE" ? "Suspend subscription" : subscriptionMode === "EXTEND" ? 'Extend by ' + extensionDays + ' days' : (complimentary ? 'Complimentary ' : 'Paid ') + planCode + ' plan'}. Save changes to apply. <button type="button" onClick={() => setSubscriptionMode("KEEP")}>Undo subscription change</button></div>}
                  </>}
                </section>
                <section hidden={editTab !== "activity"} role="tabpanel" id="edit-user-panel-activity" aria-labelledby="edit-user-tab-activity">
                  <div className="admin-edit-card"><h3>Recent account activity</h3>{detail?.recentActivity?.length ? detail.recentActivity.map((event:any) => <div className="admin-user-detail-event" key={event.id}><strong>{event.action.replaceAll("_"," ")}</strong><small>{new Date(event.created_at).toLocaleString()}</small></div>) : <p className="admin-edit-help">No recorded account activity.</p>}</div>
                  <div className="admin-edit-card"><h3>Subscription history</h3>{detail?.subscriptionEvents?.length ? detail.subscriptionEvents.map((event:any) => <div className="admin-user-detail-event" key={event.id}><strong>{event.event_type.replaceAll("_"," ")}</strong><small>{new Date(event.created_at).toLocaleString()}</small></div>) : <p className="admin-edit-help">No subscription events recorded.</p>}</div>
                </section>
              </>
            ) : dialogMode === "edit" ? null : (
              <>
                {loading ? (
                  <p role="status">
                    <LoaderCircle size={16} className="admin-spin" /> Checking account impact…
                  </p>
                ) : (
                  impact && (
                    <>
                      <div className="admin-delete-impact">
                        <span>
                          <strong>{impact.posts}</strong> created posts
                        </span>
                        <span>
                          <strong>{impact.memberships}</strong> memberships
                        </span>
                      </div>
                      <div className="admin-dialog-notice">{impact.policy}</div>
                      <p className="admin-dialog-description">
                        Click Confirm deletion to permanently remove account access for this user.
                      </p>
                    </>
                  )
                )}
              </>
            )}

            {error && (
              <p className="admin-error" role="alert" style={{ margin: "8px 0" }}>
                {error}
              </p>
            )}
          </div>

          <div className="admin-dialog-footer">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || loading}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={dialogMode === "delete" ? "admin-danger-button" : ""}
              disabled={busy || loading || (dialogMode === "edit" && !ready) || (dialogMode === "delete" && !impact?.canDelete)}
            >
              {busy ? (
                <>
                  <LoaderCircle size={15} className="admin-spin" /> Saving…
                </>
              ) : dialogMode === "edit" ? (
                "Save changes"
              ) : (
                "Confirm deletion"
              )}
            </Button>
          </div>
        </form>
      </ModalFrame>
    </>
  );
}
