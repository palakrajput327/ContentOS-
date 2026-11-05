import { useSession } from "../lib/session";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CreditCard,
  Sparkles,
  Check,
  ArrowRight,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Building2,
  HelpCircle,
  X,
  Loader2,
  CalendarDays,
  Send,
  Zap,
  Lock,
} from "lucide-react";
import { request } from "../lib/api";
import { Button } from "../components/ui";
import "./billing.css";

interface Plan {
  id: string;
  code: "STARTER" | "GROWTH" | "SCALE";
  name: string;
  description: string;
  currency: string;
  monthlyPrice: number;
  yearlyPrice: number | null;
  dailyPostLimit: number;
  features: string[];
}

interface EntitlementResponse {
  entitlement: {
    workspaceId: string;
    effectiveState: "TRIAL_ACTIVE" | "PAID_ACTIVE" | "ADMIN_GRANTED" | "LOCKED" | "SUSPENDED";
    isLocked: boolean;
    canCreateContent: boolean;
    canPublish: boolean;
    canUseAI: boolean;
    dailyPostingLimit: number;
    plan: {
      id: string | null;
      code: string;
      name: string;
      monthlyPrice: number;
      yearlyPrice: number | null;
      billingPeriod: "MONTHLY" | "YEARLY";
    };
    trial: {
      active: boolean;
      startedAt: string | null;
      endsAt: string | null;
      remainingSeconds: number;
      daysRemaining: number;
      hoursRemaining: number;
      extensionCount: number;
    };
    subscription: {
      id: string | null;
      status: string;
      startAt: string | null;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
      customDailyLimit: number | null;
      adminOverrideNote: string | null;
    };
    reason: string;
  };
  usage: {
    date: string;
    timezone: string;
    postsUsedToday: number;
    postsReservedToday:number;
    dailyLimit: number;
    postsRemainingToday: number;
    usagePercentage: number;
  };
}

interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  billingPeriod: string;
  provider: string;
  providerReference: string | null;
  status: "PENDING" | "VERIFIED" | "APPROVED" | "REJECTED";
  paymentNotes: string | null;
  planName: string;
  planCode: string;
  createdAt: string;
  verifiedAt: string | null;
  isSimulated?: boolean;
}

