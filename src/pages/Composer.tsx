import React, { useState, useEffect } from "react";
import {
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sparkles,
  Save,
  Send,
  ArrowLeft,
  FileText,
  Image as ImageIcon,
  Clapperboard,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Upload,
  X as XIcon,
  CheckCircle2,
  AlertTriangle,
  Info,
  Youtube,
  Linkedin,
  Instagram,
  Twitter,
  Send as TelegramIcon,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button, PlatformIcon, StatusBadge } from "../components/ui";
import { platforms, type Platform, type Snapshot } from "../lib/model";
import { data, request } from "../lib/api";
import { useSession } from "../lib/session";
import { PublishPreviewModal } from "../components/PublishPreviewModal";
import {
  PLATFORM_CAPABILITIES,
  validatePlatformVariant,
  normalizeVariant,
  type PlatformVariantObject,
} from "../lib/platform-capabilities";
import { ContentDiscussionPanel } from "../components/ContentDiscussionPanel";

export default function Composer({ studio = false }: { studio?: boolean }) {
  const s = useOutletContext<Snapshot>();
  const [params] = useSearchParams();
  const post = s.posts.find((p) => p.id === params.get("id"));
  const nav = useNavigate();
  const query = useQueryClient();
  const demo = useSession((x) => x.demo);

  const [showDiscussion, setShowDiscussion] = useState(false);
  const [title, setTitle] = useState(post?.title || "");
  const [body, setBody] = useState(post?.body || "");
  const [selected, setSelected] = useState<Platform[]>(
    post?.platforms || ["LinkedIn", "Telegram"],
  );

  // Per-platform variant overrides
  const [variants, setVariants] = useState<Record<string, PlatformVariantObject>>(() => {
    if (post?.variants) {
      const init: Record<string, PlatformVariantObject> = {};
      Object.entries(post.variants).forEach(([p, val]) => {
        if (p !== "mediaType" && p !== "mediaUrl") {
          init[p] = normalizeVariant(val as any, post?.body || "", post?.title || "");
        }
      });
      return init;
    }
    return {};
  });

  // Active preview / focused tab
  const [preview, setPreview] = useState<Platform>(
    post?.platforms?.[0] || "LinkedIn",
  );

  const [postType, setPostType] = useState<"text" | "image" | "video">(
    ((post?.variants as any)?.mediaType as any) || "text",
  );
  const [mediaUrl, setMediaUrl] = useState<string>(
    ((post?.variants as any)?.mediaUrl as string) || "",
  );
  const [mediaAssetId, setMediaAssetId] = useState<string>("");
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // AI Creative controls
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState(s.brand.tone || "Professional");
  const [goal, setGoal] = useState("Engagement");
  const [aiOpen, setAiOpen] = useState(studio);

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Permissions & editable states
  const editable =
    !post || ["DRAFT", "NEEDS_REVIEW", "APPROVED"].includes(post.status);
  const canEdit = ["Owner", "Admin", "Content Manager", "Editor"].includes(
    s.workspace.role,
  );
  const canPublish = ["Owner", "Admin", "Content Manager"].includes(
    s.workspace.role,
  );

  // Update preview when selected platforms change
  useEffect(() => {
    if (selected.length > 0 && !selected.includes(preview)) {
      setPreview(selected[0]);
    }
  }, [selected, preview]);

  // Media upload handler with Smart Media Routing
  async function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingMedia(true);
      setError("");
      const isVideo = file.type.startsWith("video/");
      const presign = await request<{
        assetId: string;
        uploadUrl: string;
        headers?: Record<string, string>;
      }>("/storage/uploads/presign", "POST", {
        type: isVideo ? "VIDEO" : "IMAGE",
        originalFilename: file.name,
        mimeType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
        sizeBytes: file.size,
      });

      const res = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          ...(presign.headers || {}),
        },
        body: file,
      });

      if (!res.ok) throw new Error("File upload failed to storage service");

      await request(`/storage/uploads/${presign.assetId}/complete`, "POST", {});

      const download = await request<{ downloadUrl: string }>(
        `/storage/media/${presign.assetId}/download`,
      );

      const detectedType = isVideo ? "video" : "image";
      setMediaUrl(download.downloadUrl);
      setMediaAssetId(presign.assetId);
      setPostType(detectedType);

      // Smart Media Routing: auto-configure platform variant defaults based on media
      setVariants((prev) => {
        const next = { ...prev };
        selected.forEach((p) => {
          const cap = PLATFORM_CAPABILITIES[p];
          const cur = next[p] || { caption: body, title: title };
          cur.mediaType = detectedType;
          cur.mediaUrl = download.downloadUrl;
          cur.mediaAssetId = presign.assetId;

          // YouTube Smart Media routing
          if (p === "YouTube") {
            cur.metadata = {
              ...(cur.metadata || {}),
              youtubeKind: isVideo && file.name.toLowerCase().includes("short") ? "Short" : "Video",
              visibility: cur.metadata?.visibility || "public",
            };
          }
          next[p] = cur;
        });
        return next;
      });

      toast.success(
        `Uploaded ${isVideo ? "Video" : "Image"} — Smart Media routing applied across selected platforms!`,
      );
    } catch (err) {
      setError((err as Error).message);
      toast.error((err as Error).message);
    } finally {
      setUploadingMedia(false);
    }
  }

  // Update per-platform field
  function updateVariantField(p: Platform, field: keyof PlatformVariantObject, value: any) {
    setVariants((prev) => {
      const cur = { ...(prev[p] || { caption: body, title: title }) };
      (cur as any)[field] = value;
      return { ...prev, [p]: cur };
    });
  }

  // Save Draft or Submit Review
  async function save(review = false) {
    try {
      setError("");
      if (!title.trim() || !body.trim() || !selected.length) {
        throw new Error(
          "Add a title, write your content, and select at least one target account/platform.",
        );
      }
      setBusy("saving");

      const saved = await data.save({
        ...post,
        title: title.trim(),
        body: body.trim(),
        platforms: selected,
        variants: {
          ...variants,
          mediaType: postType,
          mediaUrl: mediaUrl || undefined,
        },
      });

      if (review) await data.transition(saved.id, "review");
      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success(review ? "Submitted for team review" : "Draft saved");
      nav("/app/library");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // AI Content Generator
  async function generate() {
    try {
      setError("");
      if (topic.trim().length < 4) {
        throw new Error("Add a few more details about your topic or idea.");
      }
      setBusy("generating");

      let result: {
        title: string;
        variants: Partial<Record<Platform, string>>;
      };

      if (demo) {
        result = {
          title: topic,
          variants: Object.fromEntries(
            selected.map((p) => [
              p,
              p === "X"
                ? `${topic.slice(0, 140)}. One key takeaways. What do you think?`
                : p === "Instagram"
                  ? `${topic}\n\nA fresh perspective for your team.\n\n${s.brand.hashtags || "#ContentOS #Social"}`
                  : p === "Telegram"
                    ? `📢 **Community Update**\n\n${topic}\n\nShare your thoughts below!`
                    : p === "YouTube"
                      ? `${topic}\n\nWatch this full breakdown and subscribe for more insights.`
                      : `Let’s talk about ${topic.toLowerCase()}.\n\nMeaningful progress starts with a clear question and practical execution.\n\n${s.brand.cta || "Learn more on our website."}`,
            ]),
          ),
        };
        toast.info("Demo captions loaded — AI service skipped in demo mode.");
      } else {
        result = await request("/ai/captions", "POST", {
          topic,
          tone,
          goal,
          platforms: selected,
        });
        toast.success("Platform-specific captions generated");
      }

      setTitle(result.title);
      setBody(result.variants[selected[0]] || topic);

      // Populate platform variants
      const newVariants: Record<string, PlatformVariantObject> = {};
      selected.forEach((p) => {
        newVariants[p] = {
          title: result.title,
          caption: result.variants[p] || result.variants[selected[0]] || topic,
          mediaType: postType,
          mediaUrl: mediaUrl || undefined,
          mediaAssetId: mediaAssetId || undefined,
        };
      });
      setVariants(newVariants);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // Multi-Account Publishing Handler
  async function publishMultiAccount() {
    try {
      setError("");
      if (!title.trim() || !body.trim() || !selected.length) {
        throw new Error(
          "Add a title, content body, and select at least one platform/account.",
        );
      }

      setBusy("publishing");

      // 1. Save draft first
      const saved = await data.save({
        ...post,
        title: title.trim(),
        body: body.trim(),
        platforms: selected,
        variants: {
          ...variants,
          mediaType: postType,
          mediaUrl: mediaUrl || undefined,
        },
      });

      // 2. Identify target connected accounts for each selected platform
      const publishResults: Array<{ platform: Platform; accountName: string; success: boolean; error?: string }> = [];

      for (const p of selected) {
        const acc = s.accounts.find(
          (a) =>
            String(a.platform).toLowerCase() === p.toLowerCase() &&
            a.state?.toLowerCase() === "connected",
        );

        if (!acc) {
          publishResults.push({
            platform: p,
            accountName: p,
            success: false,
            error: `No connected ${p} account found in workspace. Please connect ${p} first in Channels.`,
          });
          continue;
        }

        try {
          const res = await request<{ success: boolean; error?: string }>(
            `/content/${saved.id}/publish`,
            "POST",
            { socialAccountId: acc.id },
          );
          if (res.success !== false) {
            publishResults.push({ platform: p, accountName: acc.name, success: true });
          } else {
            publishResults.push({
              platform: p,
              accountName: acc.name,
              success: false,
              error: res.error || "Publishing failed",
            });
          }
        } catch (err) {
          publishResults.push({
            platform: p,
            accountName: acc.name,
            success: false,
            error: (err as Error).message,
          });
        }
      }

      await query.invalidateQueries({ queryKey: ["workspace"] });

      const successes = publishResults.filter((r) => r.success);
      const failures = publishResults.filter((r) => !r.success);

      if (successes.length > 0) {
        toast.success(
          `Successfully published to ${successes.length} account(s): ${successes.map((s) => s.platform).join(", ")}!`,
        );
      }
      if (failures.length > 0) {
        const failMsg = failures.map((f) => `${f.platform}: ${f.error}`).join(" | ");
        setError(`Failed for some accounts: ${failMsg}`);
        toast.error(`Publishing issues on ${failures.length} account(s). Check error details.`);
      }

      if (successes.length > 0 && failures.length === 0) {
        nav("/app/library");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // Derive current focused variant object
  const focusedVariant = normalizeVariant(variants[preview], body, title);
  const focusedCap = PLATFORM_CAPABILITIES[preview];
  const focusedValidation = validatePlatformVariant(preview, focusedVariant, { isPublishing: true });

  return (
    <>
      {/* Top Page Heading */}
      <div className="page-heading">
        <div>
          <button className="back-link" onClick={() => nav("/app/library")}>
            <ArrowLeft size={14} /> Content library
          </button>
          <h1>
            {studio
              ? "Multi-Account Creative Studio"
              : post
                ? "Refine & Multi-Publish Post"
                : "Create & Distribute Multi-Account Post"}
          </h1>
          <p>
            Compose once, adapt smartly across LinkedIn, Telegram, YouTube, X, and Instagram.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {post && (
            <Button
              variant="secondary"
              onClick={() => setShowDiscussion(true)}
              style={{ fontSize: "0.85rem", gap: "6px" }}
            >
              <MessageSquare size={15} /> Discussion
            </Button>
          )}
          <StatusBadge status={post?.status || "DRAFT"} />
        </div>
      </div>

      <div className="composer-grid">
        <section style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

          {/* SECTION 1: Connected Accounts Selector */}
          <div className="panel composer-panel">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "14px",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
                  1. Target Publishing Accounts
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                  Select one or more connected workspace accounts to publish to
                </p>
              </div>
              <span
                className="badge"
                style={{
                  background: "rgba(99, 102, 241, 0.15)",
                  color: "#818cf8",
                  border: "1px solid rgba(99, 102, 241, 0.3)",
                }}
              >
                {selected.length} Account(s) Selected
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "12px",
              }}
            >
              {platforms.map((p) => {
                const accounts = s.accounts.filter(
                  (a) => String(a.platform).toLowerCase() === p.toLowerCase(),
                );
                const connectedAcc = accounts.find((a) => a.state?.toLowerCase() === "connected") || accounts[0];
                const isSelected = selected.includes(p);
                const isConnected = !!connectedAcc;

                return (
                  <div
                    key={p}
                    onClick={() => {
                      if (!editable || !canEdit) return;
                      setSelected((old) =>
                        old.includes(p) ? old.filter((x) => x !== p) : [...old, p],
                      );
                      setPreview(p);
                    }}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: isSelected
                        ? "2px solid var(--color-accent, #6366f1)"
                        : "1px solid rgba(255, 255, 255, 0.1)",
                      background: isSelected
                        ? "rgba(99, 102, 241, 0.12)"
                        : "rgba(255, 255, 255, 0.02)",
                      cursor: editable && canEdit ? "pointer" : "not-allowed",
                      transition: "all 0.15s ease",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <PlatformIcon platform={p} />
                        <strong style={{ fontSize: "0.95rem" }}>{p}</strong>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        style={{ cursor: "pointer" }}
                      />
                    </div>

                    <div style={{ fontSize: "0.78rem" }}>
                      {isConnected ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#34d399" }}>
                          <CheckCircle2 size={12} />
                          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {connectedAcc.name || `${p} Account`}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>
                          Not connected · Connect in Channels
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SECTION 2: Base Content Idea & Common Media */}
          <div className="panel composer-panel">
            <h3 style={{ margin: "0 0 12px", fontSize: "1.05rem", fontWeight: 700 }}>
              2. Base Content & Media Idea
            </h3>

            {/* Post Format Selector */}
            <div className="composer-modes" style={{ marginBottom: "16px" }}>
              <button
                type="button"
                className={postType === "text" ? "selected" : ""}
                onClick={() => setPostType("text")}
              >
                <FileText size={16} /> Text Post
              </button>
              <button
                type="button"
                className={postType === "image" ? "selected" : ""}
                onClick={() => setPostType("image")}
              >
                <ImageIcon size={16} /> Image Post
              </button>
              <button
                type="button"
                className={postType === "video" ? "selected" : ""}
                onClick={() => setPostType("video")}
              >
                <Clapperboard size={16} /> Video Post
              </button>
            </div>

            {/* Media Attachment Upload Bar */}
            {postType !== "text" && (
              <div
                style={{
                  padding: "14px 16px",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px dashed rgba(255, 255, 255, 0.2)",
                  borderRadius: "10px",
                  marginBottom: "16px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {postType === "image" ? <ImageIcon size={18} style={{ color: "#6366f1" }} /> : <Clapperboard size={18} style={{ color: "#6366f1" }} />}
                    <strong>Attached {postType === "image" ? "Image" : "Video"}</strong>
                  </div>
                  {mediaUrl && (
                    <button
                      type="button"
                      className="text-button"
                      style={{ color: "#ef4444", fontSize: "0.8rem" }}
                      onClick={() => {
                        setMediaUrl("");
                        setMediaAssetId("");
                      }}
                    >
                      <XIcon size={14} /> Remove Media
                    </button>
                  )}
                </div>

                {mediaUrl ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    {postType === "image" ? (
                      <img src={mediaUrl} alt="Attached media" style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "8px" }} />
                    ) : (
                      <video src={mediaUrl} style={{ width: "110px", height: "80px", objectFit: "cover", borderRadius: "8px" }} />
                    )}
                    <div>
                      <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "#f1f5f9" }}>Media attached & routed across selected accounts</p>
                      <span className="badge" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>
                        Smart Routing Ready
                      </span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <label
                      className="button primary"
                      style={{
                        cursor: uploadingMedia ? "wait" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 14px",
                        fontSize: "0.85rem",
                      }}
                    >
                      <Upload size={14} />
                      {uploadingMedia ? "Uploading..." : `Upload ${postType === "image" ? "Image" : "Video"}`}
                      <input
                        type="file"
                        accept={postType === "image" ? "image/*" : "video/*"}
                        style={{ display: "none" }}
                        disabled={uploadingMedia}
                        onChange={handleMediaUpload}
                      />
                    </label>
                    <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>or enter URL:</span>
                    <input
                      type="url"
                      placeholder="https://example.com/media.mp4"
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      style={{ flex: 1, minWidth: "180px", padding: "6px 10px", fontSize: "0.85rem" }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* AI Control Panel */}
            {aiOpen && (
              <div className="ai-controls" style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Sparkles size={18} style={{ color: "#34d399" }} />
                    <h4 style={{ margin: 0, fontWeight: 700 }}>AI Creative Assistant</h4>
                  </div>
                </div>
                <label style={{ display: "block", marginBottom: "10px" }}>
                  What topic/idea do you want to share?
                  <textarea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Announcing our new AI workflow automation feature with 40% speedup..."
                    rows={3}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Tone
                    <select value={tone} onChange={(e) => setTone(e.target.value)}>
                      {["Professional", "Corporate", "Educational", "Technical", "Conversational", "Bold", "Promotional"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Goal
                    <select value={goal} onChange={(e) => setGoal(e.target.value)}>
                      {["Awareness", "Engagement", "Leads", "Website Traffic", "Product Promotion"].map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <Button
                  onClick={generate}
                  disabled={!!busy || !selected.length || !editable || !canEdit}
                  variant="primary"
                  style={{ marginTop: "12px", width: "100%", justifyContent: "center" }}
                >
                  <Sparkles size={16} />
                  {busy === "generating" ? "Generating tailored platform captions..." : "Generate Captions for All Selected Accounts"}
                </Button>
              </div>
            )}

            {/* Base Title & Base Content Inputs */}
            <div className="field-heading">
              <label htmlFor="post-title">Internal / Primary Post Title</label>
              <span>Used as default title for YouTube, Telegram, & Library</span>
            </div>
            <input
              id="post-title"
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. ContentOS Platform Launch Announcement"
              disabled={!editable || !canEdit}
              style={{ marginBottom: "14px" }}
            />

            <div className="field-heading">
              <label htmlFor="post-body">Primary Base Content</label>
              {!studio && (
                <button className="text-button" onClick={() => setAiOpen(!aiOpen)}>
                  <Sparkles size={14} /> AI Assistant
                </button>
              )}
            </div>
            <textarea
              id="post-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your core story or announcement here..."
              rows={6}
              maxLength={10000}
              disabled={!editable || !canEdit}
            />
          </div>

          {/* SECTION 3: Responsive Selected Accounts Cards (1, 2, 3-4+ Layouts) */}
          {selected.length > 0 && (
            <div className="panel composer-panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
                    3. Account-Specific Customization Cards
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                    Refine titles, captions, and platform-specific metadata independently
                  </p>
                </div>

                {/* Tab switcher for 3+ accounts */}
                {selected.length >= 3 && (
                  <div style={{ display: "flex", gap: "6px", overflowX: "auto" }}>
                    {selected.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPreview(p)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          border: preview === p ? "1px solid #6366f1" : "1px solid rgba(255,255,255,0.1)",
                          background: preview === p ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.02)",
                          color: preview === p ? "#fff" : "var(--color-text-muted)",
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <PlatformIcon platform={p} />
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* CARD LAYOUT ENGINE */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    selected.length === 1
                      ? "1fr"
                      : selected.length === 2
                        ? "repeat(2, 1fr)"
                        : "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: "16px",
                }}
              >
                {(selected.length >= 3 ? [preview] : selected).map((p) => {
                  const cap = PLATFORM_CAPABILITIES[p];
                  const varObj = normalizeVariant(variants[p], body, title);
                  const validation = validatePlatformVariant(p, varObj, { isPublishing: true });
                  const currentCaption = varObj.caption || body;
                  const currentTitle = varObj.title || title;

                  return (
                    <div
                      key={p}
                      style={{
                        padding: "16px",
                        borderRadius: "12px",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        background: "rgba(15, 23, 42, 0.6)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      {/* Card Header */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <PlatformIcon platform={p} />
                          <strong style={{ fontSize: "1rem" }}>{p} Publishing Card</strong>
                        </div>
                        {validation.valid ? (
                          <span className="badge" style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>
                            <CheckCircle2 size={12} /> Valid
                          </span>
                        ) : (
                          <span className="badge" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                            <AlertTriangle size={12} /> Issues
                          </span>
                        )}
                      </div>

                      {/* YouTube specific fields */}
                      {p === "YouTube" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "8px" }}>
                          <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                            YouTube Video Title (Required, max 100 chars)
                            <input
                              value={currentTitle}
                              maxLength={100}
                              onChange={(e) => updateVariantField("YouTube", "title", e.target.value)}
                              placeholder="YouTube Video Title..."
                              style={{ marginTop: "4px", width: "100%" }}
                            />
                          </label>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                            <label style={{ fontSize: "0.8rem" }}>
                              Upload Kind
                              <select
                                value={varObj.metadata?.youtubeKind || "Video"}
                                onChange={(e) =>
                                  updateVariantField("YouTube", "metadata", {
                                    ...(varObj.metadata || {}),
                                    youtubeKind: e.target.value,
                                  })
                                }
                              >
                                <option value="Video">Standard Video</option>
                                <option value="Short">YouTube Short</option>
                              </select>
                            </label>
                            <label style={{ fontSize: "0.8rem" }}>
                              Privacy Status
                              <select
                                value={varObj.metadata?.visibility || "public"}
                                onChange={(e) =>
                                  updateVariantField("YouTube", "metadata", {
                                    ...(varObj.metadata || {}),
                                    visibility: e.target.value,
                                  })
                                }
                              >
                                <option value="public">Public</option>
                                <option value="unlisted">Unlisted</option>
                                <option value="private">Private</option>
                              </select>
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Caption/Content Editor for this platform */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "0.8rem" }}>
                          <span style={{ color: "var(--color-text-muted)" }}>{p} Caption Override</span>
                          <span
                            style={{
                              color: currentCaption.length > (cap?.maxCaptionLength || 0) ? "#ef4444" : "#94a3b8",
                              fontWeight: 600,
                            }}
                          >
                            {currentCaption.length} / {cap?.maxCaptionLength || "∞"} chars
                          </span>
                        </div>
                        <textarea
                          rows={4}
                          value={currentCaption}
                          onChange={(e) => updateVariantField(p, "caption", e.target.value)}
                          placeholder={`Custom caption for ${p}...`}
                          disabled={!editable || !canEdit}
                          style={{ width: "100%", fontSize: "0.85rem" }}
                        />
                      </div>

                      {/* Validation Errors for this card */}
                      {!validation.valid && (
                        <div style={{ padding: "8px 12px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "6px", color: "#f87171", fontSize: "0.78rem" }}>
                          {validation.errors.map((err, idx) => (
                            <div key={idx}>• {err}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECTION 4: Composer Actions */}
          <div className="panel composer-panel">
            {error && (
              <div className="error-box" role="alert" style={{ marginBottom: "14px" }}>
                {error}
              </div>
            )}

            <div className="composer-actions">
              <Button
                variant="secondary"
                onClick={() => setShowPreviewModal(true)}
                disabled={!selected.length}
              >
                <Layers size={16} /> Publish Payload Preview
              </Button>
              <Button onClick={() => save()} disabled={!!busy || !editable || !canEdit}>
                <Save size={16} /> Save Draft
              </Button>
              <Button
                variant="primary"
                onClick={publishMultiAccount}
                disabled={!!busy || !editable || !canPublish || !selected.length}
              >
                <Send size={16} />
                {busy === "publishing"
                  ? `Publishing to ${selected.length} account(s)...`
                  : `Publish Now to ${selected.length} Account(s)`}
              </Button>
            </div>
          </div>
        </section>

        {/* SECTION 5: Right Column Live Post Preview */}
        <aside className="preview-column">
          <div className="preview-heading">
            <h2>Live Post Preview</h2>
            <span>Exact outgoing format</span>
          </div>

          <div className="preview-tabs">
            {selected.map((p) => (
              <button
                key={p}
                aria-label={`Preview ${p}`}
                className={preview === p ? "active" : ""}
                onClick={() => setPreview(p)}
              >
                <PlatformIcon platform={p} />
              </button>
            ))}
          </div>

          {/* Social Card Preview */}
          <div className="social-preview">
            <div className="social-profile">
              <span className="workspace-avatar">{s.brand.name[0] || "A"}</span>
              <div>
                <strong>{s.brand.name || s.workspace.name}</strong>
                <small>
                  {preview === "LinkedIn"
                    ? "Company · Just now"
                    : preview === "YouTube"
                      ? "YouTube Channel"
                      : `@${s.brand.name.toLowerCase().replaceAll(" ", "")}`}
                </small>
              </div>
              <MoreHorizontal size={18} />
            </div>

            {/* Title display if supported */}
            {focusedCap?.supportsTitle && (focusedVariant.title || title) && (
              <h4 style={{ margin: "8px 0 4px", fontSize: "0.95rem", fontWeight: 700, color: "#f1f5f9" }}>
                {focusedVariant.title || title}
              </h4>
            )}

            <p className={!(focusedVariant.caption || body) ? "placeholder-text" : ""}>
              {focusedVariant.caption || body || "Write your content to see live post preview..."}
            </p>

            {mediaUrl && (
              <div style={{ margin: "12px 0", borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
                {postType === "image" ? (
                  <img src={mediaUrl} alt="Attached preview" style={{ width: "100%", maxHeight: "280px", objectFit: "cover", display: "block" }} />
                ) : (
                  <video src={mediaUrl} controls style={{ width: "100%", maxHeight: "280px", display: "block", background: "#000" }} />
                )}
              </div>
            )}

            <div className="social-reactions">
              <span>Like</span>
              <span>Comment</span>
              <span>Share</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Payload Preview Modal */}
      <PublishPreviewModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        title={title}
        body={body}
        platforms={selected}
        variants={variants}
        onConfirmPublish={publishMultiAccount}
        isPublishing={busy === "publishing"}
      />

      {/* Discussion Panel */}
      <ContentDiscussionPanel
        open={showDiscussion}
        onClose={() => setShowDiscussion(false)}
        post={post || null}
        members={s.members}
      />
    </>
  );
}
