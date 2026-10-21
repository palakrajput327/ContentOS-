import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { User, ShieldCheck, CreditCard, History, X, Loader2 } from "lucide-react";
import { ModalFrame } from "./ui";
import { request } from "../lib/api";

const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "Not recorded";
const human = (value: string | undefined) => value ? value.replaceAll("_", " ").toLowerCase() : "Not available";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="admin-user-detail-field"><dt>{label}</dt><dd>{value ?? "Not recorded"}</dd></div>;
}

export default function AdminUserDetailModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [tab, setTab] = useState("profile");
  const { data, isLoading, isError, error, refetch } = useQuery<any>({
    queryKey: ["admin-user-detail", userId],
    queryFn: () => request(`/admin/users/${userId}/details`),
    enabled: !!userId,
  });
  if (!userId) return null;
  const profile = data?.profile;
  const entitlement = data?.entitlement;
  const expiry = entitlement?.effectiveState === "TRIAL_ACTIVE" ? entitlement?.trial?.endsAt : entitlement?.subscription?.currentPeriodEnd;

  return <ModalFrame open={!!userId} onClose={onClose} title="View user details" className="admin-detail-modal">
    <div className="admin-user-detail-content">
      <div className="admin-user-detail-heading">
        <div><h2>{profile?.name || "User details"}</h2><p>{profile?.email || "Read-only account details"}</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
      </div>
      <p className="admin-dialog-description">View only. To change user details or subscription access, close this window and choose Edit.</p>
      <div className="admin-user-detail-tabs" role="tablist" aria-label="User details">
        {[
          { id: "profile", label: "Profile", icon: User },
          { id: "security", label: "Security", icon: ShieldCheck },
          { id: "subscription", label: "Subscription & Limits", icon: CreditCard },
          { id: "activity", label: "Activity Logs", icon: History },
        ].map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={`user-detail-${id}`} id={`user-detail-tab-${id}`} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}
      </div>
      {isLoading ? <p role="status"><Loader2 size={20} className="admin-spin" /> Loading user records…</p>
        : isError ? <div role="alert"><p className="admin-error">{error instanceof Error ? error.message : "Unable to load user details."}</p><button type="button" onClick={() => refetch()}>Retry</button></div>
        : <div role="tabpanel" id={`user-detail-${tab}`} aria-labelledby={`user-detail-tab-${tab}`}>
          {tab === "profile" && <>
            <dl className="admin-user-detail-grid">
              <Detail label="Full name" value={profile?.name} />
              <Detail label="Email address" value={profile?.email} />
              <Detail label="Phone number" value={profile?.phoneNumber ? `${profile.phoneCountryCode || ""} ${profile.phoneNumber}`.trim() : "Not recorded"} />
              <Detail label="Sign-in access" value={profile?.accountStatus === "ACTIVE" ? "Enabled" : "Disabled"} />
              <Detail label="Joined" value={date(profile?.createdAt)} />
              <Detail label="Last updated" value={date(profile?.updatedAt)} />
              <Detail label="User ID" value={userId} />
              <Detail label="Internal admin note" value={profile?.adminNote || "No note"} />
            </dl>
            <h3>Workspaces</h3>
            {data?.memberships?.length ? data.memberships.map((membership: any) => <p key={membership.id}>{membership.name} · {membership.role}</p>) : <p className="admin-dialog-description">No workspace memberships.</p>}
          </>}
          {tab === "security" && <dl className="admin-user-detail-grid">
            <Detail label="Email verification" value={data?.security?.emailVerified ? "Verified" : "Unverified"} />
            <Detail label="Verified on" value={date(data?.security?.emailVerifiedAt)} />
            <Detail label="Recorded logins" value={data?.security?.loginCount ?? 0} />
            <Detail label="Active sessions" value={data?.security?.activeSessionsCount ?? 0} />
            <Detail label="Last login" value={date(data?.security?.lastLoginAt)} />
          </dl>}
          {tab === "subscription" && (entitlement ? <>
            <dl className="admin-user-detail-grid">
              <Detail label="Subscription access" value={entitlement.isLocked ? "Inactive" : "Active"} />
              <Detail label="Effective state" value={human(entitlement.effectiveState)} />
              <Detail label="Plan" value={entitlement.plan?.name || "No plan"} />
              <Detail label="Billing period" value={human(entitlement.plan?.billingPeriod)} />
              <Detail label="Daily posting allowance" value={entitlement.dailyPostingLimit != null ? `${entitlement.dailyPostingLimit} posts / day` : "Not available"} />
              <Detail label="Expiration" value={expiry ? date(expiry) : "No expiry set"} />
              <Detail label="Subscription started" value={date(entitlement.subscription?.startAt)} />
              <Detail label="Trial ends" value={date(entitlement.trial?.endsAt)} />
            </dl>
            <p className="admin-dialog-description">{entitlement.reason}</p>
          </> : <p className="admin-dialog-notice">{data?.workspaceId ? "Subscription details are unavailable for this workspace." : "This user has no billing workspace. No subscription or posting allowance is assigned."}</p>)}
          {tab === "activity" && <>
            <h3>Recent account activity</h3>
            {data?.recentActivity?.length ? data.recentActivity.map((event: any) => <div className="admin-user-detail-event" key={event.id}><strong>{human(event.action)}</strong><small>{date(event.created_at)}</small></div>) : <p className="admin-dialog-description">No recorded account activity.</p>}
            <h3>Subscription history</h3>
            {data?.subscriptionEvents?.length ? data.subscriptionEvents.map((event: any) => <div className="admin-user-detail-event" key={event.id}><strong>{human(event.event_type)}</strong><small>{date(event.created_at)}</small></div>) : <p className="admin-dialog-description">No subscription events recorded.</p>}
          </>}
        </div>}
    </div>
  </ModalFrame>;
}
