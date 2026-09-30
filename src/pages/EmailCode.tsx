import { PasswordInput } from "../components/PasswordInput";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "./Authentication";
import { Button } from "../components/ui";
import { useSession } from "../lib/session";
import { authRequest, type User } from "../lib/auth-client";
export default function EmailCode({ reset = false, login = false }: { reset?: boolean; login?: boolean }) {
  const nav=useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(location.state?.email ? 60 : 0);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  async function resend() {
    setBusy(true);
    setError("");
    try {
      const r = await authRequest<{ message: string }>(
        reset ? "/forgot-password" : login ? "/login/resend" : "/email/resend",
        { email },
      );
      setMessage(r.message);
      setCooldown(60);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      title={
        done
          ? "You’re all set."
          : reset
            ? "Reset your password"
            : login ? "Confirm your sign-in" : "Verify your email"
      }
      description={
        done
          ? "Log in to your workspace."
          : "Enter the six-digit code from your email. Codes expire after 10 minutes."
      }
    >
      {done ? (
        <Button asChild variant="primary">
          <Link to="/login">Continue to login</Link>
        </Button>
      ) : (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setMessage("");
              if (reset && password !== confirmation) {
                setError("Passwords do not match");
                return;
              }
              setBusy(true);
              try {
                const result=await authRequest<{user:User;workspaceId:string}>(reset ? "/reset-password" : login ? "/login/verify" : "/email/verify", {
                  email,
                  code,
                  ...(reset
                    ? { password, passwordConfirmation: confirmation }
                    : {}),
                });
                if(!reset){useSession.getState().login(result.user,result.workspaceId);nav("/app",{replace:true});}else setDone(true);
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
              />
            </label>
            <label>
              Six-digit code
              <input
                className="verification-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
              />
            </label>
            {reset && (
              <>
                <label>
                  New password
                  <PasswordInput
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  Confirm password
                  <PasswordInput
                    required
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
              </>
            )}
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="success-box" role="status">
                {message}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : reset
                  ? "Update password"
                  : "Verify & open dashboard"}
            </Button>
          </form>
          <Button disabled={busy || cooldown > 0 || !email} onClick={resend}>
            {cooldown ? `Resend in ${cooldown}s` : "Send a new code"}
          </Button>
          <p className="auth-switch">
            Check your spam folder. Sending is queued; inbox delivery is not
            guaranteed. <Link to="/login">Back to login</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
