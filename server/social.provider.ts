import { metaRequest } from './meta.api.js';
import { uploadYouTubeVideo } from "./youtube.api.js";
import type { YouTubeInput } from "./youtube.schema.js";
import { BadRequestException } from "@nestjs/common";
import { getStorageProvider } from "./storage/storage.factory.js";
import * as path from "node:path";

export type SocialProviderName =
  | "telegram"
  | "linkedin"
  | "facebook"
  | "instagram"
  | "x"
  | "youtube";

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
  mediaUrl?: string;
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

async function getMediaBuffer(
  imageUrl: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (imageUrl.includes("/storage/local/download") || imageUrl.startsWith("/")) {
    try {
      const urlObj = new URL(imageUrl, "http://127.0.0.1:3001");
      const bucket = urlObj.searchParams.get("bucket");
      const key = urlObj.searchParams.get("key");
      if (bucket && key) {
        const { provider } = getStorageProvider();
        const stream = await provider.read(bucket, key);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        const ext = path.extname(key).toLowerCase();
        const mimeType =
          ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".webp"
            ? "image/webp"
            : "image/png";
        return { buffer, mimeType };
      }
    } catch (e) {
      console.error("[Media Resolver] Error reading local storage stream:", e);
    }
  }

  try {
    let fullUrl = imageUrl;
    if (imageUrl.startsWith("/")) {
      const port = process.env.PORT || "3001";
      const baseUrl =
        process.env.PUBLIC_URL ||
        process.env.APP_URL ||
        `http://127.0.0.1:${port}`;
      fullUrl = `${baseUrl}${imageUrl}`;
    }
    const res = await fetch(fullUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") || "image/png";
    return { buffer, mimeType };
  } catch (err) {
    console.error("[Media Resolver] Error fetching remote image:", err);
    return null;
  }
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
          details: {
            error: meData.description || "Telegram Bot Token is expired or invalid.",
          },
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
        const desc = chatData.description || "";
        const isNotFound =
          desc === "Not Found" || desc.toLowerCase().includes("chat not found");
        return {
          valid: false,
          status: "DESTINATION_NOT_FOUND",
          providerId: chatId,
          name: botName,
          details: {
            error: isNotFound
              ? `Channel '${chatId}' not found or Bot (@${botName}) is not an Administrator in the channel. Please add @${botName} as Admin in your channel '${chatId}' first, then click Connect.`
              : desc || "Destination channel/chat not found.",
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
        const memberStatus = memberData.result.status;
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
      if (request.mediaUrl) {
        const mediaInfo = await getMediaBuffer(request.mediaUrl);
        if (mediaInfo) {
          const formData = new FormData();
          formData.append("chat_id", chatId);
          const blob = new Blob([new Uint8Array(mediaInfo.buffer)], {
            type: mediaInfo.mimeType,
          });
          formData.append("photo", blob, "visual.png");
          formData.append("caption", request.text);
          formData.append("parse_mode", "HTML");

          const res = await fetch(
            `https://api.telegram.org/bot${botToken}/sendPhoto`,
            {
              method: "POST",
              body: formData,
            },
          );
          const data = await res.json();
          if (!res.ok || !data.ok) {
            const desc = data.description || "";
            const isTokenError =
              res.status === 401 ||
              res.status === 403 ||
              desc.toLowerCase().includes("unauthorized") ||
              desc.toLowerCase().includes("token");

            return {
              success: false,
              publishedAt: new Date(),
              error: isTokenError
                ? "Telegram Bot Token has expired or is invalid. Please reconnect your Telegram channel with a valid Bot Token."
                : desc || "Failed to publish photo to Telegram.",
            };
          }

          return {
            success: true,
            providerPostId: String(data.result.message_id),
            publishedAt: new Date(data.result.date * 1000),
          };
        }
      }

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
        const desc = data.description || "";
        const isTokenError =
          res.status === 401 ||
          res.status === 403 ||
          desc.toLowerCase().includes("unauthorized") ||
          desc.toLowerCase().includes("token");

        return {
          success: false,
          publishedAt: new Date(),
          error: isTokenError
            ? "Telegram Bot Token has expired or is invalid. Please reconnect your Telegram channel with a valid Bot Token."
            : desc || "Failed to publish message to Telegram.",
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

  private async uploadLinkedInImage(
    token: string,
    author: string,
    mediaInfo: { buffer: Buffer; mimeType: string },
  ): Promise<string | null> {
    try {
      const apiVersion = process.env.LINKEDIN_API_VERSION || "202609";
      console.log(
        `[LinkedIn Publish] Initializing image upload for author: ${author}, buffer size: ${mediaInfo.buffer.length} bytes`,
      );

      const initRes = await fetch(
        "https://api.linkedin.com/rest/images?action=initializeUpload",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "LinkedIn-Version": apiVersion,
            "X-Restli-Protocol-Version": "2.0.0",
          },
          body: JSON.stringify({
            initializeUploadRequest: {
              owner: author,
            },
          }),
        },
      );

      const initText = await initRes.text();
      console.log(
        `[LinkedIn Publish] initializeUpload status: ${initRes.status}, body: ${initText}`,
      );

      if (!initRes.ok) return null;
      const initData = JSON.parse(initText);
      const uploadUrl = initData.value?.uploadUrl;
      const imageUrn = initData.value?.image;

      if (!uploadUrl || !imageUrn) {
        console.error(
          `[LinkedIn Publish] Missing uploadUrl or imageUrn in initializeUpload output:`,
          initData,
        );
        return null;
      }

      console.log(
        `[LinkedIn Publish] Got imageUrn: ${imageUrn}. Performing binary PUT upload...`,
      );

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": mediaInfo.mimeType,
        },
        body: new Uint8Array(mediaInfo.buffer),
      });

      console.log(
        `[LinkedIn Publish] Binary PUT upload status: ${uploadRes.status}, statusText: ${uploadRes.statusText}`,
      );

      if (!uploadRes.ok && uploadRes.status !== 201) return null;
      return imageUrn;
    } catch (err: any) {
      console.error(
        "[LinkedIn Publish] Exception during uploadLinkedInImage:",
        err,
      );
      return null;
    }
  }

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
      let mediaPayload: any = undefined;

      if (request.mediaUrl) {
        console.log(
          `[LinkedIn Publish] Resolving media buffer for URL: ${request.mediaUrl}`,
        );
        const mediaInfo = await getMediaBuffer(request.mediaUrl);
        if (mediaInfo) {
          console.log(
            `[LinkedIn Publish] Media buffer resolved successfully. Buffer size: ${mediaInfo.buffer.length}, mimeType: ${mediaInfo.mimeType}`,
          );
          const imageUrn = await this.uploadLinkedInImage(
            token,
            author,
            mediaInfo,
          );
          if (imageUrn) {
            console.log(
              `[LinkedIn Publish] LinkedIn image uploaded successfully, imageUrn: ${imageUrn}`,
            );
            mediaPayload = {
              media: {
                id: imageUrn,
              },
            };
          } else {
            console.error(
              `[LinkedIn Publish] uploadLinkedInImage returned null for author: ${author}`,
            );
          }
        } else {
          console.error(
            `[LinkedIn Publish] Could not fetch or resolve media buffer from URL: ${request.mediaUrl}`,
          );
        }
      }

      const postBody: any = {
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
      };

      if (mediaPayload) {
        postBody.content = mediaPayload;
      }

      const res = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": apiVersion,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(postBody),
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

