import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, StatusBadge } from "../components/ui";
import { data, request } from "../lib/api";
import { useSession } from "../lib/session";
import {
  platforms,
  type Platform,
  type Post,
  type Snapshot,
} from "../lib/model";

type Props = {
  snapshot: Snapshot;
  post?: Post;
  onPlatform: (platform: Platform) => void;
};
export default function YouTubeComposer({
  snapshot: s,
  post,
  onPlatform,
}: Props) {
  const initial = post?.youtube;
  const [kind, setKind] = useState<"Short" | "Video">(initial?.kind || "Video");
  const [assetId, setAssetId] = useState(initial?.assetId || "");
  const [thumbnailAssetId, setThumbnail] = useState(
    initial?.thumbnailAssetId || "",
  );
  const [title, setTitle] = useState(initial?.title || post?.title || "");
  const [description, setDescription] = useState(
    initial?.description || post?.body || "",
  );
  const [visibility, setVisibility] = useState<
    "private" | "unlisted" | "public"
  >(initial?.visibility || "private");
  const [date, setDate] = useState("");
  const [fileName, setFileName] = useState(
    initial?.assetId ? "Saved video asset" : "",
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [publications, setPublications] = useState<any[]>([]);
  const query = useQueryClient(),
    nav = useNavigate();
  const canEdit = ["Owner", "Admin", "Content Manager", "Editor"].includes(
    s.workspace.role,
  );
  const canPublish = ["Owner", "Admin", "Content Manager"].includes(
    s.workspace.role,
  );
  const editable =
    !post || ["DRAFT", "NEEDS_REVIEW", "APPROVED"].includes(post.status);
  useEffect(() => {
    if (!post?.id || useSession.getState().demo) return;
    let alive = true;
    const load = () =>
      request<{ publications: any[] }>(`/content/${post.id}/youtube`)
        .then((v) => {
          if (alive) setPublications(v.publications);
        })
        .catch(() => {});
    load();
    const interval = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [post?.id]);
  async function upload(file: File, thumbnail = false) {
    setError("");
    setBusy("uploading");
    try {
      if (useSession.getState().demo)
        throw new Error("Sign in to upload videos.");
      if (
        thumbnail &&
        (!["image/jpeg", "image/png"].includes(file.type) ||
          file.size > 2 * 1024 * 1024)
      )
        throw new Error("Use a JPEG or PNG thumbnail under 2 MB.");
      if (!thumbnail) {
        if (!file.type.startsWith("video/"))
          throw new Error("Choose a video file.");
        if (file.size > 500 * 1024 * 1024)
          throw new Error("Videos must be under 500 MB.");
        const metadata = await new Promise<{
          width: number;
          height: number;
          duration: number;
        }>((resolve, reject) => {
          const video = document.createElement("video"),
            url = URL.createObjectURL(file);
          const timer = setTimeout(() => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not read video metadata."));
          }, 15000);
          video.preload = "metadata";
          video.onloadedmetadata = () => {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            resolve({
              width: video.videoWidth,
              height: video.videoHeight,
              duration: video.duration,
            });
          };
          video.onerror = () => {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            reject(new Error("Could not read this video."));
          };
          video.src = url;
        });
        if (
          kind === "Short" &&
          (metadata.height < metadata.width ||
            !Number.isFinite(metadata.duration) ||
            metadata.duration > 180)
        )
          throw new Error(
            "Shorts must be square or vertical and no longer than 3 minutes.",
          );
      }
      const presign = await request<{
        assetId: string;
        uploadUrl: string;
        headers?: Record<string, string>;
      }>("/storage/uploads/presign", "POST", {
        type: thumbnail ? "THUMBNAIL" : "VIDEO",
        originalFilename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      const apiBase = import.meta.env.VITE_API_BASE ?? "";
      const targetUpload = presign.uploadUrl.startsWith("/")
        ? `${apiBase}${presign.uploadUrl}`
        : presign.uploadUrl;
      const response = await fetch(targetUpload, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": file.type, ...presign.headers },
        body: file,
      });
      if (!response.ok) throw new Error("Media upload failed.");
      await request(`/storage/uploads/${presign.assetId}/complete`, "POST", {});
      if (thumbnail) setThumbnail(presign.assetId);
      else {
        setAssetId(presign.assetId);
        setFileName(file.name);
      }
      toast.success("File uploaded");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function save() {
    if (!assetId || !title.trim())
      throw new Error("Upload a video and enter its title.");
    const youtube = {
      kind,
      assetId,
      title: title.trim(),
      description,
      visibility,
      ...(kind === "Video" && thumbnailAssetId ? { thumbnailAssetId } : {}),
    };
    if (
      post?.status === "APPROVED" &&
      initial &&
      Object.entries(youtube).every(
        ([key, value]) => value === (initial as any)[key],
      ) &&
      (!initial.thumbnailAssetId ||
        initial.thumbnailAssetId === youtube.thumbnailAssetId)
    )
      return post;
    return data.save({
      ...post,
      title: title.trim(),
      body: description,
      platforms: ["YouTube"],
      variants: {},
      youtube,
    });
  }
  async function act(action: "draft" | "publish" | "schedule" | "review") {
    setError("");
    setBusy(action);
    try {
      if (useSession.getState().demo)
        throw new Error("Sign in to publish or schedule YouTube videos.");
      const saved = await save();
      if (action === "review") await data.transition(saved.id, "review");
      if (action === "schedule") {
        const at = new Date(date);
        if (!Number.isFinite(at.getTime()) || at.getTime() < Date.now() + 30000)
          throw new Error("Choose a time at least 30 seconds in the future.");
        await data.transition(saved.id, "schedule", {
          scheduledAt: at.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      }
      if (action === "publish") {
        const account = s.accounts.find(
          (a) =>
            String(a.platform).toLowerCase() === "youtube" &&
            a.state.toLowerCase() === "connected",
        );
        if (!account)
          throw new Error("Connect a healthy YouTube account first.");
        const result = await request<{ success: boolean; error?: string }>(
          `/content/${saved.id}/publish`,
          "POST",
          { socialAccountId: account.id },
        );
        if (!result.success)
          throw new Error(
            result.error ||
              "Upload failed. Check publishing status before retrying.",
          );
      }
      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success(
        action === "publish"
          ? "Video uploaded. YouTube is processing it."
          : action === "schedule"
            ? "Video scheduled"
            : action === "review"
              ? "Submitted for review"
              : "Draft saved",
      );
      nav("/app/library");
    } catch (e) {
      setError((e as Error).message);
      await query.invalidateQueries({ queryKey: ["workspace"] });
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Create a YouTube upload</h1>
          <p>Shorts and videos for your connected channel.</p>
        </div>
        <StatusBadge status={post?.status || "DRAFT"} />
      </div>
      <section className="panel composer-panel">
        <div className="composer-fields">
          <label>
            Platform
            <select
              aria-label="Platform"
              value="YouTube"
              disabled={!!post}
              onChange={(e) => onPlatform(e.target.value as Platform)}
            >
              {platforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <fieldset disabled={!!busy || !editable || !canEdit}>
            <label>
              Upload type
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as "Short" | "Video");
                  setThumbnail("");
                }}
              >
                <option>Short</option>
                <option>Video</option>
              </select>
            </label>
            {kind === "Short" && (
              <p>
                Square or vertical video, up to 3 minutes. Files are also
                validated on the server.
              </p>
            )}
            <label>
              Video file
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={(e) => {
                  if (e.target.files?.[0]) upload(e.target.files[0]);
                }}
              />
            </label>
            {fileName && <p>{fileName} · Uploaded</p>}
            <label>
              Title
              <input
                value={title}
                maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                maxLength={5000}
                rows={6}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              Visibility
              <select
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as typeof visibility)
                }
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
            </label>
            <p>
              Uploads from an unaudited YouTube API project may be restricted to
              private.
            </p>
            {kind === "Video" && (
              <label>
                Thumbnail (optional, JPEG/PNG, max 2 MB)
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => {
                    if (e.target.files?.[0]) upload(e.target.files[0], true);
                  }}
                />
                {thumbnailAssetId && (
                  <span>
                    Thumbnail uploaded{" "}
                    <button type="button" onClick={() => setThumbnail("")}>
                      Remove
                    </button>
                  </span>
                )}
              </label>
            )}
            <label>
              Schedule time (your local time)
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {busy && (
            <p role="status">
              {busy === "uploading"
                ? "Uploading file…"
                : busy === "publish"
                  ? "Uploading to YouTube…"
                  : "Saving…"}
            </p>
          )}
          {s.workspace.requireApproval && (
            <p>
              Approval is required before publishing or scheduling. Editing an
              approved video returns it to draft.
            </p>
          )}
          <div className="composer-actions">
            <Button
              disabled={!!busy || !editable || !canEdit}
              onClick={() => act("draft")}
            >
              Save draft
            </Button>
            {s.workspace.requireApproval && (
              <Button
                disabled={!!busy || !editable || !canEdit}
                onClick={() => act("review")}
              >
                Submit for review
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!!busy || !editable || !canPublish}
              onClick={() => act("publish")}
            >
              Publish Now
            </Button>
            <Button
              disabled={!!busy || !editable || !canPublish || !date}
              onClick={() => act("schedule")}
            >
              Schedule
            </Button>
          </div>
          {publications.length > 0 && canPublish && (
            <Button
              disabled={!!busy}
              onClick={async () => {
                setBusy("checking");
                try {
                  const result = await request<{ publications: any[] }>(
                    `/content/${post!.id}/youtube/check`,
                    "POST",
                    {},
                  );
                  setPublications(result.publications);
                  await query.invalidateQueries({ queryKey: ["workspace"] });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy("");
                }
              }}
            >
              Check YouTube status
            </Button>
          )}
          {publications.map((p) => (
            <div key={p.id}>
              <p>
                Upload: {p.state} · Processing:{" "}
                {p.processingStatus || "Not started"} · Visibility:{" "}
                {p.visibility || visibility}
              </p>
              {p.videoId && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`https://www.youtube.com/watch?v=${encodeURIComponent(p.videoId)}`}
                >
                  View video · {p.videoId}
                </a>
              )}
              {p.error && <p className="error">{p.error}</p>}
              {p.warning && <p>{p.warning}</p>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
