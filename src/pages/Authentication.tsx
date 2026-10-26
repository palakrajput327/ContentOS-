import { PasswordInput } from "../components/PasswordInput";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Mail,
  CheckCircle2,
  LogOut,
  LockKeyhole,
  FileText,
  Shield,
  ExternalLink,
} from "lucide-react";
import { Button, Logo } from "../components/ui";
import { authRequest, type User } from "../lib/auth-client";
import { ThemeToggle } from '../lib/appearance';
import "./legal.css";

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
            <Link to="/privacy" target="_blank" style={{ textDecoration: "underline" }}>
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
export function Terms({ defaultTab }: { defaultTab?: "terms" | "privacy" }) {
  const location = useLocation();
  const [tab, setTab] = useState<"terms" | "privacy">(() => {
    if (defaultTab) return defaultTab;
    if (location.pathname.includes("/privacy") || location.hash === "#privacy") return "privacy";
    return "terms";
  });

  useEffect(() => {
    if (location.hash === "#privacy" || location.pathname.includes("/privacy")) {
      setTab("privacy");
    } else if (location.pathname.includes("/terms") && !location.hash) {
      setTab("terms");
    }
  }, [location]);

  return (
    <div className="legal-page-container">
      <div className="legal-page-wrapper">
        <header className="legal-header">
          <Link to="/" style={{ display: "inline-flex", textDecoration: "none" }}>
            <Logo />
          </Link>
          <div className="legal-header-actions">
            <ThemeToggle />
            <Button asChild variant="secondary">
              <Link to="/signup" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <ArrowLeft size={14} /> Back to Signup
              </Link>
            </Button>
          </div>
        </header>

        <div className="legal-hero">
          <div className="legal-badge-pill">
            <ShieldCheck size={14} /> Official Legal & Privacy Agreement
          </div>
          <h1>Terms of Service & Privacy Policy</h1>
          <p>
            Governing the use of ContentOS, the autonomous social media operating system by Hindustan Social Network.
            Effective date: October 2026.
          </p>
        </div>

        <div className="legal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "terms"}
            className={`legal-tab-btn ${tab === "terms" ? "active" : ""}`}
            onClick={() => setTab("terms")}
          >
            <FileText size={16} /> Terms of Service
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "privacy"}
            className={`legal-tab-btn ${tab === "privacy" ? "active" : ""}`}
            onClick={() => setTab("privacy")}
          >
            <Shield size={16} /> Privacy Policy
          </button>
        </div>

        <main className="legal-card">
          {tab === "terms" ? (
            <div className="legal-content">
              <div className="legal-section">
                <h2>1. Acceptance of Terms & Company Identity</h2>
                <p>
                  These Terms of Service constitute a legally binding agreement between you (&ldquo;User&rdquo; or &ldquo;Client&rdquo;)
                  and <strong>Hindustan Social Network</strong> (&ldquo;ContentOS&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;),
                  governing your access to and use of the ContentOS platform, application, and related services
                  (accessible at <a href="https://hidustansocialnetwork.in" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>hidustansocialnetwork.in</a>).
                </p>
                <p>
                  By creating an account, linking social media channels, or uploading content, you acknowledge that you have read,
                  understood, and agree to be bound by these Terms. If you are accepting on behalf of a company or organization,
                  you represent that you have full legal authority to bind that entity.
                </p>
              </div>

              <div className="legal-callout-box">
                <strong>🔒 Key Principle:</strong> You retain 100% full intellectual property ownership of your business PDFs,
                uploaded graphics, extracted brand assets, and generated social posts. ContentOS does not claim any ownership over your work.
              </div>

              <div className="legal-section">
                <h2>2. Platform Services & Autonomous AI Capabilities</h2>
                <p>
                  ContentOS provides an autonomous AI content workflow and digital publishing operating system designed to streamline
                  business marketing across multiple digital channels:
                </p>
                <ul>
                  <li><strong>Business PDF Ingestion:</strong> Automatic document parsing, knowledge extraction, and intelligent pairing of business visuals with social media concepts.</li>
                  <li><strong>Multi-Platform AI Copywriting:</strong> Automatic generation of tailored post copy, key takeaways, and hashtags formatted specifically for LinkedIn, Instagram, Facebook, YouTube, and Telegram.</li>
                  <li><strong>Day-by-Day Zero-Touch Scheduling:</strong> Automated scheduling engines that assign posts to designated future time slots (e.g., 10:00 AM daily) without manual intervention.</li>
                  <li><strong>Festival Auto-Greetings:</strong> Built-in detection of Indian and global festivals (Diwali, Holi, Eid, Independence Day, etc.) with automatic morning greeting poster scheduling.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>3. Social Media Account Integrations & Official APIs</h2>
                <p>
                  ContentOS connects with third-party social media platforms exclusively via their official, authorized developer APIs:
                </p>
                <ul>
                  <li><strong>Official OAuth 2.0:</strong> ContentOS accesses your social channels (LinkedIn, Meta / Instagram & Facebook, Google / YouTube, Telegram) strictly using authorized OAuth protocols. We never store or ask for your social media account passwords.</li>
                  <li><strong>Publishing Authority:</strong> By connecting an account, you grant ContentOS the authorization to publish, schedule, and format posts strictly according to your workspace settings.</li>
                  <li><strong>1-Click Revocation:</strong> You retain full autonomy. You can disconnect any social media channel at any time from your Channel Settings, which immediately invalidates and deletes the stored access tokens.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>4. Data Protection & Bank-Grade Security</h2>
                <p>
                  Hindustan Social Network enforces rigorous security standards across all customer data:
                </p>
                <ul>
                  <li><strong>AES-256-GCM Token Encryption:</strong> All social media OAuth access tokens and credentials are encrypted at rest using industry-standard AES-256-GCM cryptographic keys.</li>
                  <li><strong>Tenant Workspace Isolation:</strong> Your business documents, extracted images, drafts, and analytics are isolated to your workspace and never accessible by other tenants.</li>
                  <li><strong>Zero Public Model Training:</strong> Your confidential business PDFs and brand materials are never used to train public foundation AI models.</li>
                  <li><strong>Signed Media Storage:</strong> Uploaded assets and generated posters are secured using time-limited signed URLs to prevent unauthorized indexing or scraping.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>5. User Responsibilities & Acceptable Use</h2>
                <p>
                  To maintain platform reliability and protect our community, you agree not to use ContentOS to:
                </p>
                <ul>
                  <li>Publish content that is illegal, defamatory, fraudulent, or promotes harassment or hate speech.</li>
                  <li>Violate copyright, trademark, or proprietary rights of any third party.</li>
                  <li>Distribute malicious software, phishing campaigns, or unsolicited bulk spam in violation of social media platform developer policies.</li>
                  <li>Attempt to bypass rate limits, security measures, or reverse engineer any part of the service.</li>
                </ul>
                <p>
                  You are responsible for reviewing and managing the content generated and scheduled through your workspace.
                </p>
              </div>

              <div className="legal-section">
                <h2>6. Termination & Right to Data Erasure</h2>
                <p>
                  You may close your account or cancel your workspace subscription at any time. Upon account closure:
                </p>
                <ul>
                  <li>All active social publishing schedules are halted immediately.</li>
                  <li>Stored OAuth credentials, access tokens, and session data are permanently purged from our active databases.</li>
                  <li>You may request complete export or deletion of your uploaded business PDFs and media by contacting support.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>7. Governing Law & Contact Details</h2>
                <p>
                  These Terms are governed by and construed in accordance with the laws of India. For any legal inquiries, compliance audits, or enterprise licensing, contact:
                </p>
                <div style={{ background: "var(--surface2)", padding: "14px 18px", borderRadius: "10px", marginTop: "10px" }}>
                  <strong>Hindustan Social Network</strong><br />
                  <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    Legal & Compliance Department<br />
                    Email: <a href="mailto:support@hidustansocialnetwork.in" style={{ color: "var(--accent)" }}>support@hidustansocialnetwork.in</a><br />
                    Website: <a href="https://hidustansocialnetwork.in" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>https://hidustansocialnetwork.in</a>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="legal-content">
              <div className="legal-section">
                <h2>1. Privacy Commitment & Overview</h2>
                <p>
                  At <strong>Hindustan Social Network</strong> (&ldquo;ContentOS&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;),
                  protecting your personal and business privacy is a foundational priority. This Privacy Policy details our practices
                  regarding the collection, processing, storage, and protection of information when you use ContentOS.
                </p>
              </div>

              <div className="legal-callout-box">
                <strong>🛡️ Absolute Privacy Guarantee:</strong> We do NOT sell, rent, monetize, or share your personal data,
                business documents, or social media tokens with advertisers or third-party data brokers.
              </div>

              <div className="legal-section">
                <h2>2. Information We Collect</h2>
                <p>We collect only the minimum data necessary to deliver automated publishing services:</p>
                <ul>
                  <li><strong>Account Credentials:</strong> Full name, business email address, workspace title, and salted cryptographic password hashes (bcrypt).</li>
                  <li><strong>Social Media OAuth Tokens:</strong> Scoped, time-limited access tokens granted by you during 1-click social connection (LinkedIn, Meta, YouTube, Telegram) used solely to publish posts on your behalf.</li>
                  <li><strong>Workspace Content:</strong> Uploaded business PDFs, branding assets, images, and copy generated within your workspace.</li>
                  <li><strong>Security & Operational Logs:</strong> IP addresses (hashed for rate-limiting), login audit records, and publishing execution logs for workspace audit trails.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>3. How We Use Your Information</h2>
                <p>Your information is used strictly to provide the core services of ContentOS:</p>
                <ul>
                  <li>To ingest and parse your business PDFs and produce structured social media campaigns.</li>
                  <li>To publish and schedule approved visual posters and captions to your designated social platforms at configured times.</li>
                  <li>To authenticate your identity, prevent fraud, and send mandatory security alerts (such as OTP verification codes and password recovery).</li>
                  <li>To detect national/cultural festival days and prepare festival greeting posts per your workspace settings.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>4. AI Inference & Document Confidentiality</h2>
                <p>
                  When your uploaded business PDFs are processed:
                </p>
                <ul>
                  <li>Processing occurs through isolated, enterprise-tier AI APIs with strict zero-data-retention guarantees.</li>
                  <li><strong>Zero Model Training:</strong> Your business secrets, proprietary statistics, and proprietary documents are never incorporated into public LLM training datasets.</li>
                  <li>Your content remains strictly private to your authenticated workspace session.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>5. Security, Encryption & Storage Protocols</h2>
                <p>
                  We implement robust enterprise safeguards to protect your data against unauthorized access:
                </p>
                <ul>
                  <li><strong>AES-256-GCM Encryption:</strong> All sensitive social tokens are encrypted at rest with AES-256-GCM before being stored in our PostgreSQL database.</li>
                  <li><strong>Signed Time-Limited Media URLs:</strong> Media files stored in cloud object storage are served exclusively through cryptographically signed URLs that expire after 1 hour, preventing unauthorized public discovery.</li>
                  <li><strong>Strict Transport Security:</strong> All data in transit is encrypted using modern TLS (HTTPS) protocols.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>6. Your Rights & Data Erasure (GDPR / Indian DPDP Compliance)</h2>
                <p>
                  You hold full control over your personal and business data:
                </p>
                <ul>
                  <li><strong>Immediate Token Disconnection:</strong> Disconnecting any linked social account from the Channels page permanently deletes the corresponding OAuth token from our database instantly.</li>
                  <li><strong>Asset Deletion:</strong> Deleting a PDF or media asset removes the file and extracted knowledge from your workspace.</li>
                  <li><strong>Right to Erasure (Account Deletion):</strong> You may request complete deletion of your user account and all workspace data by submitting a request to <a href="mailto:privacy@hidustansocialnetwork.in" style={{ color: "var(--accent)" }}>privacy@hidustansocialnetwork.in</a>. All records will be permanently purged within 30 days.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>7. Cookies & Session Storage</h2>
                <p>
                  ContentOS uses only essential, secure HTTP-only cookies necessary for session authentication and appearance settings
                  (light/dark theme). We do not deploy third-party advertising tracking cookies or behavioral tracking pixels.
                </p>
              </div>

              <div className="legal-section">
                <h2>8. Google API & YouTube Limited Use Disclosure</h2>
                <p>
                  ContentOS accesses Google APIs (including YouTube Data API v3) exclusively to allow users to publish and schedule video content and view channel details upon explicit user authorization.
                </p>
                <ul>
                  <li><strong>Limited Use:</strong> ContentOS&apos;s use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Google API Services User Data Policy</a>, including the Limited Use requirements.</li>
                  <li><strong>Data Retention & Revocation:</strong> You can revoke ContentOS&apos;s access to your Google account at any time via your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Google Security Settings</a> or by disconnecting YouTube in ContentOS Channel Settings, which immediately deletes all stored access and refresh tokens.</li>
                  <li><strong>Third-Party Terms:</strong> ContentOS uses YouTube API Services. By using these features, you agree to be bound by the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>YouTube Terms of Service</a> and <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Google Privacy Policy</a>.</li>
                </ul>
              </div>

              <div className="legal-section">
                <h2>9. Data Protection Inquiries</h2>
                <p>
                  For any privacy questions, data subject requests, or security inquiries, please contact our Data Protection team:
                </p>
                <div style={{ background: "var(--surface2)", padding: "14px 18px", borderRadius: "10px", marginTop: "10px" }}>
                  <strong>Hindustan Social Network — Data Protection Office</strong><br />
                  <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    Email: <a href="mailto:privacy@hidustansocialnetwork.in" style={{ color: "var(--accent)" }}>privacy@hidustansocialnetwork.in</a> / <a href="mailto:support@hidustansocialnetwork.in" style={{ color: "var(--accent)" }}>support@hidustansocialnetwork.in</a><br />
                    Website: <a href="https://hidustansocialnetwork.in" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>https://hidustansocialnetwork.in</a>
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>

        <footer className="legal-footer-nav">
          <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            © {new Date().getFullYear()} Hindustan Social Network · All rights reserved.
          </div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <Link to="/login" style={{ fontSize: "0.85rem", color: "var(--accent)", textDecoration: "none" }}>
              Already registered? Log in
            </Link>
            <span style={{ color: "var(--border)" }}>•</span>
            <Link to="/signup" style={{ fontSize: "0.85rem", color: "var(--accent)", textDecoration: "none" }}>
              Create Account
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
