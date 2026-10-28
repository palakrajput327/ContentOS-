import { metaRequest, metaVersion } from "./meta.api.js";
export interface MetaPost {
  destination: string;
  text: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  mediaType?: string;
  metadata?: Record<string, any>;
}
export class MetaPublishError extends Error {
  constructor(
    message: string,
    public uncertain = false,
  ) {
    super(message);
  }
}
export function isLocalOrPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return (
      !["http:", "https:"].includes(url.protocol) ||
      url.username !== "" ||
      url.password !== "" ||
      /^(localhost|127\.|0\.|10\.|192\.168\.|\[?::1\]?)/i.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) ||
      url.hostname.includes("hidustansocialnetwork.in")
    );
  } catch {
    return true;
  }
}

export function publicMetaUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MetaPublishError(
      "Meta needs a public image/video URL. Upload media to publicly reachable storage.",
    );
  }
  if (isLocalOrPrivateUrl(value))
    throw new MetaPublishError(
      "Meta cannot download media from localhost/private storage. Use a public HTTPS server or cloud storage.",
    );
  return url.toString();
}

export async function uploadBufferToPublicHost(
  buffer: Buffer,
  mimeType: string,
  filename = "media.jpg",
): Promise<string> {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append(
    "fileToUpload",
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filename,
  );
  const res = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Public media host upload failed (status ${res.status})`);
  }
  const text = (await res.text()).trim();
  if (!text.startsWith("http")) {
    throw new Error(`Public media host returned invalid URL: ${text}`);
  }
  return text;
}

export async function ensurePublicMetaUrl(
  urlOrPath: string,
  preferredType: "image" | "video" = "image",
): Promise<string> {
  if (!urlOrPath) return "";
  if (!isLocalOrPrivateUrl(urlOrPath)) {
    return urlOrPath;
  }
  try {
    const res = await fetch(urlOrPath, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const contentType = res.headers.get("content-type") || (preferredType === "video" ? "video/mp4" : "image/jpeg");
    return await uploadBufferToPublicHost(
      buf,
      contentType,
      preferredType === "video" ? "video.mp4" : "photo.jpg",
    );
  } catch (err: any) {
    throw new MetaPublishError(
      `Could not prepare media for Meta download: ${err.message}. Ensure media is accessible.`,
    );
  }
}
export async function waitMetaReady(
  id: string,
  token: string,
  kind: "instagram" | "facebook",
  published = false,
  attempts = 120,
  interval = 5000,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const data = await metaRequest(id, token, {
      fields: kind === "instagram" ? "status_code" : "status",
    });
    if (kind === "instagram") {
      if (data.status_code === "FINISHED" || data.status_code === "PUBLISHED")
        return;
      if (["ERROR", "EXPIRED"].includes(data.status_code))
        throw new MetaPublishError(
          "Instagram media processing failed. Check image/video format, size and public accessibility.",
        );
    } else {
      const status = data.status || {};
      if (
        status.video_status === "ready" ||
        (published
          ? status.publishing_phase?.status === "complete"
          : status.uploading_phase?.status === "complete")
      )
        return;
      if (
        status.video_status === "error" ||
        ["uploading_phase", "processing_phase", "publishing_phase"].some(
          (p) => status[p]?.status === "error",
        )
      )
        throw new MetaPublishError(
          "Facebook video processing failed. Check video format and public accessibility.",
          published,
        );
    }
    if (i < attempts - 1)
      await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new MetaPublishError(
    "Meta media processing timed out. " +
      (published
        ? "Check the account before retrying to avoid duplicate posts."
        : "The file was not published; check format and accessibility."),
    published,
  );
}
export async function publishMeta(
  platform: "facebook" | "instagram",
  token: string,
  post: MetaPost,
): Promise<string> {
  if (!token || !post.destination)
    throw new MetaPublishError("Reconnect Meta before publishing.");
  const type = post.mediaType || (post.mediaUrl || post.mediaUrls?.length ? "image" : "text");
  if (!["text", "image", "video"].includes(type))
    throw new MetaPublishError(
      "Meta supports text (Facebook), images and video/Reels here; documents and audio-only posts are unsupported.",
    );
  if (platform === "instagram" && type === "text" && !post.mediaUrl && !post.mediaUrls?.length)
    throw new MetaPublishError(
      "Instagram requires an image or video; text-only publishing is unsupported.",
    );
  if (type !== "text" && !post.mediaUrl && !post.mediaUrls?.length)
    throw new MetaPublishError("Attach an image or video before publishing.");

  const rawUrls: string[] = post.mediaUrls && post.mediaUrls.length ? post.mediaUrls : (post.mediaUrl ? [post.mediaUrl] : []);
  let url = "";
  if (platform === "facebook" && type === "image") {
    // For Facebook photos, direct binary FormData upload (source parameter) is supported and preferred.
    url = post.mediaUrl || (rawUrls[0] || "");
  } else if (post.mediaUrl || rawUrls[0]) {
    const targetUrl = post.mediaUrl || rawUrls[0];
    url = await ensurePublicMetaUrl(targetUrl, type === "video" ? "video" : "image");
  }
  let submitted = false;
  try {
    if (platform === "instagram" && rawUrls.length > 1) {
      const itemIds: string[] = [];
      for (const itemUrl of rawUrls.slice(0, 20)) {
        const publicItemUrl = await ensurePublicMetaUrl(itemUrl, "image");
        const item = await metaRequest(
          post.destination + "/media",
          token,
          { image_url: publicItemUrl, is_carousel_item: "true" },
          "POST",
        );
        if (!item.id) throw new MetaPublishError("Instagram did not return a carousel item ID.");
        await waitMetaReady(item.id, token, "instagram");
        itemIds.push(item.id);
      }
      const carousel = await metaRequest(
        post.destination + "/media",
        token,
        {
          media_type: "CAROUSEL",
          children: itemIds.join(","),
          caption: post.text,
        },
        "POST",
      );
      if (!carousel.id) throw new MetaPublishError("Instagram did not return a carousel container ID.");
      await waitMetaReady(carousel.id, token, "instagram");
      submitted = true;
      const published = await metaRequest(
        post.destination + "/media_publish",
        token,
        { creation_id: carousel.id },
        "POST",
      );
      if (!published.id) throw new MetaPublishError("Instagram did not return a published carousel ID.", true);
      return published.id;
    }
    if (platform === "instagram") {
      const container = await metaRequest(
        post.destination + "/media",
        token,
        type === "video"
          ? {
              media_type: "REELS",
              video_url: url,
              caption: post.text,
              share_to_feed: String(post.metadata?.shareToFeed !== false),
            }
          : { image_url: url, caption: post.text },
        "POST",
      );
      if (!container.id)
        throw new MetaPublishError(
          "Instagram did not return a media container ID.",
        );
      await waitMetaReady(container.id, token, "instagram");
      submitted = true;
      const published = await metaRequest(
        post.destination + "/media_publish",
        token,
        { creation_id: container.id },
        "POST",
      );
      if (!published.id)
        throw new MetaPublishError(
          "Instagram did not return a published media ID.",
          true,
        );
      return published.id;
    }
    if (type === "video" && post.metadata?.publishAs === "reel") {
      const start = await metaRequest(
        post.destination + "/video_reels",
        token,
        { upload_phase: "start" },
        "POST",
      );
      if (!start.video_id)
        throw new MetaPublishError("Facebook did not return a Reel upload ID.");
      const upload = await fetch(
        "https://rupload.facebook.com/video-upload/" +
          metaVersion() +
          "/" +
          encodeURIComponent(start.video_id),
        {
          method: "POST",
          headers: { Authorization: "OAuth " + token, file_url: url },
          signal: AbortSignal.timeout(120000),
          redirect: "error",
        },
      );
      const data = await upload.json();
      if (!upload.ok || !data.success)
        throw new MetaPublishError(
          "Facebook Reel upload failed. Check video format and public accessibility.",
        );
      await waitMetaReady(start.video_id, token, "facebook");
      submitted = true;
      const finished = await metaRequest(
        post.destination + "/video_reels",
        token,
        {
          upload_phase: "finish",
          video_id: start.video_id,
          video_state: "PUBLISHED",
          description: post.text,
        },
        "POST",
      );
      if (!finished.success)
        throw new MetaPublishError(
          "Facebook did not confirm Reel publication.",
          true,
        );
      await waitMetaReady(start.video_id, token, "facebook", true);
      return start.video_id;
    }
    submitted = true;
    let postParams: Record<string, string> | FormData;
    if (type === "video") {
      postParams = { file_url: url, description: post.text };
    } else if (type === "image") {
      // Use verified public HTTPS URL for Facebook Page photo publishing.
      // Meta Graph API fetches this directly and avoids HTTP 500 multipart payload errors.
      const publicUrl = await ensurePublicMetaUrl(url, "image");
      postParams = { url: publicUrl, caption: post.text };
    } else {
      postParams = { message: post.text };
    }

    const result = await metaRequest(
      post.destination +
        (type === "video" ? "/videos" : type === "image" ? "/photos" : "/feed"),
      token,
      postParams,
      "POST",
      type === "video" ? "graph-video.facebook.com" : "graph.facebook.com",
    );
    const id = result.post_id || result.id;
    if (!id)
      throw new MetaPublishError(
        "Facebook did not return a published post ID.",
        true,
      );
    if (type === "video") await waitMetaReady(id, token, "facebook", true);
    return id;
  } catch (error: any) {
    if (error instanceof MetaPublishError) throw error;
    throw new MetaPublishError(
      error.message || "Meta publishing failed.",
      submitted,
    );
  }
}
