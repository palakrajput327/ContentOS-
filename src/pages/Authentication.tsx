import { PasswordInput } from "../components/PasswordInput";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRight,
  ShieldCheck,
  Mail,
  CheckCircle2,
  LogOut,
  LockKeyhole,
} from "lucide-react";
import { Button, Logo } from "../components/ui";
import { authRequest, type User } from "../lib/auth-client";
import { ThemeToggle } from '../lib/appearance';

export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
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
          <ShieldCheck size={15} /> Your account. Your identity. Your control.
        </small>
      </section>
      <section className="auth-form">
        <div className="auth-appearance"><ThemeToggle /></div>
        <Link className="back-link" to="/">
          ← Back to home
        </Link>
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </section>
    </div>
  );
}
import { PhoneInput, type Country } from "../components/PhoneInput";

const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(100),
    email: z.string().trim().email("Enter a valid email address"),
    password: z.string().min(12, "Use at least 12 characters").max(128),
    passwordConfirmation: z.string(),
    termsAccepted: z
      .boolean()
      .refine(
        (v) => v === true,
        "Please accept the Terms of Service and Privacy Policy",
      ),
  })
  .refine((v) => v.password === v.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Passwords do not match",
  });

export function Register() {
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const nav = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
  });

  return (
    <AuthLayout
      title="Start your 5-day free trial"
      description="Enjoy 5 days of intelligent content creation. 3 posts per day. No credit card required."
    >
      <div className="trial-pill-badge" style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        background: "rgba(249, 115, 22, 0.1)",
        border: "1px solid rgba(249, 115, 22, 0.25)",
        borderRadius: "999px",
        fontSize: "0.8rem",
        color: "var(--accent, #f97316)",
        fontWeight: 500,
        marginBottom: "16px",
      }}>
        <ShieldCheck size={14} /> Automatic 5-day trial with 3 daily posts
      </div>

      <form
        onSubmit={handleSubmit(async (values) => {
          try {
            setError("");
            await authRequest("/register", {
              ...values,
              phone: phone || undefined,
              phoneCountryCode: countryCode,
              termsVersion: "v1.0",
              privacyVersion: "v1.0",
            });
            nav("/check-email", { state: { email: values.email } });
          } catch (e) {
            setError((e as Error).message);
          }
        })}
      >
        <label>
          Full name
          <input
            {...register("name")}
            autoComplete="name"
            placeholder="Your name"
          />
          {errors.name && (
            <small className="error">{errors.name.message}</small>
          )}
        </label>
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
          Phone number (international)
          <PhoneInput
            value={phone}
            countryCode="IN"
            onChange={(e164, c) => {
              setPhone(e164);
              setCountryCode(c.dialCode);
            }}
          />
        </label>
        <label>
          Password
          <PasswordInput
            {...register("password")}
            type="password"
            autoComplete="new-password"
            placeholder="At least 12 characters"
          />
          {errors.password && (
            <small className="error">{errors.password.message}</small>
          )}
        </label>
        <label>
          Confirm password
          <PasswordInput
            {...register("passwordConfirmation")}
            type="password"
            autoComplete="new-password"
            placeholder="Enter your password again"
          />
          {errors.passwordConfirmation && (
            <small className="error">
              {errors.passwordConfirmation.message}
            </small>
          )}
        </label>
        <label className="checkbox-label" style={{ alignItems: "flex-start", gap: "10px", marginTop: "8px" }}>
          <input {...register("termsAccepted")} type="checkbox" style={{ marginTop: "3px" }} />
          <span style={{ fontSize: "0.85rem", lineHeight: "1.4" }}>
            I agree to the{" "}
            <Link to="/terms" target="_blank" style={{ textDecoration: "underline" }}>
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/terms#privacy" target="_blank" style={{ textDecoration: "underline" }}>
              Privacy Policy
            </Link>
            , and understand that I am responsible for reviewing the content and activities managed through my workspace.
          </span>
        </label>
        {errors.termsAccepted && (
          <p className="error">{errors.termsAccepted.message}</p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Creating your trial…" : "Start 5-day free trial"}
          <ArrowRight size={16} />
        </Button>
      </form>
      <p className="auth-switch">
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </AuthLayout>
  );
}
export function Login({
  onLogin,
}: {
  onLogin: (u: User) => void | Promise<void>;
}) {
  const [error, setError] = useState("");
  const nav = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ email: string; password: string }>();
  return (
    <AuthLayout
      title="Welcome back"
      description="Pick up where your ideas left off."
    >
      <form
        onSubmit={handleSubmit(async (values) => {
          try {
            setError("");
            const r = await authRequest<{ requiresCode: boolean; email: string; user?: User }>("/login", values);
            if (r.requiresCode) {
              nav("/login-code", { state: { email: r.email } });
            } else if (r.user) {
              await onLogin(r.user);
              nav("/app");
            } else {
              const me = await authRequest<{ user: User }>("/me");
              if (me?.user) await onLogin(me.user);
              nav("/app");
            }
          } catch (e: any) {
            if (e?.message?.toLowerCase()?.includes("verify your email")) {
              nav("/check-email", { state: { email: values.email } });
              return;
            }
            setError((e as Error).message);
          }
        })}
      >
        <label>
          Email address
          <input
            {...register("email")}
            required
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
          />
        </label>
        <label>
          Password
          <PasswordInput
            {...register("password")}
            required
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
          />
        </label>
        <div className="login-helper">
          <Link to="/forgot-password">Forgot password?</Link>
          <Link to="/check-email">Verify your email</Link>
        </div>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Logging in…" : "Log in"}
          <ArrowRight size={16} />
        </Button>
      </form>
      <p className="auth-switch">
        New to ContentOS? <Link to="/signup">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
export function ForgotPassword() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AuthLayout
      title="Let’s get you back in."
      description="Request a six-digit password-reset code for your verified account."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setBusy(true);
            setError("");
            const r = await authRequest<{ message: string }>(
              "/forgot-password",
              { email },
            );
            setMessage(r.message);
            nav("/reset-password", { state: { email } });
          } catch (e) {
            setError((e as Error).message);
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
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>
        {message && (
          <p className="success-box" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Sending…" : "Send reset code"}
          <Mail size={16} />
        </Button>
      </form>
      <p className="auth-switch">
        <Link to="/login">Back to login</Link>
      </p>
    </AuthLayout>
  );
}
export function Terms() {
  return (
    <div className="auth-page">
      <Logo />
      <h1>Development terms</h1>
      <p>
        This is a local development build of ContentOS. Create a test account to
        evaluate registration, email verification, and password recovery. Email
        verification uses your inbox.
      </p>
      <p>
        Do not enter confidential business content or reuse passwords from other
        services. Social publishing, AI services, and paid services are not
        enabled in this authentication phase.
      </p>
      <p>
        By accepting these development terms, you acknowledge this testing
        scope. Public production terms and privacy documentation must be
        finalized before launch.
      </p>
      <Button asChild>
        <Link to="/signup">Back to signup</Link>
      </Button>
    </div>
  );
}
