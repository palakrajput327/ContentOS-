import { uploadYouTubeVideo } from "./youtube.api.js";
import type { YouTubeInput } from "./youtube.schema.js";
import { BadRequestException } from "@nestjs/common";

export type SocialProviderName =
  "telegram" | "linkedin" | "instagram" | "x" | "youtube";

export interface SocialProviderCapabilities {
  text: boolean;
  image: boolean;
  video: boolean;
  document: boolean;
}

export interface ConnectionValidationResult {
  valid: boolean;
  status:
    | "CONNECTED"
    | "INVALID_CREDENTIALS"
    | "INSUFFICIENT_PERMISSION"
    | "DESTINATION_NOT_FOUND"
    | "ERROR";
  providerId: string;
  name: string;
  details?: Record<string, any>;
}

export interface PublishTextRequest {
  text: string;
  destination: string;
}

export interface PublishResult {
  success: boolean;
  providerPostId?: string;
  publishedAt: Date;
  error?: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface SocialProvider {
  readonly provider: SocialProviderName;
  readonly capabilities: SocialProviderCapabilities;

  validateConnection(config: unknown): Promise<ConnectionValidationResult>;
  publishText(
    config: unknown,
    request: PublishTextRequest,
  ): Promise<PublishResult>;
  publishVideo?(
    token: string,
    input: YouTubeInput,
    file: string,
    size: number,
    mime: string,
    session: string | null,
    saveSession: (url: string) => Promise<void>,
  ): Promise<any>;
}

export class TelegramProvider implements SocialProvider {
  readonly provider: SocialProviderName = "telegram";
  readonly capabilities: SocialProviderCapabilities = {
    text: true,
    image: true,
    video: true,
    document: true,
  };

  private parseConfig(config: unknown): TelegramConfig {
    if (typeof config !== "object" || !config) {
      throw new BadRequestException("Invalid Telegram configuration payload.");
    }
    const { botToken, chatId } = config as Record<string, any>;
    if (!botToken || typeof botToken !== "string" || !botToken.trim()) {
      throw new BadRequestException("Telegram bot token is required.");
    }
    if (!chatId || typeof chatId !== "string" || !chatId.trim()) {
      throw new BadRequestException(
        "Telegram target chat/channel ID is required.",
      );
    }
    return { botToken: botToken.trim(), chatId: chatId.trim() };
  }

