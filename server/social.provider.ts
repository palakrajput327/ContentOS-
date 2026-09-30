import { BadRequestException } from "@nestjs/common";

export type SocialProviderName = "telegram" | "linkedin" | "instagram" | "x" | "youtube";

export interface SocialProviderCapabilities {
  text: boolean;
  image: boolean;
  video: boolean;
  document: boolean;
}

export interface ConnectionValidationResult {
  valid: boolean;
  status: "CONNECTED" | "INVALID_CREDENTIALS" | "INSUFFICIENT_PERMISSION" | "DESTINATION_NOT_FOUND" | "ERROR";
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
  publishText(config: unknown, request: PublishTextRequest): Promise<PublishResult>;
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
      throw new BadRequestException("Telegram target chat/channel ID is required.");
    }
    return { botToken: botToken.trim(), chatId: chatId.trim() };
  }

  async validateConnection(config: unknown): Promise<ConnectionValidationResult> {
    const { botToken, chatId } = this.parseConfig(config);

    try {
      // 1. Verify Bot Token via getMe
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
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
      const botName = meData.result.username || meData.result.first_name || "Telegram Bot";

      // 2. Verify Chat Existence & Access via getChat
      const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`);
      const chatData = await chatRes.json();
      if (!chatRes.ok || !chatData.ok) {
        return {
          valid: false,
          status: "DESTINATION_NOT_FOUND",
          providerId: chatId,
          name: botName,
          details: { error: chatData.description || "Destination channel/chat not found." },
        };
      }
      const channelTitle = chatData.result.title || chatData.result.username || chatId;

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
              details: { error: "Bot is admin but lacks 'can_post_messages' permission." },
            };
          }
        }
      }

      return {
        valid: true,
        status: "CONNECTED",
        providerId: chatId,
        name: `${channelTitle} (@${botName})`,
        details: { botUsername: meData.result.username, chatType: chatData.result.type },
      };
    } catch (err: any) {
      return {
        valid: false,
        status: "ERROR",
        providerId: chatId,
        name: "Telegram",
        details: { error: err.message || "Network error verifying Telegram connection." },
      };
    }
  }

  async publishText(config: unknown, request: PublishTextRequest): Promise<PublishResult> {
    const { botToken, chatId } = this.parseConfig(config);
    if (!request.text || !request.text.trim()) {
      throw new BadRequestException("Post text cannot be empty.");
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: request.text,
          parse_mode: "HTML",
        }),
      });

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

export class SocialProviderRegistry {
  private static providers = new Map<SocialProviderName, SocialProvider>([
    ["telegram", new TelegramProvider()],
  ]);

  static getProvider(name: SocialProviderName): SocialProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new BadRequestException(`Social provider '${name}' is not currently supported.`);
    }
    return provider;
  }
}
