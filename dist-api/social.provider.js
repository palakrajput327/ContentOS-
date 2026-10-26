import { publishMeta, MetaPublishError } from './meta.publishing.js';
import { metaRequest } from './meta.api.js';
import { uploadYouTubeVideo } from "./youtube.api.js";
import { BadRequestException } from "@nestjs/common";
import { getStorageProvider } from "./storage/storage.factory.js";
import * as path from "node:path";
async function getMediaBuffer(imageUrl) {
    if (imageUrl.includes("/storage/local/download") || imageUrl.startsWith("/")) {
        try {
            const urlObj = new URL(imageUrl, "http://127.0.0.1:3001");
            const bucket = urlObj.searchParams.get("bucket");
            const key = urlObj.searchParams.get("key");
            if (bucket && key) {
                const { provider } = getStorageProvider();
                const stream = await provider.read(bucket, key);
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                }
                const buffer = Buffer.concat(chunks);
                const ext = path.extname(key).toLowerCase();
                let mimeType = "image/png";
                if (ext === ".jpg" || ext === ".jpeg")
                    mimeType = "image/jpeg";
                else if (ext === ".webp")
                    mimeType = "image/webp";
                else if (ext === ".gif")
                    mimeType = "image/gif";
                else if (ext === ".mp4" || ext === ".m4v")
                    mimeType = "video/mp4";
                else if (ext === ".mov")
                    mimeType = "video/quicktime";
                else if (ext === ".webm")
                    mimeType = "video/webm";
                return { buffer, mimeType };
            }
        }
        catch (e) {
            console.error("[Media Resolver] Local attachment could not be read.");
        }
    }
    try {
        let fullUrl = imageUrl;
        if (imageUrl.startsWith("/")) {
            const port = process.env.PORT || "3001";
            const baseUrl = process.env.PUBLIC_URL ||
                process.env.APP_URL ||
                `http://127.0.0.1:${port}`;
            fullUrl = `${baseUrl}${imageUrl}`;
        }
        const res = await fetch(fullUrl);
        if (!res.ok)
            return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        const mimeType = res.headers.get("content-type") || "image/png";
        return { buffer, mimeType };
    }
    catch (err) {
        console.error("[Media Resolver] Remote attachment could not be read.");
        return null;
    }
}
export class TelegramProvider {
    provider = "telegram";
    capabilities = {
        text: true,
        image: true,
        video: true,
        document: true,
    };
    parseConfig(config) {
        if (typeof config !== "object" || !config) {
            throw new BadRequestException("Invalid Telegram configuration payload.");
        }
        const { botToken, chatId } = config;
        if (!botToken || typeof botToken !== "string" || !botToken.trim()) {
            throw new BadRequestException("Telegram bot token is required.");
        }
        if (!chatId || typeof chatId !== "string" || !chatId.trim()) {
            throw new BadRequestException("Telegram target chat/channel ID is required.");
        }
        return { botToken: botToken.trim(), chatId: chatId.trim() };
    }
    async validateConnection(config) {
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
                    details: {
                        error: meData.description || "Telegram Bot Token is expired or invalid.",
                    },
                };
            }
            const botName = meData.result.username || meData.result.first_name || "Telegram Bot";
            // 2. Verify Chat Existence & Access via getChat
            const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`);
            const chatData = await chatRes.json();
            if (!chatRes.ok || !chatData.ok) {
                const desc = chatData.description || "";
                const isNotFound = desc === "Not Found" || desc.toLowerCase().includes("chat not found");
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
            const channelTitle = chatData.result.title || chatData.result.username || chatId;
            // 3. Verify Bot Membership & Post Rights via getChatMember
            const botId = meData.result.id;
            const memberRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${botId}`);
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
        }
        catch (err) {
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
    async publishText(config, request) {
        const { botToken, chatId } = this.parseConfig(config);
        if (!request.text || !request.text.trim()) {
            throw new BadRequestException("Post text cannot be empty.");
        }
        try {
            if (request.mediaUrl) {
                let mediaInfo = await getMediaBuffer(request.mediaUrl);
                // If media is missing, unreadable, or SVG, generate a crisp high-res 1080x1080 branded JPEG poster on the fly
                if (!mediaInfo || mediaInfo.mimeType.includes('svg') || mediaInfo.buffer.length < 1000) {
                    try {
                        const { createCanvas } = await import('@napi-rs/canvas');
                        const canvas = createCanvas(1080, 1080);
                        const ctx = canvas.getContext('2d');
                        const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
                        grad.addColorStop(0, '#0f172a');
                        grad.addColorStop(0.5, '#1e1b4b');
                        grad.addColorStop(1, '#312e81');
                        ctx.fillStyle = grad;
                        ctx.fillRect(0, 0, 1080, 1080);
                        // Aesthetic header accent
                        ctx.fillStyle = '#6366f1';
                        ctx.fillRect(80, 100, 140, 8);
                        // Render post text
                        ctx.fillStyle = '#ffffff';
                        ctx.font = 'bold 46px sans-serif';
                        const cleanText = (request.text || 'ContentOS Autonomous Post').replace(/#\S+/g, '').trim().slice(0, 160);
                        const words = cleanText.split(' ');
                        let line = '';
                        let y = 200;
                        for (const w of words) {
                            if ((line + w).length > 28) {
                                ctx.fillText(line, 80, y);
                                line = w + ' ';
                                y += 60;
                                if (y > 800)
                                    break;
                            }
                            else {
                                line += w + ' ';
                            }
                        }
                        if (line && y <= 800)
                            ctx.fillText(line, 80, y);
                        // Hashtag branding footer
                        ctx.fillStyle = '#a5b4fc';
                        ctx.font = 'bold 32px sans-serif';
                        ctx.fillText('#hindustansoftwaresolution', 80, 980);
                        const jpegBuf = await canvas.encode('jpeg');
                        mediaInfo = { buffer: jpegBuf, mimeType: 'image/jpeg' };
                    }
                    catch (canvasErr) {
                        console.warn('[Telegram Canvas Fallback]', canvasErr);
                    }
                }
                if (!mediaInfo)
                    return { success: false, publishedAt: new Date(), error: 'Telegram attached media could not be read. Re-upload the media and retry.' };
                if (request.text.length > 1024)
                    return { success: false, publishedAt: new Date(), error: 'Telegram media caption exceeds 1024 characters. Shorten the Telegram caption.' };
                // Pre-normalize and optimize images for Telegram API:
                // Telegram strictly requires width + height <= 10000 and aspect ratio <= 20:1.
                // We auto-resize any high-res image so max dimension is 1920px (full HD quality).
                const isVideo = mediaInfo.mimeType.startsWith('video/') || request.mediaType === 'video' || request.mediaUrl.toLowerCase().includes('.mp4');
                if (!isVideo && mediaInfo.mimeType.startsWith('image/')) {
                    try {
                        const { loadImage, createCanvas } = await import('@napi-rs/canvas');
                        const img = await loadImage(mediaInfo.buffer);
                        let targetW = img.width;
                        let targetH = img.height;
                        const maxDim = 1920;
                        if (targetW > maxDim || targetH > maxDim) {
                            if (targetW > targetH) {
                                targetH = Math.round((targetH * maxDim) / targetW);
                                targetW = maxDim;
                            }
                            else {
                                targetW = Math.round((targetW * maxDim) / targetH);
                                targetH = maxDim;
                            }
                        }
                        if (targetW !== img.width || targetH !== img.height || mediaInfo.mimeType === 'image/webp') {
                            const canvas = createCanvas(targetW, targetH);
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, targetW, targetH);
                            const jpegBuf = await canvas.encode('jpeg');
                            mediaInfo = { buffer: jpegBuf, mimeType: 'image/jpeg' };
                        }
                    }
                    catch (e) {
                        console.warn('[Telegram Provider] Image pre-normalization:', e);
                    }
                }
                const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';
                const paramName = isVideo ? 'video' : 'photo';
                const filename = isVideo ? 'video.mp4' : 'photo.jpg';
                const formData = new FormData();
                formData.append("chat_id", chatId);
                const blob = new Blob([new Uint8Array(mediaInfo.buffer)], {
                    type: mediaInfo.mimeType,
                });
                formData.append(paramName, blob, filename);
                formData.append("caption", request.text.slice(0, 1024));
                const res = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
                    method: "POST",
                    body: formData,
                });
                let data = await res.json();
                // Fallback 1: If sendPhoto/sendVideo was rejected by Telegram (e.g. PHOTO_INVALID_DIMENSIONS, aspect ratio limits, format),
                // automatically send as sendDocument which accepts ANY dimensions and aspect ratios without restriction.
                if (!res.ok || !data.ok) {
                    const desc = data.description || "";
                    const isTokenError = res.status === 401 || res.status === 403 || desc.toLowerCase().includes("unauthorized") || desc.toLowerCase().includes("token");
                    if (!isTokenError) {
                        try {
                            const docFormData = new FormData();
                            docFormData.append("chat_id", chatId);
                            const docFilename = isVideo ? "video.mp4" : (mediaInfo.mimeType.includes("png") ? "image.png" : "photo.jpg");
                            docFormData.append("document", blob, docFilename);
                            if (request.text) {
                                docFormData.append("caption", request.text.slice(0, 1024));
                            }
                            const docRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: "POST", body: docFormData });
                            const docData = await docRes.json();
                            if (docRes.ok && docData.ok && docData.result?.message_id) {
                                return {
                                    success: true,
                                    providerPostId: String(docData.result.message_id),
                                    publishedAt: new Date(docData.result.date * 1000),
                                };
                            }
                        }
                        catch (err) {
                            console.warn("[Telegram Provider] sendDocument fallback error:", err);
                        }
                        // Fallback 2: If media cannot be sent at all, deliver the post text directly via sendMessage
                        try {
                            const messageText = request.text || (request.mediaUrl ? `Post: ${request.mediaUrl}` : "");
                            if (messageText) {
                                const fbRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        chat_id: chatId,
                                        text: messageText,
                                    }),
                                });
                                const fbData = await fbRes.json();
                                if (fbData.ok && fbData.result?.message_id) {
                                    return {
                                        success: true,
                                        providerPostId: String(fbData.result.message_id),
                                        publishedAt: new Date(fbData.result.date * 1000),
                                    };
                                }
                            }
                        }
                        catch (err) {
                            console.warn("[Telegram Provider] sendMessage fallback error:", err);
                        }
                    }
                    return {
                        success: false,
                        publishedAt: new Date(),
                        uncertain: res.ok && data.ok === true,
                        error: isTokenError
                            ? "Telegram Bot Token has expired or is invalid. Please reconnect your Telegram channel with a valid Bot Token."
                            : `Telegram rejected ${endpoint}: ${desc || "HTTP " + res.status}.`,
                    };
                }
                return {
                    success: true,
                    providerPostId: String(data.result.message_id),
                    publishedAt: new Date(data.result.date * 1000),
                };
            }
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
            if (!res.ok || !data.ok || !data.result?.message_id) {
                const desc = data.description || "";
                const isTokenError = res.status === 401 ||
                    res.status === 403 ||
                    desc.toLowerCase().includes("unauthorized") ||
                    desc.toLowerCase().includes("token");
                return {
                    success: false,
                    publishedAt: new Date(),
                    uncertain: res.ok && data.ok === true,
                    error: isTokenError
                        ? "Telegram Bot Token has expired or is invalid. Please reconnect your Telegram channel with a valid Bot Token."
                        : "Telegram message rejected (HTTP " + res.status + "). Check bot posting rights and chat ID.",
                };
            }
            return {
                success: true,
                providerPostId: String(data.result.message_id),
                publishedAt: new Date(data.result.date * 1000),
            };
        }
        catch (err) {
            return {
                success: false,
                publishedAt: new Date(),
                error: "Telegram request could not be confirmed. Check bot posting rights and connectivity before retrying.",
                uncertain: true,
            };
        }
    }
}
export class LinkedInProvider {
    provider = "linkedin";
    capabilities = {
        text: true,
        image: true,
        video: false,
        document: false,
    };
    async uploadLinkedInImage(token, author, mediaInfo) {
        try {
            const apiVersion = process.env.LINKEDIN_API_VERSION || "202609";
            console.log(`[LinkedIn Publish] Initializing image upload for author: ${author}, buffer size: ${mediaInfo.buffer.length} bytes`);
            const initRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
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
            });
            const initText = await initRes.text();
            console.log(`[LinkedIn Publish] initializeUpload status: ${initRes.status}`);
            if (!initRes.ok)
                return null;
            const initData = JSON.parse(initText);
            const uploadUrl = initData.value?.uploadUrl;
            const imageUrn = initData.value?.image;
            if (!uploadUrl || !imageUrn) {
                console.error('[LinkedIn Publish] Missing upload URL or image ID.');
                return null;
            }
            console.log(`[LinkedIn Publish] Got imageUrn: ${imageUrn}. Performing binary PUT upload...`);
            const uploadRes = await fetch(uploadUrl, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": mediaInfo.mimeType,
                },
                body: new Uint8Array(mediaInfo.buffer),
            });
            console.log(`[LinkedIn Publish] Binary PUT upload status: ${uploadRes.status}, statusText: ${uploadRes.statusText}`);
            if (!uploadRes.ok && uploadRes.status !== 201)
                return null;
            return imageUrn;
        }
        catch (err) {
            console.error('[LinkedIn Publish] Image upload could not complete.');
            return null;
        }
    }
    async validateConnection(config) {
        const token = typeof config === "object" && config && "token" in config
            ? String(config.token)
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
        }
        catch (err) {
            return {
                valid: false,
                status: "ERROR",
                providerId: "",
                name: "LinkedIn",
                details: { error: err.message },
            };
        }
    }
    async publishText(config, request) {
        const { token, author } = (config || {});
        if (!token)
            throw new BadRequestException("LinkedIn access token is required.");
        try {
            const apiVersion = process.env.LINKEDIN_API_VERSION || "202609";
            let mediaPayload = undefined;
            if (request.mediaUrl) {
                console.log('[LinkedIn Publish] Resolving attached image.');
                const mediaInfo = await getMediaBuffer(request.mediaUrl);
                if (mediaInfo) {
                    console.log(`[LinkedIn Publish] Media buffer resolved successfully. Buffer size: ${mediaInfo.buffer.length}, mimeType: ${mediaInfo.mimeType}`);
                    const imageUrn = await this.uploadLinkedInImage(token, author, mediaInfo);
                    if (imageUrn) {
                        console.log(`[LinkedIn Publish] LinkedIn image uploaded successfully, imageUrn: ${imageUrn}`);
                        mediaPayload = {
                            media: {
                                id: imageUrn,
                            },
                        };
                    }
                    else {
                        return { success: false, publishedAt: new Date(), error: 'LinkedIn image upload failed. Check image format, upload permissions and connectivity.' };
                    }
                }
                else {
                    return { success: false, publishedAt: new Date(), error: 'LinkedIn attached image could not be read. Re-upload the image and retry.' };
                }
            }
            const postBody = {
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
                return {
                    success: false,
                    publishedAt: new Date(),
                    error: `LinkedIn rejected the post (HTTP ${res.status}). Check publishing permissions and attachment format.`,
                };
            }
            const id = res.headers.get("x-restli-id");
            if (!id)
                return { success: false, uncertain: true, publishedAt: new Date(), error: 'LinkedIn did not return a post ID. Check the account before retrying.' };
            return { success: true, providerPostId: id, publishedAt: new Date() };
        }
        catch (err) {
            return { success: false, uncertain: true, publishedAt: new Date(), error: 'LinkedIn request could not be confirmed. Check the account before retrying.' };
        }
    }
}
export class XProvider {
    provider = "x";
    capabilities = {
        text: true,
        image: true,
        video: true,
        document: false,
    };
    async validateConnection(config) {
        const token = typeof config === "object" && config && "token" in config
            ? String(config.token)
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
        }
        catch (err) {
            return {
                valid: false,
                status: "ERROR",
                providerId: "",
                name: "X (Twitter)",
                details: { error: err.message },
            };
        }
    }
    async publishText(config, request) {
        const { token } = (config || {});
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
        }
        catch (err) {
            return { success: false, publishedAt: new Date(), error: err.message };
        }
    }
}
export class FacebookProvider {
    provider = 'facebook';
    capabilities = { text: true, image: true, video: true, document: false };
    async validateConnection(config) {
        const { token, destination } = (config || {});
        try {
            if (!token || !destination)
                throw new Error('Reconnect Meta to select a Facebook Page.');
            const profile = await metaRequest(destination, token, { fields: 'id,name' });
            return { valid: true, status: 'CONNECTED', providerId: profile.id, name: profile.name };
        }
        catch (err) {
            return { valid: false, status: 'INVALID_CREDENTIALS', providerId: destination || '', name: 'Facebook', details: { error: err.message } };
        }
    }
    async publishText(config, request) {
        try {
            const id = await publishMeta(this.provider, config?.token, request);
            return { success: true, providerPostId: id, publishedAt: new Date() };
        }
        catch (error) {
            return { success: false, error: error.message, uncertain: error instanceof MetaPublishError && error.uncertain, publishedAt: new Date() };
        }
    }
}
export class InstagramProvider {
    provider = 'instagram';
    capabilities = { text: false, image: true, video: true, document: false };
    async validateConnection(config) {
        const { token, destination } = (config || {});
        try {
            if (!token || !destination)
                throw new Error('Reconnect Meta to select the linked Instagram Business account.');
            const profile = await metaRequest(destination, token, { fields: 'id,username' });
            return { valid: true, status: 'CONNECTED', providerId: profile.id, name: '@' + profile.username };
        }
        catch (err) {
            return { valid: false, status: 'INVALID_CREDENTIALS', providerId: destination || '', name: 'Instagram', details: { error: err.message } };
        }
    }
    async publishText(config, request) {
        try {
            const id = await publishMeta(this.provider, config?.token, request);
            return { success: true, providerPostId: id, publishedAt: new Date() };
        }
        catch (error) {
            return { success: false, error: error.message, uncertain: error instanceof MetaPublishError && error.uncertain, publishedAt: new Date() };
        }
    }
}
export class YouTubeProvider {
    provider = "youtube";
    capabilities = {
        text: false,
        image: false,
        video: true,
        document: false,
    };
    async validateConnection(config) {
        const token = typeof config === "object" && config && "token" in config
            ? String(config.token)
            : "";
        if (!token)
            return {
                valid: false,
                status: "INVALID_CREDENTIALS",
                providerId: "",
                name: "YouTube",
            };
        try {
            const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok)
                return {
                    valid: false,
                    status: res.status === 403
                        ? "INSUFFICIENT_PERMISSION"
                        : "INVALID_CREDENTIALS",
                    providerId: "",
                    name: "YouTube",
                    details: {
                        error: data.error?.message ||
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
                        error: "No YouTube channel was found for this Google account. Choose an account with a YouTube channel or create one first.",
                    },
                };
            return {
                valid: true,
                status: "CONNECTED",
                providerId: channel?.id || "unknown",
                name: channel?.snippet?.title || "YouTube Channel",
            };
        }
        catch (err) {
            return {
                valid: false,
                status: "ERROR",
                providerId: "",
                name: "YouTube",
                details: { error: err.message },
            };
        }
    }
    publishVideo(token, input, file, size, mime, session, saveSession) {
        return uploadYouTubeVideo(token, input, file, size, mime, session, saveSession);
    }
    async publishText(config, request) {
        return {
            success: false,
            error: "YouTube requires a video upload. Text-only publishing is not supported.",
            publishedAt: new Date(),
        };
    }
}
export class SocialProviderRegistry {
    static providers = new Map([
        ["telegram", new TelegramProvider()],
        ["linkedin", new LinkedInProvider()],
        ["x", new XProvider()],
        ["instagram", new InstagramProvider()],
        ["facebook", new FacebookProvider()],
        ["youtube", new YouTubeProvider()],
    ]);
    static getProvider(name) {
        const provider = this.providers.get(name);
        if (!provider) {
            throw new BadRequestException(`Social provider '${name}' is not currently supported.`);
        }
        return provider;
    }
}
