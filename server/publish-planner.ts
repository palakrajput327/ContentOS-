import { pool, type DB } from "./db.js";
import {
  PLATFORM_CAPABILITIES,
  normalizeVariant,
  validatePlatformVariant,
  type Platform,
  type PlatformVariantObject,
  type MediaType,
} from "./platform-capabilities.js";
import { BadRequestException } from "@nestjs/common";

export interface ProviderPublishPayload {
  platform: Platform;
  title: string;
  caption: string;
  mediaAssetId?: string;
  mediaUrl?: string;
  mediaType?: MediaType;
  mimeType?: string;
  metadata: Record<string, any>;
}

export async function createPublishPlan(
  db: DB | typeof pool,
  content: {
    id: string;
    workspace_id: string;
    title: string;
    body: string;
    variants?: Record<string, any>;
    youtube?: any;
  },
  platform: Platform,
  options?: { isPublishing?: boolean }
): Promise<ProviderPublishPayload> {
  const isPublishing = options?.isPublishing ?? true;

  // 1. Extract raw variant for target platform
  const rawVariant = content.variants?.[platform];
  const variantObj = normalizeVariant(rawVariant, content.body, content.title);

  // Special case for YouTube legacy fields if present
  if (platform === "YouTube" && content.youtube) {
    if (!variantObj.title && content.youtube.title) {
      variantObj.title = content.youtube.title;
    }
    if (!variantObj.caption && content.youtube.description) {
      variantObj.caption = content.youtube.description;
    }
    if (!variantObj.mediaAssetId && content.youtube.assetId) {
      variantObj.mediaAssetId = content.youtube.assetId;
    }
    variantObj.mediaType = "video";
  }

  // 2. Validate against PlatformCapabilities
  const validation = validatePlatformVariant(platform, variantObj, { isPublishing });
  if (!validation.valid) {
    throw new BadRequestException(
      `Publishing validation failed for ${platform}: ${validation.errors.join("; ")}`
    );
  }

  let resolvedMediaUrl = variantObj.mediaUrl;
  let resolvedMimeType: string | undefined;
  let resolvedMediaType = variantObj.mediaType || "text";

  // 3. Resolve canonical media reference from media_assets table if mediaAssetId is provided
  if (variantObj.mediaAssetId) {
    const assetRes = await db.query(
      "SELECT id, url, mime_type, type FROM media_assets WHERE id = $1 AND workspace_id = $2",
      [variantObj.mediaAssetId, content.workspace_id]
    );
    if (assetRes.rows.length > 0) {
      const asset = assetRes.rows[0];
      resolvedMediaUrl = asset.url || resolvedMediaUrl;
      resolvedMimeType = asset.mime_type;
      if (asset.mime_type?.startsWith("image/")) resolvedMediaType = "image";
      else if (asset.mime_type?.startsWith("video/")) resolvedMediaType = "video";
      else if (asset.mime_type === "application/pdf") resolvedMediaType = "document";
    }
  }

  return {
    platform,
    title: variantObj.title || content.title || "",
    caption: variantObj.caption || content.body || "",
    mediaAssetId: variantObj.mediaAssetId,
    mediaUrl: resolvedMediaUrl,
    mediaType: resolvedMediaType,
    mimeType: resolvedMimeType,
    metadata: variantObj.metadata || {},
  };
}
