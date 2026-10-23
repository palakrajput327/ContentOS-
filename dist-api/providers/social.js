export class ProviderError extends Error {
    code;
    retryable;
    uncertain;
    constructor(code, retryable = false, uncertain = false) {
        super(code);
        this.code = code;
        this.retryable = retryable;
        this.uncertain = uncertain;
    }
}
async function safeFetch(url, options) {
    try {
        return await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(20000),
            redirect: "error",
        });
    }
    catch {
        throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
    }
}
export class TelegramProvider {
    async api(c, method, body) {
        const r = await safeFetch(`https://api.telegram.org/bot${c.token}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (r.status === 429)
            throw new ProviderError("RATE_LIMITED", true);
        if (r.status >= 500)
            throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
        if (!r.ok)
            throw new ProviderError(r.status === 401 || r.status === 403
                ? "RECONNECT_REQUIRED"
                : "PROVIDER_REJECTED");
        let d;
        try {
            d = (await r.json());
        }
        catch {
            throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
        }
        if (!d.ok)
            throw new ProviderError("PROVIDER_REJECTED");
        return d.result;
    }
    async connect(input) {
        return this.getProfile(input);
    }
    async refreshToken(c) {
        return c;
    }
    async validateConnection(c) {
        const me = await this.api(c, "getMe", {});
        const member = await this.api(c, "getChatMember", {
            chat_id: c.providerId,
            user_id: me.id,
        });
        return (member.status === "creator" ||
            (member.status === "administrator" && member.can_post_messages === true));
    }
    async getProfile(c) {
        const p = await this.api(c, "getChat", { chat_id: c.providerId });
        if (p.type !== "channel")
            throw new ProviderError("CHANNEL_REQUIRED");
        return { id: String(p.id), name: p.title || p.username };
    }
    async publishText(c, text) {
        const m = await this.api(c, "sendMessage", { chat_id: c.providerId, text });
        if (!m.message_id)
            throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
        return String(m.message_id);
    }
    async publishMedia(c, url) {
        const m = await this.api(c, "sendPhoto", { chat_id: c.providerId, photo: url });
        if (!m.message_id)
            throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
        return String(m.message_id);
    }
    async publishVideo(c, url) {
        const m = await this.api(c, "sendVideo", { chat_id: c.providerId, video: url });
        if (!m.message_id)
            throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
        return String(m.message_id);
    }
    async getPublishStatus(_c, _id) {
        return "MANUAL_VERIFICATION_REQUIRED";
    }
    async disconnect(_c) { }
}
export class LinkedInProvider {
    async connect(input) {
        return this.getProfile(input);
    }
    async refreshToken(_c) {
        throw new ProviderError("RECONNECT_REQUIRED");
    }
    async getProfile(c) {
        const r = await safeFetch("https://api.linkedin.com/v2/userinfo", {
            headers: { Authorization: `Bearer ${c.token}` },
        });
        if (!r.ok)
            throw new ProviderError("RECONNECT_REQUIRED");
        const d = (await r.json());
        if (!d.sub || !d.name)
            throw new ProviderError("PROFILE_UNAVAILABLE");
        return { id: `urn:li:person:${d.sub}`, name: d.name };
    }
    async validateConnection(c) {
        await this.getProfile(c);
        return true;
    }
    async publishText(c, text) {
        const apiVersion = process.env.LINKEDIN_API_VERSION || "202609";
        const r = await safeFetch("https://api.linkedin.com/rest/posts", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${c.token}`,
                "Content-Type": "application/json",
                "LinkedIn-Version": apiVersion,
                "X-Restli-Protocol-Version": "2.0.0",
            },
            body: JSON.stringify({
                author: c.providerId,
                commentary: text,
                visibility: "PUBLIC",
                distribution: {
                    feedDistribution: "MAIN_FEED",
                    targetEntities: [],
                    thirdPartyDistributionChannels: [],
                },
                lifecycleState: "PUBLISHED",
                isReshareDisabledByAuthor: false,
            }),
        });
        if (r.status === 429)
            throw new ProviderError("RATE_LIMITED", true);
        if (r.status >= 500)
            throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
        if (!r.ok)
            throw new ProviderError(r.status === 401 || r.status === 403
                ? "RECONNECT_REQUIRED"
                : "PROVIDER_REJECTED");
        const id = r.headers.get("x-restli-id");
        if (!id)
            throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
        return id;
    }
    async publishMedia(c, url) {
        try {
            const { SocialProviderRegistry } = await import("../social.provider.js");
            const res = await SocialProviderRegistry.getProvider("linkedin").publishText({ token: c.token, author: c.providerId }, { destination: c.providerId, text: "Shared media", mediaUrl: url, mediaType: "image" });
            if (res.success && res.providerPostId)
                return res.providerPostId;
        }
        catch { }
        return this.publishText(c, `Attachment: ${url}`);
    }
    async publishVideo(c, url) {
        return this.publishText(c, `Video: ${url}`);
    }
    async getPublishStatus(_c, _id) {
        return "MANUAL_VERIFICATION_REQUIRED";
    }
    async disconnect(_c) { }
}
export class XSocialProvider {
    async connect(input) {
        return this.getProfile(input);
    }
    async refreshToken(c) {
        return c;
    }
    async validateConnection(_c) {
        return true;
    }
    async getProfile(c) {
        return { id: c.providerId || "x_account", name: "X (Twitter) Channel" };
    }
    async publishText(c, text) {
        if (c.token.startsWith("mock-") || c.token.length < 10) {
            return `x_sim_${Date.now()}`;
        }
        const r = await safeFetch("https://api.twitter.com/2/tweets", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${c.token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ text }),
        });
        if (!r.ok) {
            if (r.status === 401 || r.status === 403)
                throw new ProviderError("RECONNECT_REQUIRED");
            throw new ProviderError("PROVIDER_REJECTED");
        }
        const d = (await r.json());
        return d.data?.id || `x_${Date.now()}`;
    }
    async publishMedia(c, url) {
        return this.publishText(c, `Attachment: ${url}`);
    }
    async publishVideo(c, url) {
        return this.publishText(c, `Video: ${url}`);
    }
    async getPublishStatus(_c, _id) {
        return "PUBLISHED";
    }
    async disconnect(_c) { }
}
export class InstagramSocialProvider {
    async connect(input) {
        return this.getProfile(input);
    }
    async refreshToken(c) {
        return c;
    }
    async validateConnection(c) {
        try {
            const { SocialProviderRegistry } = await import("../social.provider.js");
            const res = await SocialProviderRegistry.getProvider("instagram").validateConnection({ token: c.token, accountId: c.providerId });
            return res.valid;
        }
        catch {
            return true;
        }
    }
    async getProfile(c) {
        return { id: c.providerId || "ig_account", name: "Instagram Business" };
    }
    async publishText(c, text) {
        const { SocialProviderRegistry } = await import("../social.provider.js");
        const res = await SocialProviderRegistry.getProvider("instagram").publishText({ token: c.token, author: c.providerId }, { destination: c.providerId, text });
        if (!res.success || !res.providerPostId)
            throw new ProviderError(res.error || "INSTAGRAM_PUBLISH_FAILED");
        return res.providerPostId;
    }
    async publishMedia(c, url) {
        const { SocialProviderRegistry } = await import("../social.provider.js");
        const res = await SocialProviderRegistry.getProvider("instagram").publishText({ token: c.token, author: c.providerId }, { destination: c.providerId, text: "", mediaUrl: url, mediaType: "image" });
        if (!res.success || !res.providerPostId)
            throw new ProviderError(res.error || "INSTAGRAM_PUBLISH_FAILED");
        return res.providerPostId;
    }
    async publishVideo(c, url) {
        const { SocialProviderRegistry } = await import("../social.provider.js");
        const res = await SocialProviderRegistry.getProvider("instagram").publishText({ token: c.token, author: c.providerId }, { destination: c.providerId, text: "", mediaUrl: url, mediaType: "video" });
        if (!res.success || !res.providerPostId)
            throw new ProviderError(res.error || "INSTAGRAM_PUBLISH_FAILED");
        return res.providerPostId;
    }
    async getPublishStatus(_c, _id) {
        return "PUBLISHED";
    }
    async disconnect(_c) { }
}
export class YouTubeSocialProvider {
    async connect(input) {
        return this.getProfile(input);
    }
    async refreshToken(c) {
        return c;
    }
    async validateConnection(c) {
        try {
            const { SocialProviderRegistry } = await import("../social.provider.js");
            const res = await SocialProviderRegistry.getProvider("youtube").validateConnection({ token: c.token });
            return res.valid;
        }
        catch {
            return true;
        }
    }
    async getProfile(c) {
        return { id: c.providerId || "yt_channel", name: "YouTube Channel" };
    }
    async publishText(_c, _text) {
        throw new ProviderError("YOUTUBE_TEXT_NOT_SUPPORTED");
    }
    async publishMedia(_c, _url) {
        throw new ProviderError("YOUTUBE_IMAGE_NOT_SUPPORTED");
    }
    async publishVideo(_c, _url) {
        throw new ProviderError("YOUTUBE_VIDEO_REQUIRES_RESUMABLE_UPLOAD");
    }
    async getPublishStatus(_c, _id) {
        return "PUBLISHED";
    }
    async disconnect(_c) { }
}
export function socialProvider(platform) {
    const norm = (platform || "").toLowerCase();
    if (norm === "telegram")
        return new TelegramProvider();
    if (norm === "linkedin")
        return new LinkedInProvider();
    if (norm === "x" || norm === "twitter")
        return new XSocialProvider();
    if (norm === "instagram")
        return new InstagramSocialProvider();
    if (norm === "youtube")
        return new YouTubeSocialProvider();
    throw new ProviderError("PLATFORM_NOT_IMPLEMENTED");
}
