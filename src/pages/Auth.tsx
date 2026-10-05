import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Logo, Button } from "../components/ui";
import { request, apiEnabled } from "../lib/api";
import { useSession } from "../lib/session";
const schema = z.object({
  name: z.string().max(100).optional(),
  email: z.string().email(),
  password: z.string().min(12, "Use at least 12 characters").max(128),
});
export default function Auth({ signup = false }: { signup?: boolean }) {
  const nav = useNavigate();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mode, setMode] = useState<"auth" | "forgot">("auth");
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Link to="/">
          <Logo />
        </Link>
        <div>
          <span className="section-kicker">YOUR NEXT CHAPTER</span>
          <h1>
            A little more clarity.
            <br />A lot more creativity.
          </h1>
          <p>
            A shared space for your ideas, your content,
            <br />
            and the people who bring it all together.
          </p>
          <div className="auth-art">
            <span>KNOWLEDGE</span>
            <i />
            <span>CREATION</span>
            <i />
            <span>CONNECTION</span>
          </div>
        </div>
        <small>
          <ShieldCheck size={15} /> Your content. Your team. Your control.
        </small>
      </section>
      <section className="auth-form">
        <Link className="back-link" to="/">
          ← Back to home
        </Link>
        <h2>
          {mode === "forgot"
            ? "Reset your password"
            : signup
              ? "Create your account"
              : "Welcome back"}
        </h2>
        <p>
          {mode === "forgot"
            ? forgotStep === 1
              ? "Enter your email to receive a 6-digit verification code."
              : "Enter the code sent to your email and set a new password."
            : signup
              ? "Give your social presence a place to grow."
              : "Pick up where your ideas left off."}
        </p>
        {!apiEnabled ? (
          <div className="notice">
            <strong>This is the product preview.</strong>
            <p>
              Account creation needs the application server. Explore a temporary
              sample workspace now, or follow the included setup guide to run
              the full MVP.
            </p>
            <Button
              variant="primary"
              onClick={() => {
                useSession.getState().enterDemo();
                nav("/app");
              }}
            >
              Explore demo workspace <ArrowRight size={16} />
            </Button>
          </div>
        ) : mode === "forgot" ? (
          <div>
            {forgotStep === 1 ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    setError("");
                    setSuccess("");
                    setBusy(true);
                    await request("/auth/forgot-password", "POST", {
                      email: forgotEmail,
                    });
                    setSuccess(
                      "If an account exists, a 6-digit verification code has been queued to your email.",
                    );
                    setForgotStep(2);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Email address
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </label>
                {error && <div className="error-box" role="alert">{error}</div>}
                {success && <div className="notice">{success}</div>}
                <Button variant="primary" type="submit" disabled={busy}>
                  {busy ? "Sending code…" : "Send verification code"}
                  <ArrowRight size={16} />
                </Button>
              </form>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    setError("");
                    setSuccess("");
                    setBusy(true);
                    await request("/auth/reset-password", "POST", {
                      email: forgotEmail,
                      code: forgotCode,
                      password: newPassword,
                      passwordConfirmation: newPassword,
                    });
                    setSuccess("Password updated successfully. You can now log in.");
                    setTimeout(() => {
                      setMode("auth");
                      setForgotStep(1);
                    }, 2000);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  6-Digit OTP Code
                  <input
                    type="text"
                    required
                    maxLength={6}
                    pattern="\d{6}"
                    value={forgotCode}
                    onChange={(e) => setForgotCode(e.target.value)}
                    placeholder="123456"
                  />
                </label>
                <label>
                  New Password
                  <input
                    type="password"
                    required
                    minLength={12}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 12 characters"
                  />
                </label>
                {error && <div className="error-box" role="alert">{error}</div>}
                {success && <div className="notice">{success}</div>}
                <Button variant="primary" type="submit" disabled={busy}>
                  {busy ? "Updating password…" : "Reset Password & Log In"}
                  <ArrowRight size={16} />
                </Button>
              </form>
            )}
            <p className="auth-switch" style={{ marginTop: "16px" }}>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode("auth");
                  setError("");
                  setSuccess("");
                }}
              >
                ← Back to Log In
              </button>
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(async (values) => {
              try {
                setError("");
                setSuccess("");
                const s = await request<{
                  user: { name: string; email: string };
                  workspaceId: string | null;
                  requiresCode?: boolean;
                  message?: string;
                }>(`/auth/${signup ? "signup" : "login"}`, "POST", values);

                if (signup) {
                  setSuccess(
                    s.message ||
                      "Account created! A verification code was queued to your email.",
                  );
                } else if (s.requiresCode) {
                  setSuccess(s.message || "Enter your sign-in code.");
                } else {
                  useSession.getState().login(s.user, s.workspaceId);
                  nav(s.workspaceId ? "/app" : "/onboarding");
                }
              } catch (e) {
                setError((e as Error).message);
              }
            })}
          >
            {signup && (
              <label>
                Full name
                <input
                  {...register("name")}
                  required
                  autoComplete="name"
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                {...register("email")}
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
              />
              {errors.email && (
                <small className="error">{errors.email.message}</small>
              )}
            </label>
            <label>
              Password
              <input
                {...register("password")}
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                placeholder="At least 12 characters"
              />
              {errors.password && (
                <small className="error">{errors.password.message}</small>
              )}
            </label>

            {!signup && (
              <div style={{ textAlign: "right", marginTop: "-6px", marginBottom: "12px" }}>
                <button
                  type="button"
                  className="text-button"
                  style={{ fontSize: "0.85rem", color: "var(--color-accent, #6366f1)" }}
                  onClick={() => {
                    setMode("forgot");
                    setForgotStep(1);
                    setError("");
                    setSuccess("");
                  }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <div role="alert" className="error-box">
                {error}
              </div>
            )}
            {success && <div className="notice">{success}</div>}

            <Button variant="primary" disabled={isSubmitting} type="submit">
              {isSubmitting
                ? "Please wait…"
                : signup
                  ? "Create account"
                  : "Log in"}
              <ArrowRight size={16} />
            </Button>
          </form>
        )}
        <p className="auth-switch">
          {signup ? "Already have an account?" : "New to ContentOS?"}{" "}
          <Link to={signup ? "/login" : "/signup"}>
            {signup ? "Log in" : "Create an account"}
          </Link>
        </p>
      </section>
    </div>
  );
}
export function Onboarding() {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  return (
    <div className="auth-page">
      <Logo />
      <h1>A home for your team.</h1>
      <p>
        Name your workspace. You can configure your brand and invite
        collaborators next.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setBusy(true);
            const w = await request<{ id: string }>("/workspaces", "POST", {
              name,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            useSession.getState().login(useSession.getState().user!, w.id);
            nav("/app");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Workspace name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder="Your company or team"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          Create workspace <ArrowRight size={16} />
        </Button>
      </form>
    </div>
  );
}
