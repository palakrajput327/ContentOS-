import { useState } from "react";
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
  Image,
  Clapperboard,
  Layers,
  MessageSquare,
  Heart,
  ThumbsUp,
  MoreHorizontal,
  Upload,
  Link as LinkIcon,
  X as XIcon,
} from "lucide-react";
import { Button, PlatformIcon, StatusBadge } from "../components/ui";
import { platforms, type Platform, type Snapshot } from "../lib/model";
import { data, request } from "../lib/api";
import { useSession } from "../lib/session";
import YouTubeComposer from "./YouTubeComposer";
export default function Composer({ studio = false }: { studio?: boolean }) {
  const s = useOutletContext<Snapshot>();
  const [params] = useSearchParams();
  const post = s.posts.find((p) => p.id === params.get("id"));
  const nav = useNavigate();
  const query = useQueryClient();
  const demo = useSession((x) => x.demo);
  const [title, setTitle] = useState(post?.title || "");
  const [body, setBody] = useState(post?.body || "");
  const [selected, setSelected] = useState<Platform[]>(
    post?.platforms || ["LinkedIn"],
  );
  const [variants, setVariants] = useState<Partial<Record<Platform, string>>>(
    post?.variants || {},
  );
  const [preview, setPreview] = useState<Platform>(
    post?.platforms[0] || "LinkedIn",
  );
  const [postType, setPostType] = useState<"text" | "image" | "video">(
    ((post?.variants as any)?.mediaType as any) || "text",
  );
  const [mediaUrl, setMediaUrl] = useState<string>(
    ((post?.variants as any)?.mediaUrl as string) || "",
  );
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState(s.brand.tone);
  const [goal, setGoal] = useState("Engagement");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [aiOpen, setAiOpen] = useState(studio);
  const editable =
    !post || ["DRAFT", "NEEDS_REVIEW", "APPROVED"].includes(post.status);
  const canEdit = ["Owner", "Admin", "Content Manager", "Editor"].includes(
    s.workspace.role,
  );
  const activeBody = variants[preview] ?? body;

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
      setMediaUrl(download.downloadUrl);
      setPostType(isVideo ? "video" : "image");
      toast.success(`${isVideo ? "Video" : "Image"} uploaded successfully`);
    } catch (err) {
      setError((err as Error).message);
      toast.error((err as Error).message);
    } finally {
      setUploadingMedia(false);
    }
  }
  async function save(review = false) {
    try {
      setError("");
      if (!title.trim() || !body.trim() || !selected.length)
        throw new Error(
          "Add a title, write your post, and choose at least one platform.",
        );
      setBusy("saving");
      const saved = await data.save({
        ...post,
        title,
        body,
        platforms: selected,
        variants: {
          ...variants,
          mediaType: postType,
          mediaUrl: mediaUrl || undefined,
        },
      });
      if (review) await data.transition(saved.id, "review");
      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success(review ? "Post submitted for review" : "Draft saved");
      nav("/app/library");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function generate() {
    try {
      setError("");
      if (topic.trim().length < 5)
        throw new Error("Add a little more detail about your topic.");
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
                ? `${topic.slice(0, 140)}. One useful idea. One clear next step. What would you add?`
                : p === "Instagram"
                  ? `${topic}\n\nA fresh perspective for your next creative session. Save this for later.\n\n${s.brand.hashtags}`
                  : p === "Telegram"
                    ? `Hello, community! Let’s talk about ${topic.toLowerCase()}.\n\nWhat has worked for you? Share your experience below.`
                    : `Let’s talk about ${topic.toLowerCase()}.\n\nMeaningful progress starts with a clear question and a practical next step. Give your team room to experiment, share what you learn, and build on the ideas that work.\n\n${s.brand.cta}`,
            ]),
          ),
        };
        toast.info("Example captions loaded — no AI service was called.");
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
      setVariants(result.variants);
      setBody(result.variants[selected[0]] || "");
      setPreview(selected[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (selected.includes("YouTube"))
    return (
      <YouTubeComposer
        key={post?.id || "new-youtube"}
        snapshot={s}
        post={post}
        onPlatform={(p) => {
          setSelected([p]);
          setPreview(p);
        }}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <button className="back-link" onClick={() => nav("/app/library")}>
            <ArrowLeft size={14} /> Content library
          </button>
          <h1>
            {studio
              ? "Give your idea a voice."
              : post
                ? "A little refinement goes a long way."
                : "What’s worth sharing today?"}
          </h1>
          <p>
            {studio
              ? "A starting point for each channel, shaped by your brand."
              : "Create with intention. Preview every platform before you share."}
          </p>
        </div>
        <StatusBadge status={post?.status || "DRAFT"} />
      </div>
      <div className="composer-grid">
        <section>
          <div className="panel composer-panel">
            <div className="composer-modes">
              <button
                type="button"
                className={postType === "text" ? "selected" : ""}
                onClick={() => setPostType("text")}
              >
                <FileText size={16} />
                Text post
              </button>
              <button
                type="button"
                className={postType === "image" ? "selected" : ""}
                onClick={() => setPostType("image")}
              >
                <Image size={16} />
                Image post
              </button>
              <button
                type="button"
                className={postType === "video" ? "selected" : ""}
                onClick={() => setPostType("video")}
              >
                <Clapperboard size={16} />
                Video post
              </button>
            </div>
            <div className="composer-fields">
              {postType !== "text" && (
                <div
                  style={{
                    padding: "14px 16px",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px dashed rgba(255, 255, 255, 0.2)",
                    borderRadius: "8px",
                    marginBottom: "16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "10px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {postType === "image" ? (
                        <Image
                          size={18}
                          style={{ color: "var(--color-accent, #6366f1)" }}
                        />
                      ) : (
                        <Clapperboard
                          size={18}
                          style={{ color: "var(--color-accent, #6366f1)" }}
                        />
                      )}
                      <strong>
                        {postType === "image"
                          ? "Attached Image"
                          : "Attached Video"}
                      </strong>
                    </div>
                    {mediaUrl && (
                      <button
                        type="button"
                        className="text-button"
                        style={{
                          color: "var(--color-danger, #ef4444)",
                          fontSize: "0.8rem",
                        }}
                        onClick={() => setMediaUrl("")}
                      >
                        <XIcon size={14} /> Remove
                      </button>
                    )}
                  </div>

                  {mediaUrl ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      {postType === "image" ? (
                        <img
                          src={mediaUrl}
                          alt="Attached media"
                          style={{
                            width: "72px",
                            height: "72px",
                            objectFit: "cover",
                            borderRadius: "6px",
                            border: "1px solid rgba(255,255,255,0.1)",
                          }}
                        />
                      ) : (
                        <video
                          src={mediaUrl}
                          style={{
                            width: "100px",
                            height: "72px",
                            objectFit: "cover",
                            borderRadius: "6px",
                          }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            margin: "0 0 4px",
                            fontSize: "0.85rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {mediaUrl}
                        </p>
                        <span
                          className="badge"
                          style={{
                            fontSize: "0.75rem",
                            background: "rgba(16, 185, 129, 0.15)",
                            color: "#10b981",
                          }}
                        >
                          Ready to Publish
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          gap: "10px",
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <label
                          className="button primary"
                          style={{
                            cursor: uploadingMedia ? "wait" : "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "6px 12px",
                            fontSize: "0.85rem",
                            borderRadius: "6px",
                            background: "var(--color-accent, #6366f1)",
                            color: "#fff",
                          }}
                        >
                          <Upload size={14} />
                          {uploadingMedia
                            ? "Uploading…"
                            : `Upload ${postType === "image" ? "Image" : "Video"}`}
                          <input
                            type="file"
                            accept={
                              postType === "image" ? "image/*" : "video/*"
                            }
                            style={{ display: "none" }}
                            disabled={uploadingMedia}
                            onChange={handleMediaUpload}
                          />
                        </label>
                        <span
                          style={{
                            fontSize: "0.85rem",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          or enter URL
                        </span>
                        <input
                          type="url"
                          placeholder="https://example.com/media.jpg"
                          value={mediaUrl}
                          onChange={(e) => setMediaUrl(e.target.value)}
                          style={{
                            flex: 1,
                            minWidth: "180px",
                            padding: "6px 10px",
                            fontSize: "0.85rem",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <label>Where will this story go?</label>
              <div className="platform-select">
                {platforms.map((p) => (
                  <button
                    disabled={!editable || !canEdit}
                    key={p}
                    aria-pressed={selected.includes(p)}
                    className={selected.includes(p) ? "selected" : ""}
                    onClick={() => {
                      setSelected((old) =>
                        old.includes(p)
                          ? old.filter((x) => x !== p)
                          : [...old, p],
                      );
                      setPreview(p);
                    }}
                  >
                    <PlatformIcon platform={p} />
                    {p}
                  </button>
                ))}
              </div>

              {aiOpen && (
                <div className="ai-controls">
                  <div
                    className="row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <Sparkles size={18} className="text-emerald-400" />
                      <h3 style={{ margin: 0, fontWeight: 600 }}>
                        AI Creative Brief
                      </h3>
                    </div>
                    <span
                      className="badge"
                      style={{
                        background: "rgba(16, 185, 129, 0.15)",
                        color: "#10b981",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                      }}
                    >
                      Live AI Active
                    </span>
                  </div>
                  <label style={{ marginTop: "12px", display: "block" }}>
                    What would you like to share?
                    <textarea
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g. Launched our new AI scheduling feature, improved workflow speed by 40%..."
                      rows={3}
                      maxLength={2000}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Tone
                      <select
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                      >
                        {[
                          "Professional",
                          "Corporate",
                          "Educational",
                          "Technical",
                          "Conversational",
                          "Bold",
                          "Promotional",
                        ].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Goal
                      <select
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                      >
                        {[
                          "Awareness",
                          "Engagement",
                          "Leads",
                          "Website Traffic",
                          "Product Promotion",
                        ].map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Button
                    onClick={generate}
                    disabled={
                      !!busy || !selected.length || !editable || !canEdit
                    }
                    variant="primary"
                    style={{ marginTop: "12px", width: "100%" }}
                  >
                    <Sparkles size={16} />
                    {busy === "generating"
                      ? "Generating tailored captions with AI…"
                      : demo
                        ? "Load example captions"
                        : "Generate platform captions with AI"}
                  </Button>
                </div>
              )}

              <div className="field-heading">
                <label htmlFor="post-title">Internal title</label>
                <span>Only your team sees this</span>
              </div>
              <input
                id="post-title"
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give this idea a name"
                disabled={!editable || !canEdit}
              />
              <div className="field-heading">
                <label htmlFor="post-body">Your content</label>
                {!studio && (
                  <button
                    className="text-button"
                    onClick={() => setAiOpen(!aiOpen)}
                  >
                    <Sparkles size={14} /> Write with AI
                  </button>
                )}
              </div>
              <textarea
                id="post-body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setVariants({});
                }}
                placeholder="Start with a thought worth sharing…"
                rows={9}
                maxLength={10000}
                disabled={!editable || !canEdit}
              />
              <div className="editor-foot">
                <span>Editing this base text clears generated variants.</span>
                <span>{body.length} characters</span>
              </div>

              {Object.keys(variants).length > 0 && (
                <div className="variant-editor">
                  <div className="field-heading">
                    <label>Refine {preview} variant</label>
                    <span>{activeBody.length} characters</span>
                  </div>
                  <textarea
                    rows={6}
                    value={activeBody}
                    onChange={(e) =>
                      setVariants((v) => ({ ...v, [preview]: e.target.value }))
                    }
                    disabled={!editable || !canEdit}
                  />
                </div>
              )}
              {error && (
                <div className="error-box" role="alert">
                  {error}
                </div>
              )}
              {!editable && (
                <div className="notice">
                  This post is {post?.status.toLowerCase()}. Cancel its schedule
                  in the library before editing.
                </div>
              )}
              <div className="composer-actions">
                <Button
                  onClick={() => save()}
                  disabled={!!busy || !editable || !canEdit}
                >
                  <Save size={16} />
                  Save draft
                </Button>
                <Button
                  variant="primary"
                  onClick={async () => {
                    try {
                      setError("");
                      if (!title.trim() || !body.trim() || !selected.length)
                        throw new Error(
                          "Add a title, write your post, and choose at least one platform.",
                        );
                      setBusy("publishing");
                      // 1. Save post draft first
                      const saved = await data.save({
                        ...post,
                        title,
                        body,
                        platforms: selected,
                        variants,
                      });

                      // 2. Find connected social account for target platform
                      const targetPlatform =
                        preview || selected[0] || "Telegram";
                      const acc = s.accounts.find(
                        (a) =>
                          String(a.platform).toLowerCase() ===
                          targetPlatform.toLowerCase(),
                      );
                      if (!acc) {
                        throw new Error(
                          `No connected ${targetPlatform} channel/account found for this workspace. Please connect ${targetPlatform} first under Connected Channels.`,
                        );
                      }

                      // 3. Trigger publish endpoint
                      await request(`/content/${saved.id}/publish`, "POST", {
                        socialAccountId: acc.id,
                      });

                      await query.invalidateQueries({
                        queryKey: ["workspace"],
                      });
                      toast.success(
                        `Post published to ${targetPlatform} successfully!`,
                      );
                      nav("/app/library");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy("");
                    }
                  }}
                  disabled={!!busy || !editable || !canEdit}
                >
                  <Send size={16} />
                  {busy === "publishing"
                    ? `Publishing to ${preview || selected[0]}…`
                    : `Publish Now to ${preview || selected[0]}`}
                </Button>
              </div>
            </div>
          </div>
        </section>
        <aside className="preview-column">
          <div className="preview-heading">
            <h2>Post preview</h2>
            <span>Approximate appearance</span>
          </div>
          <div className="preview-tabs">
            {selected.map((p) => (
              <button
                aria-label={`Preview ${p}`}
                aria-pressed={preview === p}
                className={preview === p ? "active" : ""}
                key={p}
                onClick={() => setPreview(p)}
              >
                <PlatformIcon platform={p} />
              </button>
            ))}
          </div>
          <div className="social-preview">
            <div className="social-profile">
              <span className="workspace-avatar">{s.brand.name[0] || "A"}</span>
              <div>
                <strong>{s.brand.name || s.workspace.name}</strong>
                <small>
                  {preview === "LinkedIn"
                    ? "Company · Just now"
                    : `@${s.brand.name.toLowerCase().replaceAll(" ", "")}`}
                </small>
              </div>
              <MoreHorizontal size={18} />
            </div>
            <p className={!activeBody ? "placeholder-text" : ""}>
              {activeBody ||
                "Your next great post starts with a single idea. Start writing to see it take shape here."}
            </p>
            {mediaUrl && (
              <div
                style={{
                  margin: "12px 0",
                  borderRadius: "8px",
                  overflow: "hidden",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                }}
              >
                {postType === "image" ? (
                  <img
                    src={mediaUrl}
                    alt="Attached preview"
                    style={{
                      width: "100%",
                      maxHeight: "300px",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <video
                    src={mediaUrl}
                    controls
                    style={{
                      width: "100%",
                      maxHeight: "300px",
                      display: "block",
                      background: "#000",
                    }}
                  />
                )}
              </div>
            )}
            <div className="social-reactions">
              <span>
                <ThumbsUp size={15} /> Like
              </span>
              <span>
                <MessageSquare size={15} /> Comment
              </span>
              <span>
                <Send size={15} /> Share
              </span>
            </div>
          </div>
          <div className="preview-tip">
            <Heart size={17} />
            <p>
              Your voice matters. Read every generated caption before submitting
              it for approval.
            </p>
          </div>
          <div className="brand-reminder">
            <span className="overline">YOUR BRAND, BUILT IN</span>
            <h3>{s.brand.tone} & consistent</h3>
            <p>
              {s.brand.description ||
                "Configure your Brand Kit in settings to guide AI generation."}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
