import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import Landing from "./pages/Landing";
import { useSession } from "./lib/session";
import { apiEnabled, request } from "./lib/api";
import Auth, { Onboarding } from "./pages/Auth";
import Shell from "./components/Shell";
import Overview from "./pages/Overview";
import Composer from "./pages/Composer";
import Library from "./pages/Library";
import Calendar from "./pages/Calendar";
import {
  Channels,
  Members,
  Activity,
  Settings,
  Analytics,
} from "./pages/Manage";
function Guard() {
  const user = useSession((x) => x.user);
  const wid = useSession((x) => x.workspaceId);
  return user ? (
    wid ? (
      <Shell />
    ) : (
      <Navigate to="/onboarding" />
    )
  ) : (
    <Navigate to="/login" />
  );
}
export default function App() {
  const nav = useNavigate();
  useEffect(() => {
    if (apiEnabled)
      request<{
        user: { name: string; email: string };
        workspaceId: string | null;
      }>("/auth/me")
        .then((s) => useSession.getState().login(s.user, s.workspaceId))
        .catch(() => {});
    const c = (
      document as Document & {
        modelContext?: {
          registerTool: (t: unknown, o: unknown) => Promise<void>;
        };
      }
    ).modelContext;
    if (!c) return;
    const controller = new AbortController();
    Promise.resolve(
      c.registerTool(
        {
          name: "open_demo_workspace",
          description:
            "Open the temporary sample workspace. Does not publish content or create a user account.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: async (input: unknown) => {
            if (
              !input ||
              typeof input !== "object" ||
              Object.keys(input).length
            )
              throw new Error("Expected an empty object");
            useSession.getState().enterDemo();
            nav("/app");
            return { mode: "demo", route: "/app" };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
    return () => controller.abort();
  }, [nav]);
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Auth />} />
      <Route path="/signup" element={<Auth signup />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/app" element={<Guard />}>
        <Route index element={<Overview />} />
        <Route path="studio" element={<Composer key="studio" studio />} />
        <Route path="compose" element={<Composer key="composer" />} />
        <Route path="library" element={<Library />} />
        <Route path="approvals" element={<Library approvals />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="channels" element={<Channels />} />
        <Route path="members" element={<Members />} />
        <Route path="activity" element={<Activity />} />
        <Route path="settings" element={<Settings />} />
        <Route path="analytics" element={<Analytics />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
