import { resolveMetaMedia } from './meta.media.js';
import { getStorageProvider } from './storage/storage.factory.js';
import { uploadAutoPosterJpegToStorage } from './auto-poster.js';
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
import {assertSourceMediaPublication} from './documents/source-publishing-guard.js';

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
    media_asset_id?: string;
    media_url?: string;
    status?:string;
    approved_by?:string|null;
  },
  platform: Platform,
  options?: { isPublishing?: boolean }
): Promise<ProviderPublishPayload> {
  const isPublishing = options?.isPublishing ?? true;

  // 1. Extract raw variant for target platform
  const variants = typeof content.variants === 'string' ? JSON.parse(content.variants) : content.variants;
  const key = Object.keys(variants || {}).find(k => k.toLowerCase() === platform.toLowerCase());
  const rawVariant = key ? variants[key] : undefined;
  const variantObj = normalizeVariant(rawVariant, content.body, content.title);

  if (platform !== 'YouTube') {
    variantObj.mediaAssetId ||= content.media_asset_id;
    variantObj.mediaUrl ||= content.media_url || variants?.mediaUrl;
    if (variantObj.mediaType === 'text' && (variantObj.mediaAssetId || variantObj.mediaUrl)) variantObj.mediaType = variants?.mediaType || 'image';
    if (platform === 'Instagram' && !variantObj.mediaAssetId && !variantObj.mediaUrl) {
      if (isPublishing) {
        const autoPoster = await uploadAutoPosterJpegToStorage(
          variantObj.caption || content.body || 'ContentOS Update',
          variantObj.title || content.title || '',
          {workspaceId:content.workspace_id,db}
        );
        variantObj.mediaUrl = autoPoster.url;
      } else {
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        const textQuery = encodeURIComponent(variantObj.caption || content.body || 'ContentOS Update');
        const titleQuery = encodeURIComponent(variantObj.title || content.title || '');
        variantObj.mediaUrl = `${appUrl}/api/v1/social/meta/text-card?text=${textQuery}&title=${titleQuery}`;
      }
      variantObj.mediaType = 'image';
    }
  }
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
  if(variantObj.mediaAssetId)await assertSourceMediaPublication(db,content.workspace_id,variantObj.mediaAssetId,content);
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
  if (variantObj.mediaAssetId && (platform === 'Facebook' || platform === 'Instagram')) {
    const media = await resolveMetaMedia(db,content.workspace_id,variantObj.mediaAssetId,isPublishing,platform==='Instagram');
    resolvedMediaUrl=media.url;resolvedMimeType=media.mimeType;resolvedMediaType=media.type;
    const checked=validatePlatformVariant(platform,{...variantObj,mediaType:media.type},{isPublishing});
    if(!checked.valid)throw new BadRequestException(checked.errors.join('; '));
  } else if (variantObj.mediaAssetId) {
    const assetRes = await db.query(
      "SELECT id, bucket, object_key, mime_type FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND status='COMPLETED'",
      [variantObj.mediaAssetId, content.workspace_id]
    );
    if (assetRes.rows.length > 0) {
      const asset = assetRes.rows[0];
      resolvedMediaUrl = await getStorageProvider().provider.getSignedDownloadUrl(asset.bucket,asset.object_key,3600);
      resolvedMimeType = asset.mime_type;
      if (asset.mime_type?.startsWith("image/")) resolvedMediaType = "image";
      else if (asset.mime_type?.startsWith("video/")) resolvedMediaType = "video";
      else if (asset.mime_type === "application/pdf") resolvedMediaType = "document";
    } else throw new BadRequestException('Attached media is missing or incomplete in this workspace.');
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
