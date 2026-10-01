import { BadRequestException } from "@nestjs/common";

export function socialRedirectUri(platform: string): string {
  const explicit = process.env[`${platform.toUpperCase()}_REDIRECT_URI`]?.trim();
  const base = (process.env.SOCIAL_OAUTH_BASE_URL || process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");
  const value = explicit || `${base}/api/v1/social/accounts/${platform}/callback`;
  let url: URL;
  try { url = new URL(value); } catch {
    throw new BadRequestException(`Invalid ${platform} OAuth redirect URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.pathname !== `/api/v1/social/accounts/${platform}/callback`) {
    throw new BadRequestException(`Set ${platform.toUpperCase()}_REDIRECT_URI to ${base}/api/v1/social/accounts/${platform}/callback and register that exact URL in your developer app.`);
  }
  return value;
}

export function socialCredentialConfigured(value: string | undefined): boolean {
  return Boolean(value?.trim() && !/(oauth_client_id|app_id|client_id|placeholder|your_)/i.test(value));
}
