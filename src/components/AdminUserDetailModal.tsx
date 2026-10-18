import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  User,
  ShieldCheck,
  CreditCard,
  History,
  X,
  Key,
  Calendar,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  Building2,
  Zap,
} from "lucide-react";
import { ModalFrame, Button } from "./ui";
import { request } from "../lib/api";

interface AdminUserDetailModalProps {
  userId: string | null;
  onClose: () => void;
}

export default function AdminUserDetailModal({
  userId,
  onClose,
}: AdminUserDetailModalProps) {
  const client = useQueryClient();
  const [tab, setTab] = useState<"profile" | "security" | "subscription" | "activity">("profile");

  // Profile Edit Form State
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [status, setStatus] = useState("ACTIVE");
  const [note, setNote] = useState("");

  // Subscription Edit Form State
  const [planCode, setPlanCode] = useState("GROWTH");
  const [billingPeriod, setBillingPeriod] = useState("MONTHLY");
  const [customLimit, setCustomLimit] = useState<number | "">("");
  const [extensionDays, setExtensionDays] = useState(5);
  const [extensionReason, setExtensionReason] = useState("");

  // Action states
  const [saving, setSaving] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["admin-user-detail", userId],
    queryFn: async () => {
      if (!userId) return null;
      const res = await request<any>(`/admin/users/${userId}/details`);
      setName(res.profile.name);
      setPhone(res.profile.phoneNumber || "");
      setCountryCode(res.profile.phoneCountryCode || "+91");
      setStatus(res.profile.accountStatus);
      setNote(res.profile.adminNote || "");
      if (res.entitlement?.plan?.code) setPlanCode(res.entitlement.plan.code);
      if (res.entitlement?.subscription?.customDailyLimit) {
        setCustomLimit(res.entitlement.subscription.customDailyLimit);
      }
      return res;
    },
    enabled: !!userId,
  });

  if (!userId) return null;

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!data?.profile) return;
    setSaving(true);
    try {
      await request(`/admin/users/${userId}`, "PATCH", {
        name: name.trim(),
        phone: phone.trim() || undefined,
        countryCode,
        status,
        note: note.trim(),
        version: data.profile.adminVersion,
      });
      toast.success("User profile updated successfully");
      await refetch();
      await client.invalidateQueries({ queryKey: ["super-admin", "users"] });
    } catch (err: any) {
      toast.error("Failed to update profile", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!confirm("Are you sure you want to generate a secure temporary password for this user? This will revoke active sessions.")) return;
    setSaving(true);
    try {
      const res = await request<any>(`/admin/users/${userId}/password-reset`, "POST", {});
      setTempPassword(res.tempPassword);
      toast.success("Temporary password generated");
      await refetch();
    } catch (err: any) {
      toast.error("Password reset failed", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleActivateSubscription(complimentary = false) {
    const subId = data?.entitlement?.subscription?.id;
    if (!subId) {
      toast.error("No subscription record associated with user's workspace");
      return;
    }
    setSaving(true);
    try {
      await request(`/admin/subscriptions/${subId}/activate`, "POST", {
        planCode,
        billingPeriod,
        complimentary,
        customDailyLimit: customLimit ? Number(customLimit) : undefined,
      });
      toast.success(`Subscription ${complimentary ? "granted as complimentary" : "activated"}`);
      await refetch();
      await client.invalidateQueries({ queryKey: ["super-admin"] });
    } catch (err: any) {
      toast.error("Subscription activation failed", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleExtendSubscription() {
    const subId = data?.entitlement?.subscription?.id;
    if (!subId) return;
    if (!extensionReason.trim()) {
      toast.error("Please enter a reason for the extension");
      return;
    }
    setSaving(true);
    try {
      await request(`/admin/subscriptions/${subId}/extend`, "POST", {
        days: extensionDays,
        reason: extensionReason.trim(),
      });
      toast.success(`Subscription extended by ${extensionDays} days`);
      setExtensionReason("");
      await refetch();
      await client.invalidateQueries({ queryKey: ["super-admin"] });
    } catch (err: any) {
      toast.error("Extension failed", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSuspendSubscription() {
    const subId = data?.entitlement?.subscription?.id;
    if (!subId) return;
    if (!confirm("Suspend workspace subscription? User will be blocked from creating, scheduling, or publishing content.")) return;
    setSaving(true);
    try {
      await request(`/admin/subscriptions/${subId}/suspend`, "POST", {
        reason: "Administrative suspension",
      });
      toast.success("Workspace subscription suspended");
      await refetch();
      await client.invalidateQueries({ queryKey: ["super-admin"] });
    } catch (err: any) {
      toast.error("Suspension failed", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalFrame open={!!userId} onClose={onClose} title="User Administration" className="admin-detail-modal">
      <div style={{ padding: "20px 24px", maxWidth: "780px", width: "100%" }}>
        {/* Modal Top Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>
              {data?.profile?.name || "Loading user…"}
            </h2>
            <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: "4px 0 0 0" }}>
              {data?.profile?.email} • ID: <code style={{ fontSize: "0.8rem" }}>{userId}</code>
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: "20px", gap: "8px" }}>
          {[
            { id: "profile", label: "Profile", icon: User },
            { id: "security", label: "Security", icon: ShieldCheck },
            { id: "subscription", label: "Subscription & Limits", icon: CreditCard },
            { id: "activity", label: "Activity Logs", icon: History },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id as any)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  background: "transparent",
                  border: "none",
                  borderBottom: active ? "2px solid var(--accent, #f97316)" : "2px solid transparent",
                  color: active ? "var(--ink)" : "var(--muted)",
                  fontWeight: active ? 600 : 500,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                }}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <Loader2 className="animate-spin" size={28} style={{ margin: "0 auto 12px auto", color: "var(--accent)" }} />
            <p style={{ color: "var(--muted)" }}>Loading user records…</p>
          </div>
        ) : (
          <div>
            {/* TAB 1: PROFILE */}
            {tab === "profile" && (
              <form onSubmit={handleSaveProfile} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Full Name</span>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    />
                  </label>
                  <label>
                    <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Email Address (Registered)</span>
                    <input
                      disabled
                      value={data?.profile?.email || ""}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)" }}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Phone Number</span>
                    <input
                      value={phone}
                      placeholder="+91 9876543210"
                      onChange={(e) => setPhone(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    />
                  </label>
                  <label>
                    <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Account Status</span>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    >
                      <option value="ACTIVE">ACTIVE • Full Platform Login Allowed</option>
                      <option value="SUSPENDED">SUSPENDED • Sessions Revoked & Sign-in Blocked</option>
                    </select>
                  </label>
                </div>

                <label>
                  <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Internal Administrator Note</span>
                  <textarea
                    rows={3}
                    placeholder="Context, verified payment information, or account notes..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                  />
                  <small style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Visible to platform administrators only. Never shared with user.</small>
                </label>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                  <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                  <Button type="submit" variant="primary" disabled={saving}>
                    {saving ? "Saving…" : "Save Profile Changes"}
                  </Button>
                </div>
              </form>
            )}

            {/* TAB 2: SECURITY */}
            {tab === "security" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                  <div style={{ background: "var(--surface2)", padding: "12px 16px", borderRadius: "8px" }}>
                    <small style={{ color: "var(--muted)" }}>Email Verification</small>
                    <div style={{ fontWeight: 600, marginTop: "4px", color: data?.security?.emailVerified ? "#22c55e" : "#ef4444" }}>
                      {data?.security?.emailVerified ? "Verified" : "Unverified"}
                    </div>
                  </div>
                  <div style={{ background: "var(--surface2)", padding: "12px 16px", borderRadius: "8px" }}>
                    <small style={{ color: "var(--muted)" }}>Recorded Logins</small>
                    <div style={{ fontWeight: 600, marginTop: "4px" }}>
                      {data?.security?.loginCount || 0} times
                    </div>
                  </div>
                  <div style={{ background: "var(--surface2)", padding: "12px 16px", borderRadius: "8px" }}>
                    <small style={{ color: "var(--muted)" }}>Active Sessions</small>
                    <div style={{ fontWeight: 600, marginTop: "4px" }}>
                      {data?.security?.activeSessionsCount || 0} active
                    </div>
                  </div>
                </div>

                <div style={{ background: "rgba(249, 115, 22, 0.08)", border: "1px solid rgba(249, 115, 22, 0.25)", borderRadius: "10px", padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                    <Key size={18} style={{ color: "var(--accent)" }} />
                    <span>Administrative Password Reset</span>
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 14px 0", lineHeight: 1.4 }}>
                    Generate a random, short-lived temporary password. Existing user sessions and tokens are automatically revoked. The password hash is never exposed.
                  </p>
                  <Button type="button" variant="primary" disabled={saving} onClick={handleResetPassword}>
                    Generate Temporary Password
                  </Button>

                  {tempPassword && (
                    <div style={{ marginTop: "14px", padding: "12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <small style={{ color: "var(--muted)", display: "block" }}>Temporary Password (Copy now — not shown again):</small>
                        <code style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)" }}>{tempPassword}</code>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          navigator.clipboard.writeText(tempPassword);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: SUBSCRIPTION & LIMITS */}
            {tab === "subscription" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                {/* Entitlement Summary Bar */}
                <div style={{ background: "var(--surface2)", padding: "16px 20px", borderRadius: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Effective State</span>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "2px" }}>
                      {data?.entitlement?.effectiveState} ({data?.entitlement?.plan?.name})
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Daily Posting Allowance</span>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "2px", color: "var(--accent)" }}>
                      {data?.entitlement?.dailyPostingLimit} posts / day
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Expiration</span>
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, marginTop: "2px" }}>
                      {data?.entitlement?.subscription?.currentPeriodEnd
                        ? new Date(data.entitlement.subscription.currentPeriodEnd).toLocaleDateString()
                        : data?.entitlement?.trial?.endsAt
                          ? new Date(data.entitlement.trial.endsAt).toLocaleDateString()
                          : "No expiry set"}
                    </div>
                  </div>
                </div>

                {/* Subscription Action Form */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "18px" }}>
                  <h4 style={{ margin: "0 0 12px 0", fontSize: "0.98rem" }}>Change Plan or Activate Subscription</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                    <label>
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Plan</span>
                      <select
                        value={planCode}
                        onChange={(e) => setPlanCode(e.target.value)}
                        style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                      >
                        <option value="STARTER">STARTER (₹15,000/mo, 3 posts/day)</option>
                        <option value="GROWTH">GROWTH (₹25,000/mo, 5 posts/day)</option>
                        <option value="SCALE">SCALE (₹50,000/mo, 10 posts/day)</option>
                      </select>
                    </label>

                    <label>
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Billing Frequency</span>
                      <select
                        value={billingPeriod}
                        onChange={(e) => setBillingPeriod(e.target.value)}
                        style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                      >
                        <option value="MONTHLY">Monthly</option>
                        <option value="YEARLY">Yearly (Annual)</option>
                      </select>
                    </label>

                    <label>
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Custom Posting Limit (override)</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        placeholder="Default from plan"
                        value={customLimit}
                        onChange={(e) => setCustomLimit(e.target.value ? Number(e.target.value) : "")}
                        style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                      />
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <Button type="button" variant="primary" disabled={saving} onClick={() => handleActivateSubscription(false)}>
                      Activate Paid Plan
                    </Button>
                    <Button type="button" variant="secondary" disabled={saving} onClick={() => handleActivateSubscription(true)}>
                      Grant Complimentary (Admin)
                    </Button>
                    <Button type="button" variant="secondary" disabled={saving} onClick={handleSuspendSubscription} style={{ color: "#ef4444" }}>
                      Suspend Subscription
                    </Button>
                  </div>
                </div>

                {/* Extend Subscription or Trial */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "18px" }}>
                  <h4 style={{ margin: "0 0 12px 0", fontSize: "0.98rem" }}>Extend Trial or Active Subscription</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: "12px", alignItems: "flex-end" }}>
                    <label>
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Add Days</span>
                      <select
                        value={extensionDays}
                        onChange={(e) => setExtensionDays(Number(e.target.value))}
                        style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                      >
                        <option value={3}>3 Days</option>
                        <option value={5}>5 Days</option>
                        <option value={7}>7 Days</option>
                        <option value={14}>14 Days</option>
                        <option value={30}>30 Days</option>
                      </select>
                    </label>
                    <label>
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Reason for Extension</span>
                      <input
                        required
                        placeholder="e.g. Courtesy trial extension requested via WhatsApp support"
                        value={extensionReason}
                        onChange={(e) => setExtensionReason(e.target.value)}
                        style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                      />
                    </label>
                    <Button type="button" variant="secondary" disabled={saving} onClick={handleExtendSubscription}>
                      Extend Period
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: ACTIVITY */}
            {tab === "activity" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Recent Authentication & System Events</h4>
                <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" }}>
                  {(data?.recentActivity || []).length === 0 ? (
                    <div style={{ padding: "16px", textAlign: "center", color: "var(--muted)" }}>No recorded events</div>
                  ) : (
                    data.recentActivity.map((a: any) => (
                      <div key={a.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                        <strong>{a.action}</strong>
                        <small style={{ color: "var(--muted)" }}>{new Date(a.created_at).toLocaleString()}</small>
                      </div>
                    ))
                  )}
                </div>

                <h4 style={{ margin: "10px 0 0 0", fontSize: "0.95rem" }}>Workspace Subscription Events</h4>
                <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" }}>
                  {(data?.subscriptionEvents || []).length === 0 ? (
                    <div style={{ padding: "16px", textAlign: "center", color: "var(--muted)" }}>No subscription events recorded yet</div>
                  ) : (
                    data.subscriptionEvents.map((e: any) => (
                      <div key={e.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                        <div>
                          <strong>{e.event_type}</strong>
                          <span style={{ marginLeft: "8px", color: "var(--muted)", fontSize: "0.78rem" }}>
                            {JSON.stringify(e.details)}
                          </span>
                        </div>
                        <small style={{ color: "var(--muted)" }}>{new Date(e.created_at).toLocaleString()}</small>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}
