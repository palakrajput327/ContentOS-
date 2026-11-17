import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import { Register, Login, ForgotPassword, Terms } from "./pages/Authentication";
import EmailCode from "./pages/EmailCode";
import { authRequest, type User } from "./lib/auth-client";
import { useSession } from "./lib/session";
import Shell from "./components/Shell";
const Overview = lazy(() => import("./pages/Overview"));
const Composer = lazy(() => import("./pages/Composer"));
const AIStudio = lazy(() => import("./pages/AIStudio"));
const Library = lazy(() => import("./pages/Library"));
const Calendar = lazy(() => import("./pages/Calendar"));
const FestivalAutomation = lazy(() => import("./pages/FestivalAutomation"));
const Channels = lazy(() => import("./pages/Manage").then(m => ({ default: m.Channels })));
const Members = lazy(() => import("./pages/Manage").then(m => ({ default: m.Members })));
const Activity = lazy(() => import("./pages/Manage").then(m => ({ default: m.Activity })));
const Settings = lazy(() => import("./pages/Manage").then(m => ({ default: m.Settings })));
const Analytics = lazy(() => import("./pages/Manage").then(m => ({ default: m.Analytics })));
const Admin = lazy(() => import("./pages/Admin"));
const Billing = lazy(() => import("./pages/Billing"));
export default function AuthApp() {
  const session = useSession();
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let alive = true;
    authRequest<{ user: User; workspaceId: string }>("/me")
      .then((r) => {
        if (alive) useSession.getState().login(r.user, r.workspaceId);
      })
      .catch(() => {
        if (alive) useSession.getState().logout();
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function signedIn(user: User) {
    const r = await authRequest<{ workspaceId: string }>("/me");
    useSession.getState().login(user, r.workspaceId);
  }
  if (checking)
    return <div className="loading-state">Checking your session…</div>;
  return (
    <Suspense fallback={<div className="loading-state" role="status">Loading your workspace…</div>}><Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/signup"
        element={session.user ? <Navigate to="/app" /> : <Register />}
      />
      <Route
        path="/login"
        element={
          session.user ? <Navigate to="/app" /> : <Login onLogin={signedIn} />
        }
      />
      <Route path="/check-email" element={<EmailCode />} />
      <Route path="/login-code" element={<EmailCode key="login-code" login />} />
      <Route path="/verify-email" element={<EmailCode />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<EmailCode reset />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Terms defaultTab="privacy" />} />
      <Route path="/admin" element={<Admin />} />
      <Route
        path="/app"
        element={
          session.user && session.workspaceId ? (
            <Shell />
          ) : (
            <Navigate to="/login" />
          )
        }
      >
        <Route index element={<Overview />} />
        <Route path="studio" element={<AIStudio />} />
        <Route path="compose" element={<Composer key="compose" />} />
        <Route path="library" element={<Library />} />
        <Route path="approvals" element={<Library approvals />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="festivals" element={<FestivalAutomation />} />
        <Route path="automation" element={<Navigate to="/app/studio?tab=automation" replace />} />
        <Route path="channels" element={<Channels />} />
        <Route path="members" element={<Members />} />
        <Route path="activity" element={<Activity />} />
        <Route path="settings" element={<Settings />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="billing" element={<Billing />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={session.user ? "/app" : "/login"} />}
      />
    </Routes></Suspense>
  );
}
