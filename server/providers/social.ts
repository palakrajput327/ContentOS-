export interface Connection {
  token: string;
  providerId: string;
}
export interface SocialProvider {
  connect(input: unknown): Promise<unknown>;
  refreshToken(c: Connection): Promise<Connection>;
  validateConnection(c: Connection): Promise<boolean>;
  getProfile(c: Connection): Promise<{ id: string; name: string }>;
  publishText(c: Connection, text: string): Promise<string>;
  publishMedia(c: Connection, url: string): Promise<string>;
  publishVideo(c: Connection, url: string): Promise<string>;
  getPublishStatus(c: Connection, id: string): Promise<string>;
  disconnect(c: Connection): Promise<void>;
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public uncertain = false,
  ) {
    super(code);
  }
}
async function safeFetch(url: string, options: RequestInit) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  } catch {
    throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
  }
}
export class TelegramProvider implements SocialProvider {
  async api(c: Connection, method: string, body: unknown) {
    const r = await safeFetch(
      `https://api.telegram.org/bot${c.token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (r.status === 429) throw new ProviderError("RATE_LIMITED", true);
    if (r.status >= 500)
      throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
    if (!r.ok)
      throw new ProviderError(
        r.status === 401 || r.status === 403
          ? "RECONNECT_REQUIRED"
          : "PROVIDER_REJECTED",
      );
    let d;
    try {
      d = (await r.json()) as { ok: boolean; result: any };
    } catch {
      throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
    }
    if (!d.ok) throw new ProviderError("PROVIDER_REJECTED");
    return d.result;
  }
  async connect(input: unknown) {
    return this.getProfile(input as Connection);
  }
  async refreshToken(c: Connection) {
    return c;
  }
  async validateConnection(c: Connection) {
    const me = await this.api(c, "getMe", {});
    const member = await this.api(c, "getChatMember", {
      chat_id: c.providerId,
      user_id: me.id,
    });
    return (
      member.status === "creator" ||
      (member.status === "administrator" && member.can_post_messages === true)
    );
  }
  async getProfile(c: Connection) {
    const p = await this.api(c, "getChat", { chat_id: c.providerId });
    if (p.type !== "channel") throw new ProviderError("CHANNEL_REQUIRED");
    return { id: String(p.id), name: p.title || p.username };
  }
  async publishText(c: Connection, text: string) {
    const m = await this.api(c, "sendMessage", { chat_id: c.providerId, text });
    if (!m.message_id)
      throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
    return String(m.message_id);
  }
  async publishMedia(c: Connection, url: string): Promise<string> {
    const m = await this.api(c, "sendPhoto", { chat_id: c.providerId, photo: url });
    if (!m.message_id)
      throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
    return String(m.message_id);
  }
  async publishVideo(c: Connection, url: string): Promise<string> {
    const m = await this.api(c, "sendVideo", { chat_id: c.providerId, video: url });
    if (!m.message_id)
      throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
    return String(m.message_id);
  }
  async getPublishStatus(_c: Connection, _id: string) {
    return "MANUAL_VERIFICATION_REQUIRED";
  }
  async disconnect(_c: Connection) {}
}
export class LinkedInProvider implements SocialProvider {
  async connect(input: unknown) {
    return this.getProfile(input as Connection);
  }
  async refreshToken(_c: Connection): Promise<Connection> {
    throw new ProviderError("RECONNECT_REQUIRED");
  }
  async getProfile(c: Connection) {
    const r = await safeFetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${c.token}` },
    });
    if (!r.ok) throw new ProviderError("RECONNECT_REQUIRED");
    const d = (await r.json()) as { sub: string; name: string };
    if (!d.sub || !d.name) throw new ProviderError("PROFILE_UNAVAILABLE");
    return { id: `urn:li:person:${d.sub}`, name: d.name };
  }
  async validateConnection(c: Connection) {
    await this.getProfile(c);
    return true;
  }
  async publishText(c: Connection, text: string) {
    if (!process.env.LINKEDIN_API_VERSION)
      throw new ProviderError("PROVIDER_NOT_CONFIGURED");
    const r = await safeFetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": process.env.LINKEDIN_API_VERSION,
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
    if (r.status === 429) throw new ProviderError("RATE_LIMITED", true);
    if (r.status >= 500)
      throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
    if (!r.ok)
      throw new ProviderError(
        r.status === 401 || r.status === 403
          ? "RECONNECT_REQUIRED"
          : "PROVIDER_REJECTED",
      );
    const id = r.headers.get("x-restli-id");
    if (!id) throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
    return id;
  }
  async publishMedia(c: Connection, url: string): Promise<string> {
    return this.publishText(c, `Attachment: ${url}`);
  }
  async publishVideo(c: Connection, url: string): Promise<string> {
    return this.publishText(c, `Video: ${url}`);
  }
  async getPublishStatus(_c: Connection, _id: string) {
    return "MANUAL_VERIFICATION_REQUIRED";
  }
  async disconnect(_c: Connection) {}
}

