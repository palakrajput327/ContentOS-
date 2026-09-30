import { create } from "zustand";
interface Session {
  demo: boolean;
  workspaceId: string | null;
  user: { name: string; email: string } | null;
  enterDemo: () => void;
  login: (
    user: { name: string; email: string },
    workspaceId: string | null,
  ) => void;
  logout: () => void;
}
export const useSession = create<Session>((set) => ({
  demo: false,
  workspaceId: null,
  user: null,
  enterDemo: () =>
    set({
      demo: true,
      workspaceId: "demo",
      user: { name: "Alex Morgan", email: "alex@example.com" },
    }),
  login: (user, workspaceId) => set({ demo: false, user, workspaceId }),
  logout: () => set({ demo: false, user: null, workspaceId: null }),
}));
