import { refresh } from "./auth-client";
import { useSession } from "./session";
import { demoSnapshot, type Snapshot, type Post, type Brand } from "./model";
let demo = demoSnapshot();
export const apiEnabled = import.meta.env.VITE_API_ENABLED === "true";
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  retry = true,
): Promise<T> {
  const wid = useSession.getState().workspaceId;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(wid ? { "X-Workspace-Id": wid } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const isAuthRequest = path.startsWith("/auth/");
  if (res.status === 401 && retry && !isAuthRequest) {
    try {
      await refresh();
      return request<T>(path, method, body, false);
    } catch {
      useSession.getState().logout();
      window.location.assign("/login");
      throw new Error("Please log in again.");
    }
  }
  let value;
  try {
    value = await res.json();
  } catch {
    throw new Error(
      "The application server is unavailable. Please try again shortly.",
    );
  }
  if (!res.ok)
    throw new Error(value.message || "Something went wrong. Please try again.");
  return value.data;
}
function log(action: string, entity: string) {
  demo.activity.unshift({
    id: crypto.randomUUID(),
    actor: "Alex Morgan",
    action,
    entity,
    at: new Date().toISOString(),
  });
}
export const data = {
  snapshot: async (): Promise<Snapshot> =>
    useSession.getState().demo
      ? structuredClone(demo)
      : request("/workspaces/current"),
  save: async (post: Partial<Post>): Promise<Post> => {
    if (!useSession.getState().demo)
      return request(
        `/content${post.id ? `/${post.id}` : ""}`,
        post.id ? "PATCH" : "POST",
        post,
      );
    const old = demo.posts.find((p) => p.id === post.id);
    const next = {
      ...old,
      ...post,
      id: old?.id || crypto.randomUUID(),
      createdAt: old?.createdAt || new Date().toISOString(),
      status: "DRAFT",
      creator: "Alex Morgan",
      version: (old?.version || 0) + 1,
    } as Post;
    demo.posts = demo.posts.filter((p) => p.id !== next.id);
    demo.posts.unshift(next);
    log(old ? "edited" : "created", next.title);
    return next;
  },
  transition: async (id: string, action: string, options?: unknown) => {
    if (!useSession.getState().demo)
      return request(`/content/${id}/${action}`, "POST", options || {});
    const p = demo.posts.find((p) => p.id === id);
    if (!p) throw new Error("Post not found");
    if (action === "review") p.status = "NEEDS_REVIEW";
    if (action === "approve") p.status = "APPROVED";
    if (action === "reject" || action === "cancel") p.status = "DRAFT";
    if (action === "schedule") {
      if (demo.workspace.requireApproval && p.status !== "APPROVED")
        throw new Error("Approve this post before scheduling.");
      Object.assign(p, options);
      p.status = "SCHEDULED";
    }
    p.version++;
    log(action, p.title);
  },
  brand: async (brand: Brand) => {
    if (!useSession.getState().demo)
      return request("/settings/brand", "PUT", brand);
    demo.brand = brand;
    log("updated", "Brand kit");
  },
  settings: async (value: Partial<Snapshot["workspace"]>) => {
    if (!useSession.getState().demo)
      return request("/settings", "PATCH", value);
    Object.assign(demo.workspace, value);
    log("updated", "Workspace settings");
  },
  reset: () => {
    demo = demoSnapshot();
  },
};
