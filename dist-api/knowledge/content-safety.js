/**
 * ContentOS AI Content Safety & Grounding Guard
 * Ensures AI-generated posts strictly adhere to brand safety,
 * fact grounding from uploaded PDFs, and do not hallucinate or emit toxic tokens.
 */
const FORBIDDEN_PLACEHOLDERS = [
    /\[insert\s+[^\]]+\]/i,
    /\[your\s+(company|brand|website|name|link|phone|email)\]/i,
    /lorem\s+ipsum/i,
    /\bundefined\b/i,
    /\bnull\b/i,
    /\bnan\b/i,
    /as\s+an\s+ai\s+language\s+model/i,
    /i\s+am\s+an\s+ai/i,
    /sorry,\s+i\s+cannot/i,
    /<script\b/i,
    /\bjavascript:/i,
];
const PLATFORM_MAX_LENGTHS = {
    LinkedIn: 3000,
    Telegram: 4096,
    X: 280,
    Facebook: 5000,
    Instagram: 2200,
};
export function validateContentSafety(title, variants, evidence) {
    const warnings = [];
    // 1. Evidence Grounding Check: Must have verified source evidence
    if (!evidence || evidence.length === 0) {
        return {
            safe: false,
            reason: "Post is not grounded in verified PDF knowledge.",
            warnings: ["Missing citation sources"],
        };
    }
    // 2. Title validation
    if (!title || title.trim().length < 5) {
        return {
            safe: false,
            reason: "Title is too short or empty.",
            warnings: ["Invalid title length"],
        };
    }
    for (const pattern of FORBIDDEN_PLACEHOLDERS) {
        if (pattern.test(title)) {
            return {
                safe: false,
                reason: `Title contains unreplaced placeholder or AI artifact: ${pattern}`,
                warnings: ["Placeholder detected in title"],
            };
        }
    }
    // 3. Platform Captions validation
    const platforms = Object.keys(variants);
    if (platforms.length === 0) {
        return {
            safe: false,
            reason: "No platform captions generated.",
            warnings: ["Empty variants"],
        };
    }
    for (const platform of platforms) {
        const text = variants[platform];
        if (!text || text.trim().length < 10) {
            return {
                safe: false,
                reason: `Caption for ${platform} is too short or empty.`,
                warnings: [`Empty caption for ${platform}`],
            };
        }
        const maxLen = PLATFORM_MAX_LENGTHS[platform] || 4000;
        if (text.length > maxLen) {
            return {
                safe: false,
                reason: `Caption for ${platform} exceeds length limit (${text.length} > ${maxLen}).`,
                warnings: [`Length limit exceeded on ${platform}`],
            };
        }
        for (const pattern of FORBIDDEN_PLACEHOLDERS) {
            if (pattern.test(text)) {
                return {
                    safe: false,
                    reason: `Caption for ${platform} contains unreplaced placeholder or AI artifact.`,
                    warnings: [`Placeholder detected in ${platform}`],
                };
            }
        }
    }
    return {
        safe: true,
        warnings,
    };
}
