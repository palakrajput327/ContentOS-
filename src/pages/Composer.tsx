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
  Wand2,
} from "lucide-react";
import { Button, PlatformIcon, StatusBadge } from "../components/ui";
import { platforms, type Platform, type Snapshot } from "../lib/model";
import { data, request } from "../lib/api";
import { useSession } from "../lib/session";
import { PublishPreviewModal } from "../components/PublishPreviewModal";
import { ClipdropImageModal } from "../components/ClipdropImageModal";
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
  const mediaCandidates = Object.entries(post?.variants || {}).filter(([p,value])=>p.toLowerCase() !== 'youtube' && typeof value === 'object' && value !== null && ((value as PlatformVariantObject).mediaAssetId || (value as PlatformVariantObject).mediaUrl));
  const initialMedia = (mediaCandidates.find(([,value])=>(value as PlatformVariantObject).metadata?.inheritSharedMedia)?.[1] || mediaCandidates.find(([,value])=>(value as PlatformVariantObject).metadata?.inheritSharedMedia === undefined)?.[1]) as PlatformVariantObject | undefined;
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
          const variant = normalizeVariant(val as any, post?.body || "", post?.title || "");
          if (variant.metadata?.inheritSharedCaption || variant.caption === post?.body) delete variant.caption;
          if (variant.title === post?.title) delete variant.title;
          if (initialMedia && variant.metadata?.inheritSharedMedia !== false && (variant.mediaAssetId ? variant.mediaAssetId === initialMedia.mediaAssetId : variant.mediaUrl === initialMedia.mediaUrl)) {
            delete variant.mediaAssetId;delete variant.mediaUrl;delete variant.mediaType;
          }
          const platform = Object.keys(PLATFORM_CAPABILITIES).find(key=>key.toLowerCase()===p.toLowerCase());
          if (platform) init[platform] = variant;
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
    initialMedia?.mediaType as 'image' | 'video' || ((post?.variants as any)?.mediaType as any) || "text",
  );
  const [mediaUrl, setMediaUrl] = useState<string>(
    initialMedia?.mediaUrl || ((post?.variants as any)?.mediaUrl as string) || "",
  );
  const [mediaAssetId, setMediaAssetId] = useState<string>(initialMedia?.mediaAssetId || "");
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // AI Creative controls
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState(s.brand.tone || "Professional");
  const [goal, setGoal] = useState("Engagement");
  const [aiOpen, setAiOpen] = useState(studio);

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [publishResults, setPublishResults] = useState<Array<{platform: Platform; accountName: string; success: boolean; status?: string; error?: string; providerPostId?: string; url?: string}>>([]);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showClipdropModal, setShowClipdropModal] = useState(false);
  const [visualTarget, setVisualTarget] = useState<Platform | 'shared'>('shared');
  const [adaptedBrief, setAdaptedBrief] = useState('');

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

      const wid = useSession.getState().workspaceId;
      const res = await fetch(presign.uploadUrl, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          ...(wid ? { "X-Workspace-Id": wid } : {}),
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
          const cur = { ...(next[p] || {}) };

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
      const cur = { ...(prev[p] || {}) };
      (cur as any)[field] = value;
      if (field === 'caption') cur.metadata = {...cur.metadata,aiAdapted:false};
      if (field === 'caption' && !String(value).trim()) delete cur.caption;
      return { ...prev, [p]: cur };
    });
  }

  // Save Draft or Submit Review
  function composedVariant(p: Platform): PlatformVariantObject {
    const variant = normalizeVariant(variants[p], body, title);
    variant.metadata = {...variant.metadata,inheritSharedCaption:variants[p]?.caption===undefined,inheritSharedMedia:!variants[p]?.mediaAssetId && !variants[p]?.mediaUrl};
    if (!variant.mediaAssetId && !variant.mediaUrl && (mediaAssetId || mediaUrl)) {
      variant.mediaAssetId = mediaAssetId || undefined;
      variant.mediaUrl = mediaUrl || undefined;
      variant.mediaType = postType;
    }
    return variant;
  }

  async function save(review = false) {
    try {
      setError("");
      if (!title.trim() || !body.trim() || !selected.length) {
        throw new Error(
          "Add a title, write your content, and select at least one target account/platform.",
        );
      }
      setBusy("saving");

      const cleanVariants: Record<string, any> = {};
      selected.forEach((p) => {
        if (variants[p]) {
          cleanVariants[p] = composedVariant(p);
        } else {
          cleanVariants[p] = {
            title,
            caption: body,
            mediaType: postType,
            mediaUrl: mediaUrl || undefined,
            mediaAssetId: mediaAssetId || undefined,
          };
        }
      });

      const saved = await data.save({
        ...post,
        title: title.trim(),
        body: body.trim(),
        platforms: selected,
        variants: cleanVariants,
        youtube: post?.youtube || undefined,
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
  async function generate(adaptManual = false) {
    try {
      setError("");
      const source = adaptManual ? body.trim() : topic.trim();
      if (source.length < 5 || !selected.length) {
        throw new Error("Add a few more details about your topic or idea.");
      }
      setBusy("generating");

      let result: {
        title: string;
        variants: Partial<Record<Platform, string>>;
      };

      if (demo) {
        result = {
          title: title || source.slice(0,160),
          variants: Object.fromEntries(
            selected.map((p) => [
              p,
              p === "X"
                ? `${source.slice(0, 140)}. What do you think?`
                : p === "Instagram"
                  ? `${source}\n\nA fresh perspective for your team.\n\n${s.brand.hashtags || "#ContentOS #Social"}`
                  : p === "Telegram"
                    ? `📢 Community Update\n\n${source}\n\nShare your thoughts below!`
                    : p === "YouTube"
                      ? `${source}\n\nWatch this full breakdown and subscribe for more insights.`
                      : `Let’s talk about ${source.toLowerCase()}.\n\nMeaningful progress starts with a clear question and practical execution.\n\n${s.brand.cta || "Learn more on our website."}`,
            ]),
          ),
        };
        toast.info("Demo captions loaded — AI service skipped in demo mode.");
      } else {
        result = await request("/ai/captions", "POST", {
          topic: adaptManual ? `Adapt this existing post for the selected platforms. Preserve its meaning and facts; do not invent claims. Internal title: ${title}\nContent: ${source}` : source,
          tone,
          goal,
          platforms: selected,
        });
        toast.success("Platform-specific captions generated");
      }

      if (!adaptManual || !title.trim()) setTitle(result.title);
      if (!adaptManual) setBody(result.variants[selected[0]] || source);

      // Populate platform variants
      const newVariants: Record<string, PlatformVariantObject> = {};
      selected.forEach((p) => {
        if (!result.variants[p]?.trim()) throw new Error(`AI did not return a caption for ${p}. Please retry.`);
        if (adaptManual && variants[p]?.caption && !variants[p]?.metadata?.aiAdapted) {
          newVariants[p] = variants[p];
          return;
        }
        newVariants[p] = {
          ...variants[p],
          title: result.title,
          caption: result.variants[p],
          metadata: {...variants[p]?.metadata,aiAdapted:true},
        };
      });
      setVariants(newVariants);
      setAdaptedBrief(JSON.stringify([adaptManual ? body : result.variants[selected[0]] || source,selected,tone,goal]));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function reviewPost() {
    const brief = JSON.stringify([body,selected,tone,goal]);
    if (body.trim() && adaptedBrief !== brief && !(await generate(true))) return;
    setShowPreviewModal(true);
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

      const cleanVariants: Record<string, any> = {};
      selected.forEach((p) => {
        if (variants[p]) {
          cleanVariants[p] = composedVariant(p);
        } else {
          cleanVariants[p] = {
            title,
            caption: body,
            mediaType: postType,
            mediaUrl: mediaUrl || undefined,
            mediaAssetId: mediaAssetId || undefined,
          };
        }
      });

      // 1. Save draft first
      const saved = await data.save({
        ...post,
        title: title.trim(),
        body: body.trim(),
        platforms: selected,
        variants: cleanVariants,
        youtube: post?.youtube || undefined,
      });

      // 2. Identify target connected accounts for each selected platform
      const publishResults: Array<{ platform: Platform; accountName: string; success: boolean; status?: string; error?: string; providerPostId?: string; url?: string }> = [];
      setPublishResults([]);

      for (const p of selected) {
        if (p === 'YouTube' && cleanVariants[p]?.mediaType === 'image' && !saved.youtube) {
          publishResults.push({platform:p,accountName:p,success:false,status:'skipped',error:'YouTube does not support image-only posts. Attach a video or Short.'});
          continue;
        }
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
          const res = await request<{ success: boolean; status?: string; error?: string; providerPostId?: string; videoId?: string; url?: string }>(
            `/content/${saved.id}/publish`,
            "POST",
            { socialAccountId: acc.id },
          );
          if (res.success === true && (res.providerPostId || res.videoId)) {
            publishResults.push({ platform: p, accountName: acc.name, success: true, status:'success', providerPostId:res.providerPostId || res.videoId, url:res.url });
          } else {
            publishResults.push({
              platform: p,
              accountName: acc.name,
              success: false,
              status: res.status === 'skipped' ? 'skipped' : 'failure',
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
      setPublishResults(publishResults);

      const successes = publishResults.filter((r) => r.success);
      const failures = publishResults.filter((r) => !r.success && r.status !== 'skipped');

      if (successes.length > 0) {
        toast.success(
          `Successfully published to ${successes.length} account(s): ${successes.map((s) => s.platform).join(", ")}!`,
        );
      }
      if (failures.length > 0) {
        const failMsg = failures.map((f) => `${f.platform}: ${f.error}`).join(" | ");
        setError(`Failed for ${failures.length} account(s): ${failMsg}`);
        toast.error(`Publishing issues on ${failures.length} account(s). Check error details inside review modal.`);
      } else if (successes.length === selected.length) {
        setShowPreviewModal(false);
      }

    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // Derive current focused variant object
  const focusedVariant = composedVariant(preview);
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
                ? "Edit post"
                : "Create post"}
          </h1>
          <p>
            Add your content and media. AI adapts captions for your selected channels before you review and publish.
          </p>
          {!post && <button className="text-button" onClick={()=>nav('/app/studio')}><Sparkles size={14} /> Start with AI Studio · prompt or document → Needs Review</button>}
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
                  Choose channels here. Previewing or customizing a channel does not change this selection.
                </p>
              </div>
              <span
                className="badge"
                style={{
                  background: "rgba(99, 102, 241, 0.15)",
                  color: "var(--accent)",
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
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--success)" }}>
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
              2. Content & media
            </h3>

            {/* Post Format Selector */}
            <div className="composer-modes" style={{ marginBottom: "16px" }}>
              <button
                type="button"
                className={postType === "text" ? "selected" : ""}
                onClick={() => {setPostType("text");setMediaUrl('');setMediaAssetId('');}}
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
                  background: "var(--surface2)",
                  border: "1px dashed var(--border-strong)",
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
                      style={{ color: "var(--danger)", fontSize: "0.8rem" }}
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
                      <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "var(--ink)" }}>Media attached & routed across selected accounts</p>
                      <button type="button" className="text-button" onClick={()=>{setVisualTarget('shared');setShowClipdropModal(true);}}>Edit shared image in AI Visual Studio</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setPostType("image");
                        setVisualTarget('shared');setShowClipdropModal(true);
                      }}
                      style={{
                        background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))",
                        border: "1px solid rgba(168, 85, 247, 0.4)",
                        color: "var(--accent)",
                        padding: "8px 14px",
                        borderRadius: "8px",
                        fontWeight: 600,
                        fontSize: "0.85rem",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <Wand2 size={14} /> AI Visual Studio
                    </button>
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
                      onChange={(e) => {setMediaUrl(e.target.value);setMediaAssetId('');}}
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
                    <Sparkles size={18} style={{ color: "var(--success)" }} />
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
                  onClick={()=>generate()}
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
              <span>Names this post in your library. YouTube has its own video title below.</span>
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
              <label htmlFor="post-body">Post content</label>
              {!studio && (
                <button className="text-button" onClick={() => setAiOpen(!aiOpen)}>
                  <Sparkles size={14} /> AI Assistant
                </button>
              )}
            </div>
            <textarea
              id="post-body"
              value={body}
              onChange={(e) => {const value=e.target.value;setVariants(prev=>Object.fromEntries(Object.entries(prev).map(([p,v])=>{const next={...v};if(next.caption===body)delete next.caption;return[p,next];})));setBody(value);}}
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
                    3. Platform-specific posts
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                    AI adapts your content for each channel before review. You can edit any caption; your edits are preserved.
                  </p>
                </div>

              </div>

              {/* CARD LAYOUT ENGINE */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gap: "16px",
                }}
              >
                {selected.map((p) => {
                  const cap = PLATFORM_CAPABILITIES[p];
                  const varObj = composedVariant(p);
                  const validation = validatePlatformVariant(p, varObj, { isPublishing: true });
                  const currentCaption = varObj.caption || body;
                  const currentTitle = varObj.title || title;

                  return (
                    <details
                      key={p}
                      style={{
                        padding: "16px",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        background: "var(--surface2)",
                      }}
                    >
                      <summary style={{cursor:'pointer',fontWeight:600}}>{p} · {variants[p]?.metadata?.aiAdapted ? 'AI adapted' : variants[p]?.caption ? 'Custom caption' : 'Adapts before review'}{!validation.valid ? ' · Check media / format' : ''}</summary>
                      <div style={{display:'flex',flexDirection:'column',gap:12,marginTop:16}}>
                      {/* Card Header */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <PlatformIcon platform={p} />
                          <strong style={{ fontSize: "1rem" }}>{p} post</strong>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setPreview(p);
                              setVisualTarget(p);
                              setShowClipdropModal(true);
                            }}
                            style={{
                              background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))",
                              border: "1px solid rgba(168, 85, 247, 0.4)",
                              color: "var(--accent)",
                              padding: "4px 10px",
                              borderRadius: "6px",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                            }}
                          >
                            <Wand2 size={13} /> Custom image
                          </button>
                          {validation.valid ? (
                            <span className="badge" style={{ background: "rgba(16,185,129,0.15)", color: "var(--success)" }}>
                              <CheckCircle2 size={12} /> Valid
                            </span>
                          ) : (
                            <span className="badge" style={{ background: "rgba(239,68,68,0.15)", color: "var(--danger)" }}>
                              <AlertTriangle size={12} /> Issues
                            </span>
                          )}
                        </div>
                      </div>

                      {(p === 'Facebook' || p === 'Instagram') && varObj.mediaType === 'video' && (
                        <div>
                          {p === 'Facebook' ? <label>Facebook video format
                            <select aria-label="Facebook video format" value={varObj.metadata?.publishAs || 'feed'} onChange={e=>updateVariantField(p,'metadata',{...varObj.metadata,publishAs:e.target.value})}>
                              <option value="feed">Video post</option><option value="reel">Reel</option>
                            </select>
                          </label> : <label><input type="checkbox" checked={varObj.metadata?.shareToFeed !== false} onChange={e=>updateVariantField(p,'metadata',{...varObj.metadata,shareToFeed:e.target.checked})} /> Also show Instagram Reel in feed</label>}
                          <small>Meta downloads the video from public storage. Reels must meet Meta's video requirements.</small>
                        </div>
                      )}
                      {/* YouTube specific fields */}
                      {p === "YouTube" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "var(--border-strong)", padding: "12px", borderRadius: "8px" }}>
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
                              color: currentCaption.length > (cap?.maxCaptionLength || 0) ? "var(--danger)" : "var(--muted)",
                              fontWeight: 600,
                            }}
                          >
                            {currentCaption.length} / {cap?.maxCaptionLength || "∞"} chars
                          </span>
                        </div>
                        <p style={{fontSize:'0.8rem',color: 'var(--color-text-muted)',margin:0}}>{variants[p]?.metadata?.aiAdapted ? 'AI adapted for this channel' : variants[p]?.caption === undefined ? 'Adapted when you review' : 'Your caption'} · {variants[p]?.mediaAssetId || variants[p]?.mediaUrl ? 'Custom media' : 'Using attached media'}</p>
                        {Array.isArray(varObj.metadata?.sourceEvidence) && varObj.metadata.sourceEvidence.length > 0 && <details>
                          <summary>Why did AI write this?</summary>
                          <p>Source inputs supplied during generation. Verify claims before approval.</p>
                          {varObj.metadata.sourceEvidence.map((e:any,i:number)=><div key={i}><strong>{String(e.documentName || 'Source document')} · {e.pageStart ? `Page ${e.pageStart}${e.pageEnd && e.pageEnd!==e.pageStart ? `–${e.pageEnd}` : ''}` : 'Page unavailable'}</strong><blockquote>{String(e.excerpt || 'No excerpt available.')}</blockquote></div>)}
                        </details>}
                        <button type="button" className="text-button" disabled={!editable || !canEdit} onClick={()=>setVariants(prev=>{const next={...prev[p]};delete next.caption;delete next.title;delete next.mediaAssetId;delete next.mediaUrl;delete next.mediaType;return{...prev,[p]:next};})}>Use shared caption & media</button>
                        {varObj.mediaUrl && varObj.mediaType==='image' && <img src={varObj.mediaUrl} alt={`${p} attached image`} style={{width:96,height:96,objectFit:'cover',borderRadius:8}} />}
                        {!s.accounts.some(a=>String(a.platform).toLowerCase()===p.toLowerCase()&&a.state?.toLowerCase()==='connected') && <p role="status">{p} is not connected. <a href="/app/channels">Connect in Channels</a></p>}
                        <textarea
                          aria-label={`${p} caption`}
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
                        <div style={{ padding: "8px 12px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "6px", color: "var(--danger)", fontSize: "0.78rem" }}>
                          {validation.errors.map((err, idx) => (
                            <div key={idx}>• {err}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    </details>
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
            {publishResults.length > 0 && <ul aria-label="Publishing results">
              {publishResults.map((result,index)=><li key={index}>
                {result.platform}: {result.status || (result.success ? 'success' : 'failure')}
                {result.providerPostId && <> — Post ID: {result.providerPostId}</>}
                {result.url && <> — <a href={result.url} target="_blank" rel="noreferrer">View post</a></>}
                {result.error && <> — {result.error}</>}
              </li>)}
            </ul>}

            <div className="composer-actions">
              <Button onClick={()=>generate(true)} disabled={!!busy || !body.trim() || !selected.length || !editable || !canEdit}>
                <Sparkles size={16} /> {busy === 'generating' ? 'Adapting posts…' : 'Adapt for selected channels'}
              </Button>
              <Button onClick={() => save()} disabled={!!busy || !editable || !canEdit}>
                <Save size={16} /> Save Draft
              </Button>
              <Button
                variant="primary"
                onClick={reviewPost}
                disabled={!!busy || !editable || !canPublish || !selected.length}
              >
                <Send size={16} />
                {busy === "publishing"
                  ? `Publishing to ${selected.length} account(s)...`
                  : busy === 'generating' ? 'Adapting posts…' : `Review & publish to ${selected.length} channels`}
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
              <h4 style={{ margin: "8px 0 4px", fontSize: "0.95rem", fontWeight: 700, color: "var(--ink)" }}>
                {focusedVariant.title || title}
              </h4>
            )}

            <p className={!(focusedVariant.caption || body) ? "placeholder-text" : ""}>
              {focusedVariant.caption || body || "Write your content to see live post preview..."}
            </p>

            {focusedVariant.mediaUrl && (
              <div style={{ margin: "12px 0", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}>
                {focusedVariant.mediaType === "image" ? (
                  <img src={focusedVariant.mediaUrl} alt="Attached preview" style={{ width: "100%", maxHeight: "280px", objectFit: "cover", display: "block" }} />
                ) : (
                  <video src={focusedVariant.mediaUrl} controls style={{ width: "100%", maxHeight: "280px", display: "block", background: "var(--surface)" }} />
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
        variants={Object.fromEntries(selected.map(p=>[p,composedVariant(p)]))}
        onConfirmPublish={publishMultiAccount}
        isPublishing={busy === "publishing"}
        publishError={error}
      />

      {/* Discussion Panel */}
      <ContentDiscussionPanel
        open={showDiscussion}
        onClose={() => setShowDiscussion(false)}
        post={post || null}
        members={s.members}
      />

      <ClipdropImageModal
        isOpen={showClipdropModal}
        onClose={() => setShowClipdropModal(false)}
        initialContentText={body || topic}
        initialTitle={title}
        targetPlatform={visualTarget === 'shared' ? preview : visualTarget}
        composerMode
        attachmentLabel={visualTarget === 'shared' ? 'Shared image for selected channels' : `Custom image for ${visualTarget}`}
        initialAsset={visualTarget === 'shared'
          ? (mediaUrl && postType === 'image' ? {assetId:mediaAssetId,url:mediaUrl,filename:'post-image.png'} : undefined)
          : (composedVariant(visualTarget).mediaUrl && composedVariant(visualTarget).mediaType === 'image' ? {assetId:composedVariant(visualTarget).mediaAssetId || '',url:composedVariant(visualTarget).mediaUrl!,filename:'post-image.png'} : undefined)}
        contentId={post?.id}
        accounts={s?.accounts || []}
        brandName={s?.brand?.name}
        brandWebsite={s?.brand?.website}
        brandCta={s?.brand?.cta}
        onAttach={(result) => {
          if (visualTarget !== 'shared') {
            setVariants(prev=>({...prev,[visualTarget]:{...prev[visualTarget],mediaType:'image',mediaAssetId:result.assetId,mediaUrl:result.url}}));
            return;
          }
          setMediaUrl(result.url);
          setMediaAssetId(result.assetId);
          setPostType("image");
        }}
      />
    </>
  );
}