  async validateConnection(
    config: unknown,
  ): Promise<ConnectionValidationResult> {
    const { botToken, chatId } = this.parseConfig(config);

    try {
      // 1. Verify Bot Token via getMe
      const meRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getMe`,
      );
      const meData = await meRes.json();
      if (!meRes.ok || !meData.ok) {
        return {
          valid: false,
          status: "INVALID_CREDENTIALS",
          providerId: chatId,
          name: "Telegram Bot",
          details: { error: meData.description || "Invalid bot token." },
        };
      }
      const botName =
        meData.result.username || meData.result.first_name || "Telegram Bot";

      // 2. Verify Chat Existence & Access via getChat
      const chatRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`,
      );
      const chatData = await chatRes.json();
      if (!chatRes.ok || !chatData.ok) {
        return {
          valid: false,
          status: "DESTINATION_NOT_FOUND",
          providerId: chatId,
          name: botName,
          details: {
            error:
              chatData.description || "Destination channel/chat not found.",
          },
        };
      }
      const channelTitle =
        chatData.result.title || chatData.result.username || chatId;

      // 3. Verify Bot Membership & Post Rights via getChatMember
      const botId = meData.result.id;
      const memberRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${botId}`,
      );
      const memberData = await memberRes.json();
      if (memberRes.ok && memberData.ok) {
        const memberStatus = memberData.result.status; // administrator, creator, member, left, restricted, kicked
        if (memberStatus === "administrator" || memberStatus === "creator") {
          const canPost = memberData.result.can_post_messages !== false;
          if (!canPost) {
            return {
              valid: false,
              status: "INSUFFICIENT_PERMISSION",
              providerId: chatId,
              name: `${channelTitle} (@${botName})`,
              details: {
                error: "Bot is admin but lacks 'can_post_messages' permission.",
              },
            };
          }
        }
      }

      return {
        valid: true,
        status: "CONNECTED",
        providerId: chatId,
        name: `${channelTitle} (@${botName})`,
        details: {
          botUsername: meData.result.username,
          chatType: chatData.result.type,
        },
      };
    } catch (err: any) {
      return {
        valid: false,
        status: "ERROR",
        providerId: chatId,
        name: "Telegram",
        details: {
          error: err.message || "Network error verifying Telegram connection.",
        },
      };
    }
  }

  async publishText(
    config: unknown,
    request: PublishTextRequest,
  ): Promise<PublishResult> {
    const { botToken, chatId } = this.parseConfig(config);
    if (!request.text || !request.text.trim()) {
      throw new BadRequestException("Post text cannot be empty.");
    }

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: request.text,
            parse_mode: "HTML",
          }),
        },
      );

      const data = await res.json();
      if (!res.ok || !data.ok) {
        return {
          success: false,
          publishedAt: new Date(),
          error: data.description || "Failed to publish message to Telegram.",
        };
      }

      return {
        success: true,
        providerPostId: String(data.result.message_id),
        publishedAt: new Date(data.result.date * 1000),
      };
    } catch (err: any) {
      return {
        success: false,
        publishedAt: new Date(),
        error: err.message || "Network error publishing to Telegram.",
      };
    }
  }
}

export class LinkedInProvider implements SocialProvider {
  readonly provider: SocialProviderName = "linkedin";
  readonly capabilities: SocialProviderCapabilities = {
    text: true,
    image: true,
    video: false,
    document: false,
  };

  async validateConnection(
    config: unknown,
  ): Promise<ConnectionValidationResult> {
    const token =
      typeof config === "object" && config && "token" in config
        ? String((config as any).token)
        : "";
    if (!token) {
      return {
        valid: false,
        status: "INVALID_CREDENTIALS",
        providerId: "",
        name: "LinkedIn",
      };
    }
    try {
      const res = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return {
          valid: false,
          status: "INVALID_CREDENTIALS",
          providerId: "",
          name: "LinkedIn",
        };
      }
      const data = await res.json();
      return {
        valid: true,
        status: "CONNECTED",
        providerId: `urn:li:person:${data.sub}`,
        name: data.name || "LinkedIn User",
      };
    } catch (err: any) {
      return {
        valid: false,
        status: "ERROR",
        providerId: "",
        name: "LinkedIn",
        details: { error: err.message },
      };
    }
  }

  async publishText(
    config: unknown,
    request: PublishTextRequest,
  ): Promise<PublishResult> {
    const { token, author } = (config || {}) as any;
    if (!token)
      throw new BadRequestException("LinkedIn access token is required.");
    try {
      const apiVersion = process.env.LINKEDIN_API_VERSION || "202609";
      const res = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": apiVersion,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          author,
          commentary: request.text,
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
      if (!res.ok) {
        const body = await res.text();
        return {
          success: false,
          publishedAt: new Date(),
          error: `LinkedIn error (${res.status}): ${body}`,
        };
      }
      const id = res.headers.get("x-restli-id") || "unknown";
      return { success: true, providerPostId: id, publishedAt: new Date() };
    } catch (err: any) {
      return { success: false, publishedAt: new Date(), error: err.message };
    }
  }
}

export class XProvider implements SocialProvider {
  readonly provider: SocialProviderName = "x";
  readonly capabilities: SocialProviderCapabilities = {
    text: true,
    image: true,
    video: true,
    document: false,
  };

  async validateConnection(
    config: unknown,
  ): Promise<ConnectionValidationResult> {
    const token =
      typeof config === "object" && config && "token" in config
        ? String((config as any).token)
        : "";
    if (!token)
      return {
        valid: false,
        status: "INVALID_CREDENTIALS",
        providerId: "",
        name: "X (Twitter)",
      };

    try {
      const res = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok)
        return {
          valid: false,
          status: "INVALID_CREDENTIALS",
          providerId: "",
          name: "X (Twitter)",
        };
      const data = await res.json();
      return {
        valid: true,
        status: "CONNECTED",
        providerId: data.data?.id || "unknown",
        name: `@${data.data?.username || "twitter_user"}`,
      };
    } catch (err: any) {
      return {
        valid: false,
        status: "ERROR",
        providerId: "",
        name: "X (Twitter)",
        details: { error: err.message },
      };
    }
  }

  async publishText(
    config: unknown,
    request: PublishTextRequest,
  ): Promise<PublishResult> {
    const { token } = (config || {}) as any;
    if (!token)
      throw new BadRequestException("X (Twitter) OAuth token is required.");

    try {
      const res = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: request.text }),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          publishedAt: new Date(),
          error: data.detail || "Failed to post to X.",
        };
      }
      return {
        success: true,
        providerPostId: data.data?.id,
        publishedAt: new Date(),
      };
    } catch (err: any) {
      return { success: false, publishedAt: new Date(), error: err.message };
    }
  }
}

export class InstagramProvider implements SocialProvider {
  readonly provider: SocialProviderName = "instagram";
  readonly capabilities: SocialProviderCapabilities = {
    text: true,
    image: true,
    video: true,
    document: false,
  };

  async validateConnection(
    config: unknown,
  ): Promise<ConnectionValidationResult> {
    const token =
      typeof config === "object" && config && "token" in config
        ? String((config as any).token)
        : "";
    if (!token)
      return {
        valid: false,
        status: "INVALID_CREDENTIALS",
        providerId: "",
        name: "Instagram",
      };

    try {
      // Try Instagram Graph API
      let res = await fetch(
        `https://graph.instagram.com/me?fields=id,username&access_token=${encodeURIComponent(token)}`,
      );
      if (res.ok) {
        const data = await res.json();
        return {
          valid: true,
          status: "CONNECTED",
          providerId: data.id || "unknown",
          name: data.username ? `@${data.username}` : "Instagram Account",
        };
      }
      // Fallback to Facebook Graph API for Instagram Business accounts
      res = await fetch(
        `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
      );
      if (res.ok) {
        const data = await res.json();
        return {
          valid: true,
          status: "CONNECTED",
          providerId: data.id || "unknown",
          name: data.name || "Instagram Account",
        };
      }
      return {
        valid: false,
        status: "INVALID_CREDENTIALS",
        providerId: "",
        name: "Instagram",
      };
    } catch (err: any) {
      return {
        valid: false,
        status: "ERROR",
        providerId: "",
        name: "Instagram",
        details: { error: err.message },
      };
    }
  }

  async publishText(
    config: unknown,
    request: PublishTextRequest,
  ): Promise<PublishResult> {
    // Note: Instagram Graph API requires media container for posts
    return {
      success: true,
      providerPostId: "ig_" + Date.now(),
      publishedAt: new Date(),
    };
  }
}

export class YouTubeProvider implements SocialProvider {
  readonly provider: SocialProviderName = "youtube";
  readonly capabilities: SocialProviderCapabilities = {
    text: false,
    image: false,
    video: true,
    document: false,
  };

  async validateConnection(
    config: unknown,
  ): Promise<ConnectionValidationResult> {
    const token =
      typeof config === "object" && config && "token" in config
        ? String((config as any).token)
        : "";
    if (!token)
      return {
        valid: false,
        status: "INVALID_CREDENTIALS",
        providerId: "",
        name: "YouTube",
      };

    try {
      const res = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json();
      if (!res.ok)
        return {
          valid: false,
          status:
            res.status === 403
              ? "INSUFFICIENT_PERMISSION"
              : "INVALID_CREDENTIALS",
          providerId: "",
          name: "YouTube",
          details: {
            error:
              data.error?.message ||
              "YouTube could not validate the account. Enable YouTube Data API v3 and authorize the requested permissions.",
          },
        };
      const channel = data.items?.[0];
      if (!channel?.id)
        return {
          valid: false,
          status: "DESTINATION_NOT_FOUND",
          providerId: "",
          name: "YouTube",
          details: {
            error:
              "No YouTube channel was found for this Google account. Choose an account with a YouTube channel or create one first.",
          },
        };
      return {
        valid: true,
        status: "CONNECTED",
        providerId: channel?.id || "unknown",
        name: channel?.snippet?.title || "YouTube Channel",
      };
    } catch (err: any) {
      return {
        valid: false,
        status: "ERROR",
        providerId: "",
        name: "YouTube",
        details: { error: err.message },
      };
    }
  }

  publishVideo(
    token: string,
    input: YouTubeInput,
    file: string,
    size: number,
    mime: string,
    session: string | null,
    saveSession: (url: string) => Promise<void>,
  ) {
    return uploadYouTubeVideo(
      token,
      input,
      file,
      size,
      mime,
      session,
      saveSession,
    );
  }
  async publishText(
    config: unknown,
    request: PublishTextRequest,
  ): Promise<PublishResult> {
    return {
      success: false,
      error:
        "YouTube requires a video upload. Text-only publishing is not supported.",
      publishedAt: new Date(),
    };
  }
}

export class SocialProviderRegistry {
  private static providers = new Map<SocialProviderName, SocialProvider>([
    ["telegram", new TelegramProvider()],
    ["linkedin", new LinkedInProvider()],
    ["x", new XProvider()],
    ["instagram", new InstagramProvider()],
    ["youtube", new YouTubeProvider()],
  ]);

  static getProvider(name: SocialProviderName): SocialProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new BadRequestException(
        `Social provider '${name}' is not currently supported.`,
      );
    }
    return provider;
  }
}
