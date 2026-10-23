import { BadRequestException, NotFoundException } from "@nestjs/common";
import { encryptToken, decryptToken } from "./security.js";
import { getStorageProvider } from "./storage/storage.factory.js";
import { pool } from "./db.js";
import { publicMetaUrl } from "./meta.publishing.js";
import { socialRedirectUri } from "./social.oauth.js";
const aad = "meta-media-download";
export function metaMediaTicket(workspaceId, assetId) {
    return Buffer.from(encryptToken(JSON.stringify({ workspaceId, assetId, expires: Date.now() + 3600000 }), aad)).toString("base64url");
}
export function readMetaMediaTicket(ticket) {
    try {
        if (ticket.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(ticket))
            throw new Error();
        const decoded = Buffer.from(ticket, "base64url");
        if (decoded.toString("base64url") !== ticket)
            throw new Error();
        const envelope = decoded.toString();
        const parts = envelope.split(".");
        if (parts.length !== 3 ||
            parts.some((p) => Buffer.from(p, "base64").toString("base64") !== p))
            throw new Error();
        const data = JSON.parse(decryptToken(envelope, aad));
        if (typeof data.workspaceId !== "string" ||
            typeof data.assetId !== "string" ||
            typeof data.expires !== "number" ||
            data.expires <= Date.now())
            throw new Error();
        return data;
    }
    catch {
        throw new NotFoundException("Media link expired or invalid.");
    }
}
export async function resolveMetaMedia(db, workspaceId, assetId, publicDownload = true, jpeg = false) {
    const asset = (await db.query("SELECT * FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND status='COMPLETED'", [assetId, workspaceId])).rows[0];
    if (!asset)
        throw new BadRequestException("Meta media upload is missing or incomplete in this workspace.");
    if (!asset.mime_type?.startsWith("image/") &&
        !asset.mime_type?.startsWith("video/"))
        throw new BadRequestException("Meta publishing requires an image or video asset.");
    const { provider } = getStorageProvider();
    let url = await provider.getSignedDownloadUrl(asset.bucket, asset.object_key, 3600);
    const convertJpeg = jpeg && asset.mime_type.startsWith('image/') && !['image/jpeg', 'image/jpg'].includes(asset.mime_type);
    if (publicDownload && (url.startsWith("/") || convertJpeg)) {
        const base = process.env.META_MEDIA_PUBLIC_BASE_URL ||
            new URL(socialRedirectUri("facebook")).origin;
        url = new URL("/api/v1/social/meta/media/" + metaMediaTicket(workspaceId, assetId) + (convertJpeg ? '?format=jpeg' : ''), base).toString();
    }
    return {
        url: publicDownload ? publicMetaUrl(url) : url,
        mimeType: publicDownload && convertJpeg ? 'image/jpeg' : asset.mime_type,
        type: asset.mime_type.startsWith("video/") ? "video" : "image",
    };
}
export async function loadMetaMedia(ticket) {
    const data = readMetaMediaTicket(ticket);
    const asset = (await pool.query("SELECT * FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND status='COMPLETED'", [data.assetId, data.workspaceId])).rows[0];
    if (!asset ||
        (!asset.mime_type?.startsWith("image/") &&
            !asset.mime_type?.startsWith("video/")))
        throw new NotFoundException("Media unavailable.");
    return asset;
}