export default function Billing() {
  const workspaceId=useSession(s=>s.workspaceId);
  const queryClient = useQueryClient();
  const [billingPeriod, setBillingPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [activePaymentModalPlan, setActivePaymentModalPlan] = useState<Plan | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Queries
  const { data: currentData, isLoading: loadingCurrent } = useQuery<EntitlementResponse>({
    queryKey: ["billing-current", workspaceId],
    queryFn: () => request<EntitlementResponse>("/billing/current"),
  });

  const { data: plansData } = useQuery<{ plans: Plan[] }>({
    queryKey: ["billing-plans"],
    queryFn: () => request<{ plans: Plan[] }>("/billing/plans"),
  });

  const { data: historyData } = useQuery<{ payments: PaymentRecord[] }>({
    queryKey: ["billing-history", workspaceId],
    queryFn: () => request<{ payments: PaymentRecord[] }>("/billing/history"),
  });

  const entitlement = currentData?.entitlement;
  const usage = currentData?.usage;
  const plans = plansData?.plans || [];
  const payments = historyData?.payments || [];

  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activePaymentModalPlan) return;
    setSubmittingPayment(true);
    try {
      await request("/billing/payment-request", "POST", {
        planCode: activePaymentModalPlan.code,
        billingPeriod,
        providerReference: reference.trim() || undefined,
        paymentNotes: notes.trim() || undefined,
      });

      toast.success("Simulated request submitted", {
        description:
          "Your simulated request was sent to Super Admin. Access activates only after approval. No funds were collected.",
      });

      setActivePaymentModalPlan(null);
      setReference("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["billing-history"] });
      queryClient.invalidateQueries({ queryKey: ["billing-current"] });
    } catch (err: any) {
      toast.error("Failed to submit payment request", {
        description: err?.message || "Please check details and try again.",
      });
    } finally {
      setSubmittingPayment(false);
    }
  }

  if (loadingCurrent) {
    return (
      <div className="billing-page">
        <div style={{ textAlign: "center", padding: "60px" }}>
          <Loader2 className="animate-spin" size={32} style={{ margin: "0 auto 16px auto", color: "var(--accent)" }} />
          <p>Loading your subscription and billing details…</p>
        </div>
      </div>
    );
  }

  const isTrial = entitlement?.effectiveState === "TRIAL_ACTIVE";
  const isLocked = entitlement?.isLocked;
  const currentPlanCode = entitlement?.plan.code;

  return (
    <div className="billing-page">
      {/* Header */}
      <div className="billing-header">
        <div className="billing-kicker">SUBSCRIPTION & USAGE</div>
        <h1>Plans & Billing</h1>
        <p>
          Manage your workspace subscription, daily posting allowances, and payment history.
        </p>
      </div>

      {/* Locked Workspace State Alert */}
      {isLocked && (
        <div className="locked-workspace-banner" id="locked-banner">
          <div className="locked-banner-content">
            <div className="locked-banner-icon">
              <Lock size={22} />
            </div>
            <div className="locked-banner-text">
              <h3>Your ContentOS trial has ended</h3>
              <p>
                Your content, drafts, and connected accounts are completely safe. Choose a plan below to resume creating and publishing.
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              document.getElementById("pricing-cards")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            View Plans
          </Button>
        </div>
      )}

      {/* Active Trial Hero Banner */}
      {isTrial && (
        <div className="trial-hero-card">
          <div className="trial-hero-top">
            <div className="trial-hero-title-group">
              <div className="trial-hero-icon">
                <Sparkles size={20} />
              </div>
              <div>
                <h3>Your ContentOS journey starts here</h3>
                <p>Enjoy 5 days of intelligent social media creation and scheduling with 3 posts per day.</p>
              </div>
            </div>
            <div className="trial-countdown-badge">
              <Clock size={16} />
              <span>
                {entitlement.trial.daysRemaining}d {entitlement.trial.hoursRemaining}h remaining
              </span>
            </div>
          </div>

          {/* Trial Progress Bar (out of 120 hours / 5 days) */}
          <div className="trial-progress-bar-container">
            <div
              className="trial-progress-fill"
              style={{
                width: `${Math.max(
                  5,
                  Math.min(
                    100,
                    100 - (entitlement.trial.remainingSeconds / (5 * 24 * 3600)) * 100,
                  ),
                )}%`,
              }}
            />
          </div>

          <div className="trial-hero-bottom">
            <span>5-day full access free trial • No credit card required</span>
            <span style={{ fontWeight: 500, color: "var(--accent)" }}>
              Upgrade anytime to unlock higher posting limits & festival engine
            </span>
          </div>
        </div>
      )}

      {/* Current Subscription & Usage Cards */}
      <div className="billing-status-grid">
        {/* Subscription Status Card */}
        <div className="billing-card">
          <div className="billing-card-header">
            <span>Current Entitlement</span>
            <span
              className={`billing-badge ${
                isTrial
                  ? "badge-trial"
                  : entitlement?.effectiveState === "PAID_ACTIVE"
                    ? "badge-active"
                    : entitlement?.effectiveState === "ADMIN_GRANTED"
                      ? "badge-admin"
                      : "badge-locked"
              }`}
            >
              {entitlement?.effectiveState === "TRIAL_ACTIVE"
                ? "Free Trial"
                : entitlement?.effectiveState === "PAID_ACTIVE"
                  ? "Paid Active"
                  : entitlement?.effectiveState === "ADMIN_GRANTED"
                    ? "Complimentary"
                    : "Expired / Locked"}
            </span>
          </div>
          <div className="billing-card-value">
            {entitlement?.plan.name || "Custom"}
          </div>
          <div className="billing-card-footer">
            {isTrial
              ? `Expires in ${entitlement.trial.daysRemaining} days (${new Date(entitlement.trial.endsAt || "").toLocaleDateString()})`
              : entitlement?.subscription.currentPeriodEnd
                ? `Valid until ${new Date(entitlement.subscription.currentPeriodEnd).toLocaleDateString()}`
                : "Active platform entitlement"}
          </div>
        </div>

        {/* Daily Capacity Meter Card */}
        <div className="billing-card">
          <div className="billing-card-header">
            <span>Today's Daily Quota</span>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              {usage?.timezone || "Asia/Kolkata"}
            </span>
          </div>
          <div className="billing-card-value">
            {usage?.postsUsedToday || 0} / {usage?.dailyLimit || 3} posts
          </div>
          <div className="usage-meter-bar">
            <div
              className="usage-meter-fill"
              style={{ width: `${usage?.usagePercentage || 0}%` }}
            />
          </div>
          <div className="billing-card-footer">
            <span>
              {usage?.postsRemainingToday || 0} slots remaining · {usage?.postsReservedToday || 0} reserved (resets at local midnight)
            </span>
          </div>
        </div>

        {/* Posting Rule Card */}
        <div className="billing-card">
          <div className="billing-card-header">
            <span>Quota Principle</span>
            <Zap size={16} style={{ color: "var(--accent)" }} />
          </div>
          <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--ink)" }}>
            1 successful platform publication = 1 unit
          </div>
          <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: 0, lineHeight: 1.4 }}>
            Each successful publication to a social account uses one unit. Pending jobs reserve capacity; definite failures release it, and retries never charge twice.
          </p>
        </div>
      </div>

      {/* Pricing Frequency Toggle */}
      <div className="pricing-switch-container" id="pricing-cards">
        <div className="pricing-switch-group">
          <button
            type="button"
            className={`pricing-switch-btn ${billingPeriod === "MONTHLY" ? "active" : ""}`}
            onClick={() => setBillingPeriod("MONTHLY")}
          >
            Monthly Billing
          </button>
          <button
            type="button"
            className={`pricing-switch-btn ${billingPeriod === "YEARLY" ? "active" : ""}`}
            onClick={() => setBillingPeriod("YEARLY")}
          >
            Annual Billing
          </button>
        </div>
        {billingPeriod === "YEARLY" && (
          <span className="yearly-discount-pill">
            Save 2 Months (Annual Discount)
          </span>
        )}
      </div>

      {/* Subscription Cards Grid */}
      <div className="subscription-cards-grid">
        {plans.map((p) => {
          const isCurrent = currentPlanCode === p.code && !isTrial && !isLocked;
          const isGrowth = p.code === "GROWTH";
          const displayPrice =
            billingPeriod === "YEARLY" && p.yearlyPrice
              ? Math.round(p.yearlyPrice / 12)
              : p.monthlyPrice;

          return (
            <div
              key={p.id}
              className={`plan-card ${isGrowth ? "popular" : ""}`}
            >
              {isGrowth && <div className="popular-ribbon">Most Popular</div>}

              <div className="plan-header">
                <h3>{p.name}</h3>
                <p className="plan-description">{p.description}</p>
              </div>

              <div className="plan-price-group">
                <span className="plan-price">₹{displayPrice.toLocaleString("en-IN")}</span>
                <span className="plan-frequency">/ month</span>
              </div>

              {billingPeriod === "YEARLY" && p.yearlyPrice && (
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "16px" }}>
                  Billed annually at ₹{p.yearlyPrice.toLocaleString("en-IN")}/year
                </div>
              )}

              <div className="plan-allowance-box">
                <CalendarDays size={18} />
                <span>Up to {p.dailyPostLimit} posts per day</span>
              </div>

              <ul className="plan-features-list">
                {p.features.map((feat, idx) => (
                  <li key={idx} className="plan-feature-item">
                    <Check size={16} />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className={`plan-action-btn ${
                  isCurrent ? "current" : isGrowth ? "primary" : "secondary"
                }`}
                disabled={isCurrent}
                onClick={() => setActivePaymentModalPlan(p)}
              >
                {isCurrent
                  ? "Current Plan"
                  : isLocked
                    ? `Unlock with ${p.name}`
                    : `Upgrade to ${p.name}`}
                {!isCurrent && <ArrowRight size={16} />}
              </button>
            </div>
          );
        })}
      </div>

      {/* Payment Request Modal Dialog */}
      {activePaymentModalPlan && (
        <div className="payment-modal-backdrop" onClick={() => setActivePaymentModalPlan(null)}>
          <div className="payment-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="payment-modal-header">
              <h3>Subscribe to {activePaymentModalPlan.name}</h3>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => setActivePaymentModalPlan(null)}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "20px" }}>
              Selected billing cycle: <strong>{billingPeriod === "YEARLY" ? "Annual" : "Monthly"}</strong>.
              Total amount:{" "}
              <strong style={{ color: "var(--accent)" }}>
                ₹
                {(billingPeriod === "YEARLY" && activePaymentModalPlan.yearlyPrice
                  ? activePaymentModalPlan.yearlyPrice
                  : activePaymentModalPlan.monthlyPrice
                ).toLocaleString("en-IN")}
              </strong>
            </p>

            <p className="bank-transfer-details-box">Simulated purchase only. No payment is collected or verified. An administrator must approve this request before access changes.</p>
            <form onSubmit={handlePaymentSubmit}>
              <label style={{ display: "block", marginBottom: "14px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--ink)" }}>
                  Request reference (optional)
                </span>
                <input
                  type="text"
                  placeholder="Optional reference for your request"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--ink)",
                    marginTop: "6px",
                  }}
                />
              </label>

              <label style={{ display: "block", marginBottom: "20px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--ink)" }}>
                  Notes for administrator
                </span>
                <textarea
                  rows={2}
                  placeholder="Optional note for the administrator..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--ink)",
                    marginTop: "6px",
                  }}
                />
              </label>

              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={submittingPayment}
                  onClick={() => setActivePaymentModalPlan(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={submittingPayment}>
                  {submittingPayment ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Submitting…
                    </>
                  ) : (
                    "Submit simulated request"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Billing History Section */}
      <div className="billing-history-section">
        <h2>Payment & Billing History</h2>
        <div className="billing-table-wrapper">
          {payments.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--muted)", fontSize: "0.9rem" }}>
              No billing transactions recorded yet.
            </div>
          ) : (
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Billing Cycle</th>
                  <th>Reference</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.planName}</strong>
                    </td>
                    <td>₹{p.amount.toLocaleString("en-IN")}</td>
                    <td>{p.billingPeriod}</td>
                    <td>
                      <span style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>
                        {p.providerReference || "Manual"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`billing-badge ${
                          (p.status === "VERIFIED" || p.status === "APPROVED")
                            ? "badge-active"
                            : p.status === "PENDING"
                              ? "badge-trial"
                              : "badge-locked"
                        }`}
                      >
                        {p.status}{p.isSimulated ? " · Simulated" : ""}
                      </span>
                    </td>
                    <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* FAQ & Support Section */}
      <div className="billing-faq-section">
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "16px" }}>
          Frequently Asked Questions
        </h2>
        <div className="billing-faq-grid">
          <div className="faq-card">
            <h4>What happens when my 5-day trial ends?</h4>
            <p>
              Your existing drafts, scheduled content, and connected accounts remain completely safe. You will be able to log in and review your workspace, but post publishing and AI Studio will pause until you activate a subscription.
            </p>
          </div>
          <div className="faq-card">
            <h4>How does daily posting allowance work?</h4>
            <p>
              Each successful platform publication counts once. Publishing one idea to three accounts uses three units. Pending and uncertain attempts reserve slots; definite failures release them. Usage resets at midnight in your workspace timezone.
            </p>
          </div>
          <div className="faq-card">
            <h4>How are simulated purchases approved?</h4>
            <p>
              Submit a simulated purchase request. Admin approval activates your subscription. No funds are transferred or verified.
            </p>
          </div>
          <div className="faq-card">
            <h4>Need a custom invoice or higher limits?</h4>
            <p>
              Contact our billing support team at{" "}
              <a href="mailto:billing@hidustansocialnetwork.in" style={{ color: "var(--accent)" }}>
                billing@hidustansocialnetwork.in
              </a>{" "}
              for custom agency quotas and GST invoicing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
