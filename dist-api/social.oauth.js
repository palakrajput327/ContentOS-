import { BadRequestException } from "@nestjs/common";
export function socialRedirectUri(platform) {
    const explicit = process.env[`${platform.toUpperCase()}_REDIRECT_URI`]?.trim();
    const base = (process.env.SOCIAL_OAUTH_BASE_URL || process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");
    const callbackPath = platform === "facebook" ? '/api/v1/social/facebook/callback' : `/api/v1/social/accounts/${platform}/callback`;
    const value = explicit || `${base}${callbackPath}`;
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new BadRequestException(`Invalid ${platform} OAuth redirect URL.`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.pathname !== callbackPath) {
        throw new BadRequestException(`Set ${platform.toUpperCase()}_REDIRECT_URI to ${base}${callbackPath} and register that exact URL in your developer app.`);
    }
    return value;
}
export function socialCredentialConfigured(value) {
    return Boolean(value?.trim() && !/(oauth_client_id|app_id|client_id|placeholder|your_)/i.test(value));
}
export function metaFrontendUrl() {
    return (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
}
