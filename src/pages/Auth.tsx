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
        <h2>{signup ? "Create your account" : "Welcome back"}</h2>
        <p>
          {signup
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
        ) : (
          <form
            onSubmit={handleSubmit(async (values) => {
              try {
                setError("");
                const s = await request<{
                  user: { name: string; email: string };
                  workspaceId: string | null;
                }>(`/auth/${signup ? "signup" : "login"}`, "POST", values);
                useSession.getState().login(s.user, s.workspaceId);
                nav(s.workspaceId ? "/app" : "/onboarding");
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
            {error && (
              <div role="alert" className="error-box">
                {error}
              </div>
            )}
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
