import { open } from "node:fs/promises";
import { ProviderError } from "./providers/social.js";
export function youtubeError(status, data) {
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status;
    if (status === 401 || ["authError", "invalidCredentials"].includes(reason))
        return new ProviderError("RECONNECT_REQUIRED");
    if (["quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded"].includes(reason))
        return new ProviderError("YOUTUBE_QUOTA_EXCEEDED");
    if (status === 403)
        return new ProviderError("YOUTUBE_PERMISSION_DENIED");
    return new ProviderError(`YOUTUBE_${reason || status}`, status === 429 || status >= 500);
}
async function parsed(res) {
    return res.json().catch(() => ({}));
}
export async function youtubeRequest(token, url, init = {}) {
    const res = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(120000),
        redirect: "manual",
    });
    if ([301, 302, 303, 307].includes(res.status))
        throw new ProviderError("UNEXPECTED_PROVIDER_REDIRECT");
    if (!res.ok && res.status !== 308)
        throw youtubeError(res.status, await parsed(res));
    return res;
}
export function trustedUploadSession(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" ||
        url.hostname !== "www.googleapis.com" ||
        !url.pathname.startsWith("/upload/youtube/v3/videos") ||
        url.username ||
        url.password)
        throw new ProviderError("INVALID_UPLOAD_SESSION");
    return value;
}
// One resumable session per publication. Never retry videos.insert after sending bytes.
export async function uploadYouTubeVideo(token, input, file, size, mime, session, saveSession) {
    if (!session) {
        const start = await youtubeRequest(token, "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Upload-Content-Length": String(size),
                "X-Upload-Content-Type": mime,
            },
            body: JSON.stringify({
                snippet: { title: input.title, description: input.description },
                status: { privacyStatus: input.visibility },
            }),
        });
        session = trustedUploadSession(start.headers.get("location") || "");
        await saveSession(session);
    }
    trustedUploadSession(session);
    const probe = async () => youtubeRequest(token, session, {
        method: "PUT",
        headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` },
    });
    let status = await probe();
    if (status.status !== 308)
        return parsed(status);
    let offset = Number(status.headers.get("range")?.match(/-(\d+)$/)?.[1] ?? -1) + 1;
    const handle = await open(file, "r");
    try {
        let failures = 0;
        while (offset < size) {
            const length = Math.min(8 * 1024 * 1024, size - offset);
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, offset);
            if (bytesRead !== length)
                throw new ProviderError("VIDEO_FILE_TRUNCATED");
            try {
                status = await youtubeRequest(token, session, {
                    method: "PUT",
                    headers: {
                        "Content-Type": mime,
                        "Content-Length": String(length),
                        "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}`,
                    },
                    body: buffer,
                });
            }
            catch (e) {
                if (e instanceof ProviderError && !e.retryable)
                    throw e;
                if (++failures > 3)
                    throw new ProviderError("UPLOAD_OUTCOME_UNKNOWN", false, true);
                // Query the same session rather than uploading a second copy.
                try {
                    status = await probe();
                }
                catch {
                    throw new ProviderError("UPLOAD_OUTCOME_UNKNOWN", false, true);
                }
            }
            if (status.status !== 308)
                return parsed(status);
            const next = Number(status.headers.get("range")?.match(/-(\d+)$/)?.[1] ?? -1) + 1;
            if (next === offset && ++failures > 3)
                throw new ProviderError("UPLOAD_STALLED", false, true);
            offset = next;
        }
        status = await probe();
        if (status.status === 308)
            throw new ProviderError("UPLOAD_OUTCOME_UNKNOWN", false, true);
        return parsed(status);
    }
    finally {
        await handle.close();
    }
}