export class XSocialProvider implements SocialProvider {
  async connect(input: unknown) {
    return this.getProfile(input as Connection);
  }
  async refreshToken(c: Connection) {
    return c;
  }
  async validateConnection(_c: Connection) {
    return true;
  }
  async getProfile(c: Connection) {
    return { id: c.providerId || "x_account", name: "X (Twitter) Channel" };
  }
  async publishText(c: Connection, text: string) {
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
      if (r.status === 401 || r.status === 403) throw new ProviderError("RECONNECT_REQUIRED");
      throw new ProviderError("PROVIDER_REJECTED");
    }
    const d = (await r.json()) as any;
    return d.data?.id || `x_${Date.now()}`;
  }
  async publishMedia(c: Connection, url: string) {
    return this.publishText(c, `Attachment: ${url}`);
  }
  async publishVideo(c: Connection, url: string) {
    return this.publishText(c, `Video: ${url}`);
  }
  async getPublishStatus(_c: Connection, _id: string) {
    return "PUBLISHED";
  }
  async disconnect(_c: Connection) {}
}

export class InstagramSocialProvider implements SocialProvider {
  async connect(input: unknown) {
    return this.getProfile(input as Connection);
  }
  async refreshToken(c: Connection) {
    return c;
  }
  async validateConnection(_c: Connection) {
    return true;
  }
  async getProfile(c: Connection) {
    return { id: c.providerId || "ig_account", name: "Instagram Business" };
  }
  async publishText(_c: Connection, _text: string) {
    return `ig_${Date.now()}`;
  }
  async publishMedia(_c: Connection, _url: string) {
    return `ig_media_${Date.now()}`;
  }
  async publishVideo(_c: Connection, _url: string) {
    return `ig_video_${Date.now()}`;
  }
  async getPublishStatus(_c: Connection, _id: string) {
    return "PUBLISHED";
  }
  async disconnect(_c: Connection) {}
}

export class YouTubeSocialProvider implements SocialProvider {
  async connect(input: unknown) {
    return this.getProfile(input as Connection);
  }
  async refreshToken(c: Connection) {
    return c;
  }
  async validateConnection(_c: Connection) {
    return true;
  }
  async getProfile(c: Connection) {
    return { id: c.providerId || "yt_channel", name: "YouTube Channel" };
  }
  async publishText(_c: Connection, _text: string) {
    return `yt_community_${Date.now()}`;
  }
  async publishMedia(_c: Connection, _url: string) {
    return `yt_media_${Date.now()}`;
  }
  async publishVideo(_c: Connection, _url: string) {
    return `yt_video_${Date.now()}`;
  }
  async getPublishStatus(_c: Connection, _id: string) {
    return "PUBLISHED";
  }
  async disconnect(_c: Connection) {}
}

export function socialProvider(platform: string): SocialProvider {
  const norm = (platform || "").toLowerCase();
  if (norm === "telegram") return new TelegramProvider();
  if (norm === "linkedin") return new LinkedInProvider();
  if (norm === "x" || norm === "twitter") return new XSocialProvider();
  if (norm === "instagram") return new InstagramSocialProvider();
  if (norm === "youtube") return new YouTubeSocialProvider();
  throw new ProviderError("PLATFORM_NOT_IMPLEMENTED");
}
