import { refresh } from "./auth-client";
import { useSession } from "./session";
import { demoSnapshot, type Snapshot, type Post, type Brand } from "./model";
let demo = demoSnapshot();
export const apiEnabled = import.meta.env.VITE_API_ENABLED === "true";
export const apiBase = (import.meta.env.VITE_API_BASE || (typeof window !== "undefined" && window.location.hostname.includes("hidustansocialnetwork") ? "https://api.hidustansocialnetwork.in" : "")) as string;

export function resolveMediaUrl(rawUrl?: string | null): string {
  if (!rawUrl) return "";
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return rawUrl
      .replace("https://api.hidustansocialnetwork.in", "")
      .replace("http://localhost:3001", "")
      .replace("http://127.0.0.1:3001", "");
  }
  return rawUrl;
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  retry = true,
): Promise<T> {
  const wid = useSession.getState().workspaceId;
  const res = await fetch(`${apiBase}/api/v1${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(wid ? { "X-Workspace-Id": wid } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const isAuthRequest = path.startsWith("/auth/") || path.startsWith("/admin/");
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

export interface DocItem {
  id: string;
  media_asset_id?: string;
  original_filename: string;
  mime_type: string;
  status: "QUEUED" | "PROCESSING" | "EXTRACTING" | "CHUNKING" | "READY" | "FAILED";
  page_count?: number;
  failure_code?: string;
  failure_message?: string;
  created_at: string;
  processing_completed_at?: string;
}

export interface KnowledgeItem {
  id: string;
  generation_id?: string;
  knowledge_type: "claim" | "statistic" | "summary" | "topic" | "fact" | string;
  knowledge_key: string;
  value: any;
  page_start?: number;
  page_end?: number;
  source_excerpt?: string;
  confidence?: number;
  status: "EXTRACTED" | "CONFIRMED" | "EDITED" | "REJECTED" | "LOCKED";
  metadata?:{origin?:string;evidenceKind?:string;sourceMediaAssetId?:string;sourceReferenceId?:string;originalChecksum?:string};
  created_at: string;
}

export interface KnowledgeSource {
  id: string;
  generation_id: string;
  document_id: string;
  document_chunk_id?: string;
  page_start: number;
  page_end: number;
  source_excerpt: string;
  claim_key: string;
  confidence?: number;
  created_at: string;
}

export const documentsApi = {
  uploadPdf: async (file: File): Promise<{ documentId: string; status: string; filename: string }> => {
    if (useSession.getState().demo) {
      return {
        documentId: "demo-doc-" + Date.now(),
        status: "READY",
        filename: file.name,
      };
    }
    const presign = await request<{ assetId: string; uploadUrl: string; headers?: Record<string, string> }>(
      "/storage/uploads/presign",
      "POST",
      {
        type: "DOCUMENT",
        originalFilename: file.name,
        mimeType: file.type || "application/pdf",
        sizeBytes: file.size,
      },
    );

    const wid = useSession.getState().workspaceId;
    const targetUpload = presign.uploadUrl.startsWith("/")
      ? `${apiBase}${presign.uploadUrl}`
      : presign.uploadUrl;
    const uploadRes = await fetch(targetUpload, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": file.type || "application/pdf",
        ...(wid ? { "X-Workspace-Id": wid } : {}),
        ...(presign.headers || {}),
      },
      body: file,
    });

    if (!uploadRes.ok) {
      throw new Error("Failed to upload document file to storage.");
    }

    await request(`/storage/uploads/${presign.assetId}/complete`, "POST", {});
    const docRes = await request<{ documentId: string; status: string; filename: string }>(
      "/documents",
      "POST",
      { mediaAssetId: presign.assetId },
    );
    return docRes;
  },

  uploadBatchPdfs: async (
    files: File[],
    onProgress?: (completed: number, total: number, currentName: string) => void,
  ): Promise<{ documentId: string; status: string; filename: string }[]> => {
    const results: { documentId: string; status: string; filename: string }[] = [];
    let completedCount = 0;

    const queue = [...files];
    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;
        try {
          const res = await documentsApi.uploadPdf(file);
          results.push(res);
        } catch (err: any) {
          console.error(`Failed uploading ${file.name}:`, err);
        } finally {
          completedCount++;
          if (onProgress) {
            onProgress(completedCount, files.length, file.name);
          }
        }
      }
    };

    const concurrency = Math.min(files.length, 4);
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    return results;
  },

  fastTrack: async (
    id: string,
  ): Promise<{ documentId: string; status: string; pageCount?: number; chunkCount?: number }> => {
    if (useSession.getState().demo) {
      return { documentId: id, status: "READY", pageCount: 12 };
    }
    return request(`/documents/${id}/fast-track`, "POST");
  },

  list: async (): Promise<DocItem[]> => {
    if (useSession.getState().demo) {
      return [
        {
          id: "demo-pdf-1",
          original_filename: "Content_OS_Product_Strategy_2026.pdf",
          mime_type: "application/pdf",
          status: "READY",
          page_count: 14,
          created_at: new Date().toISOString(),
        },
      ];
    }
    const res = await request<{ documents: DocItem[] }>("/documents");
    return res.documents;
  },

  get: async (id: string): Promise<DocItem> => {
    if (useSession.getState().demo) {
      return {
        id,
        original_filename: "Uploaded_Document.pdf",
        mime_type: "application/pdf",
        status: "READY",
        page_count: 8,
        created_at: new Date().toISOString(),
      };
    }
    const res = await request<{ document: DocItem }>(`/documents/${id}`);
    return res.document;
  },

  extractKnowledge: async (id: string): Promise<{ generationId: string; documentId: string; status: string }> => {
    if (useSession.getState().demo) {
      return { generationId: "demo-gen-1", documentId: id, status: "QUEUED" };
    }
    return request(`/documents/${id}/knowledge/extract`, "POST");
  },

  listKnowledge: async (id: string): Promise<KnowledgeItem[]> => {
    if (useSession.getState().demo) {
      return [
        {
          id: "k1",
          knowledge_type: "summary",
          knowledge_key: "executive_summary",
          value: "ContentOS increases content distribution throughput by 3.5x using unified platform scheduling and brand voice enforcement.",
          page_start: 1,
          page_end: 2,
          source_excerpt: "Executive Summary: ContentOS accelerates multi-channel publisher velocity from 1.2 to 4.2 weekly campaigns per editor.",
          confidence: 0.98,
          status: "CONFIRMED",
          created_at: new Date().toISOString(),
        },
        {
          id: "k2",
          knowledge_type: "statistic",
          knowledge_key: "productivity_gain",
          value: "74% reduction in manual copy adaptation time across LinkedIn, X, and Instagram.",
          page_start: 4,
          page_end: 4,
          source_excerpt: "Key Metrics: Benchmarks across 120 marketing teams showed 74% savings in adaptation overhead.",
          confidence: 0.95,
          status: "CONFIRMED",
          created_at: new Date().toISOString(),
        },
        {
          id: "k3",
          knowledge_type: "claim",
          knowledge_key: "brand_safety_guardrails",
          value: "Real-time AI brand kit constraints prevent unapproved phrasing and unauthorized claims before post submission.",
          page_start: 7,
          page_end: 8,
          source_excerpt: "Security & Compliance: Automated brand governance enforces tone guidelines and prohibited terminology.",
          confidence: 0.92,
          status: "EXTRACTED",
          created_at: new Date().toISOString(),
        },
        {
          id: "k4",
          knowledge_type: "topic",
          knowledge_key: "pdf_to_content_pipeline",
          value: "PDF evidence extraction extracts claims and transforms structured PDF knowledge directly into platform-specific social posts.",
          page_start: 11,
          page_end: 12,
          source_excerpt: "Module Architecture: PDF-to-Content pipeline converts long-form whitepapers into bite-sized social posts backed by page citations.",
          confidence: 0.96,
          status: "CONFIRMED",
          created_at: new Date().toISOString(),
        },
      ];
    }
    const res = await request<{ knowledge: KnowledgeItem[] }>(`/documents/${id}/knowledge`);
    return res.knowledge;
  },

  getKnowledgeSources: async (documentId: string, knowledgeId: string): Promise<KnowledgeSource[]> => {
    if (useSession.getState().demo) {
      return [
        {
          id: "s1",
          generation_id: "demo-gen-1",
          document_id: documentId,
          page_start: 4,
          page_end: 4,
          source_excerpt: "Benchmarks across 120 marketing teams showed 74% savings in adaptation overhead.",
          claim_key: "productivity_gain",
          confidence: 0.95,
          created_at: new Date().toISOString(),
        },
      ];
    }
    const res = await request<{ sources: KnowledgeSource[] }>(`/documents/${documentId}/knowledge/${knowledgeId}/sources`);
    return res.sources;
  },

  reprocess: async (id: string): Promise<{ documentId: string; status: string }> => {
    if (useSession.getState().demo) {
      return { documentId: id, status: "QUEUED" };
    }
    return request(`/documents/${id}/reprocess`, "POST");
  },

  delete: async (id: string): Promise<{ success: boolean; documentId: string }> => {
    if (useSession.getState().demo) {
      return { success: true, documentId: id };
    }
    return request(`/documents/${id}`, "DELETE");
  },

  deleteKnowledge: async (documentId: string, knowledgeId: string): Promise<void> => {
    if (useSession.getState().demo) return;
    await request(`/documents/${documentId}/knowledge/${knowledgeId}`, "DELETE");
  },

  listPosterScripts: async (documentId: string): Promise<Array<{
    id: string;
    page: number;
    concept: string;
    excerpt: string;
    knowledgeType: string;
    sourceImageUrl: string | null;
    mediaAssetId: string | null;
    posterPrompt: string;
    headline: string;
    caption: string;
    hashtags: string[];
  }>> => {
    if (useSession.getState().demo) return [];
    const res = await request<{ scripts: any[] }>(`/documents/${documentId}/poster-scripts`);
    return res.scripts || [];
  },

  clearAllKnowledge: async (documentId: string): Promise<void> => {
    if (useSession.getState().demo) return;
    await request(`/documents/${documentId}/knowledge`, "DELETE");
  },
};

export const clipdropApi = {
  suggestPrompt: async (contentText: string, platform?: string, contextInfo?: string): Promise<{ prompt: string }> => {
    if (useSession.getState().demo) {
      return { prompt: `Cinematic conceptual visual artwork representing ${contentText.slice(0, 50)}, refined composition, subtle atmospheric lighting, clean editorial aesthetic.` };
    }
    return request("/clipdrop/suggest-prompt", "POST", { contentText, platform, contextInfo });
  },

  generateImage: async (input: {
    prompt: string;
    engine?: "clipdrop" | "flux";
    stylePreset?: string;
    aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9";
    headline?: string;
    logoText?: string;
    websiteUrl?: string;
    cta?: string;
    enableOverlay?: boolean;
    contentId?: string;
    platform?: string;
    idempotencyKey?: string;
  }): Promise<{
    assetId: string;
    url: string;
    filename: string;
    mimeType: string;
    engine?: string;
    remainingCredits: number | null;
    cached?: boolean;
    contentId?: string;
    status?: string;
  }> => {
    if (useSession.getState().demo) {
      return {
        assetId: "demo-clipdrop-" + Date.now(),
        url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1000&q=80",
        filename: "clipdrop_demo.png",
        mimeType: "image/png",
        engine: input.engine || "clipdrop",
        remainingCredits: 99,
        cached: false,
        contentId: input.contentId,
        status: input.contentId ? "NEEDS_REVIEW" : "COMPLETED",
      };
    }
    return request("/clipdrop/generate-image", "POST", input);
  },

  removeBackground: async (assetId: string): Promise<{
    assetId: string;
    url: string;
    filename: string;
    mimeType: string;
    remainingCredits: number | null;
  }> => {
    if (useSession.getState().demo) {
      return {
        assetId: "demo-nobg-" + Date.now(),
        url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1000&q=80",
        filename: "nobg_demo.png",
        mimeType: "image/png",
        remainingCredits: 98,
      };
    }
    return request("/clipdrop/remove-background", "POST", { assetId });
  },

  attachAndSave: async (input: {
    contentId?: string;
    title: string;
    body: string;
    platforms: string[];
    assetId: string;
    mediaUrl: string;
    status?: "DRAFT" | "NEEDS_REVIEW";
  }): Promise<{
    id: string;
    title: string;
    status: string;
    platforms: string[];
    mediaAssetId: string;
    mediaUrl: string;
  }> => {
    if (useSession.getState().demo) {
      return {
        id: input.contentId || "demo-content-" + Date.now(),
        title: input.title,
        status: input.status || "NEEDS_REVIEW",
        platforms: input.platforms,
        mediaAssetId: input.assetId,
        mediaUrl: input.mediaUrl,
      };
    }
    return request("/clipdrop/attach-and-save", "POST", input);
  },

  publishPost: async (contentId: string, socialAccountId: string): Promise<any> => {
    return request(`/content/${contentId}/publish`, "POST", { socialAccountId });
  },
};