export class FacebookProvider implements SocialProvider {
  readonly provider: SocialProviderName = 'facebook';
  readonly capabilities = { text: true, image: true, video: false, document: false };
  async validateConnection(config: unknown): Promise<ConnectionValidationResult> {
    const { token, destination } = (config || {}) as any;
    try {
      if (!token || !destination) throw new Error('Reconnect Meta to select a Facebook Page.');
      const profile = await metaRequest(destination, token, { fields: 'id,name' });
      return {valid:true,status:'CONNECTED',providerId:profile.id,name:profile.name};
    } catch (err: any) { return {valid:false,status:'INVALID_CREDENTIALS',providerId:destination || '',name:'Facebook',details:{error:err.message}}; }
  }
  async publishText(config: unknown, request: PublishTextRequest): Promise<PublishResult> {
    const { token } = (config || {}) as any;
    try {
      const result = await metaRequest(request.destination + (request.mediaUrl ? '/photos' : '/feed'),token,request.mediaUrl ? {url:request.mediaUrl,caption:request.text} : {message:request.text},'POST');
      if (!result.id && !result.post_id) throw new Error('Facebook did not return a published post ID.');
      return {success:true,providerPostId:result.post_id || result.id,publishedAt:new Date()};
    } catch(err: any) { return {success:false,error:err.message,publishedAt:new Date()}; }
  }
}
export class InstagramProvider implements SocialProvider {
  readonly provider: SocialProviderName = 'instagram';
  readonly capabilities = { text: false, image: true, video: false, document: false };
  async validateConnection(config: unknown): Promise<ConnectionValidationResult> {
    const { token, destination } = (config || {}) as any;
    try {
      if (!token || !destination) throw new Error('Reconnect Meta to select the linked Instagram Business account.');
      const profile = await metaRequest(destination,token,{fields:'id,username'});
      return {valid:true,status:'CONNECTED',providerId:profile.id,name:'@'+profile.username};
    } catch(err: any) { return {valid:false,status:'INVALID_CREDENTIALS',providerId:destination || '',name:'Instagram',details:{error:err.message}}; }
  }
  async publishText(config: unknown, request: PublishTextRequest): Promise<PublishResult> {
    const { token } = (config || {}) as any;
    try {
      if (!request.mediaUrl) throw new Error('Instagram publishing requires a publicly accessible image URL.');
      const container = await metaRequest(request.destination+'/media',token,{image_url:request.mediaUrl,caption:request.text},'POST');
      if (!container.id) throw new Error('Instagram did not return a media container ID.');
      const result = await metaRequest(request.destination+'/media_publish',token,{creation_id:container.id},'POST');
      if (!result.id) throw new Error('Instagram did not return a published media ID.');
      return {success:true,providerPostId:result.id,publishedAt:new Date()};
    } catch(err: any) { return {success:false,error:err.message,publishedAt:new Date()}; }
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
    ["facebook", new FacebookProvider()],
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
