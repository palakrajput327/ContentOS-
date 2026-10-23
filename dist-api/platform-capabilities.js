export const PLATFORM_CAPABILITIES = {
    LinkedIn: {
        platform: "LinkedIn",
        maxCaptionLength: 3000,
        supportsTitle: false,
        requiresTitle: false,
        allowedMediaTypes: ["text", "image", "video", "document"],
        requiresMedia: false,
        supportsHashtags: true,
        supportsFormatting: false,
    },
    Facebook: { platform: 'Facebook', maxCaptionLength: 10000, supportsTitle: false, requiresTitle: false, allowedMediaTypes: ['text', 'image', 'video'], requiresMedia: false, supportsHashtags: true, supportsFormatting: false },
    Instagram: {
        platform: "Instagram",
        maxCaptionLength: 2200,
        supportsTitle: false,
        requiresTitle: false,
        allowedMediaTypes: ["image", "video"],
        requiresMedia: true,
        supportsHashtags: true,
        supportsFormatting: false,
    },
    X: {
        platform: "X",
        maxCaptionLength: 280,
        supportsTitle: false,
        requiresTitle: false,
        allowedMediaTypes: ["text", "image", "video"],
        requiresMedia: false,
        supportsHashtags: true,
        supportsFormatting: false,
    },
    Telegram: {
        platform: "Telegram",
        maxCaptionLength: 4096,
        supportsTitle: true,
        requiresTitle: false,
        maxTitleLength: 120,
        allowedMediaTypes: ["text", "image", "video", "document"],
        requiresMedia: false,
        supportsHashtags: true,
        supportsFormatting: true,
    },
    YouTube: {
        platform: "YouTube",
        maxCaptionLength: 5000,
        supportsTitle: true,
        requiresTitle: true,
        maxTitleLength: 100,
        allowedMediaTypes: ["video"],
        requiresMedia: true,
        requiredMediaType: "video",
        supportsHashtags: true,
        supportsFormatting: false,
    },
};
export function normalizeVariant(variant, fallbackCaption = "", fallbackTitle = "") {
    if (typeof variant === "string") {
        return {
            caption: variant || fallbackCaption,
            title: fallbackTitle,
            mediaType: "text",
        };
    }
    if (typeof variant === "object" && variant !== null) {
        return {
            caption: variant.caption ?? fallbackCaption,
            title: variant.title ?? fallbackTitle,
            mediaAssetId: variant.mediaAssetId,
            mediaUrl: variant.mediaUrl,
            mediaType: variant.mediaType || (variant.mediaAssetId || variant.mediaUrl ? "image" : "text"),
            metadata: variant.metadata || {},
        };
    }
    return {
        caption: fallbackCaption,
        title: fallbackTitle,
        mediaType: "text",
    };
}
export function validatePlatformVariant(platform, variant, options) {
    const cap = PLATFORM_CAPABILITIES[platform];
    const errors = [];
    if (!cap) {
        return { valid: false, errors: [`Unsupported platform '${platform}'`] };
    }
    const caption = variant.caption || "";
    const title = variant.title || "";
    const mediaType = variant.mediaType || (variant.mediaAssetId || variant.mediaUrl ? "image" : "text");
    // Caption validation: Require non-empty caption (except YouTube where description is optional)
    if (platform !== "YouTube" && (!caption || !caption.trim())) {
        errors.push("Caption cannot be empty.");
    }
    else if (caption.length > cap.maxCaptionLength) {
        errors.push(`${platform} caption exceeds limit of ${cap.maxCaptionLength} characters (${caption.length} chars).`);
    }
    // Title validation
    if (cap.requiresTitle && (!title || !title.trim())) {
        errors.push(`${platform} requires a post title.`);
    }
    if (title && cap.maxTitleLength && title.length > cap.maxTitleLength) {
        errors.push(`${platform} title exceeds limit of ${cap.maxTitleLength} characters (${title.length} chars).`);
    }
    if (!cap.supportsTitle && title && title.trim()) {
        // Info notice or silent ignore
    }
    // Media validation
    if (cap.requiresMedia) {
        const hasMedia = !!(variant.mediaAssetId || variant.mediaUrl);
        if (platform === "Instagram") {
            // Instagram requires either an attached media asset or a non-empty caption for auto-poster generation
            if (!hasMedia && (!caption || !caption.trim()) && options?.isPublishing) {
                errors.push("Instagram requires an attached image/video or a caption for auto-poster generation.");
            }
        }
        else {
            if (!hasMedia && options?.isPublishing) {
                errors.push(`${platform} requires an attached ${cap.requiredMediaType || "image or video"} media asset.`);
            }
        }
    }
    if (mediaType && mediaType !== "text") {
        if (!cap.allowedMediaTypes.includes(mediaType)) {
            errors.push(`${platform} does not support ${mediaType} media uploads (allowed: ${cap.allowedMediaTypes.join(", ")}).`);
        }
    }
    return { valid: errors.length === 0, errors };
}
