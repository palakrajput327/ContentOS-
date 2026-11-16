export class SocialPlatformDeleteService {
    /**
     * Dispatches deletion to the appropriate social media platform API
     */
    static async deleteFromPlatform(platform, account, providerPostId) {
        const plat = (platform || "").toLowerCase();
        if (!providerPostId || !providerPostId.trim()) {
            return { success: false, platformDeleted: false, error: "No external platform post ID found." };
        }
        try {
            switch (plat) {
                case "telegram":
                    return await this.deleteTelegram(account.token, account.destination, providerPostId);
                case "linkedin":
                    return await this.deleteLinkedIn(account.token, providerPostId);
                case "facebook":
                    return await this.deleteFacebook(account.token, providerPostId);
                case "instagram":
                    return await this.deleteInstagram(account.token, providerPostId);
                case "x":
                case "twitter":
                    return await this.deleteX(account.token, providerPostId);
                case "youtube":
                    return await this.deleteYouTube(account.token, providerPostId);
                default:
                    return {
                        success: false,
                        platformDeleted: false,
                        error: `Unsupported platform for external deletion: ${platform}`,
                    };
            }
        }
        catch (err) {
            return {
                success: false,
                platformDeleted: false,
                error: err.message || `Unexpected error deleting from ${platform}`,
            };
        }
    }
    /**
     * Telegram: Deletes message via Telegram Bot API deleteMessage endpoint
     */
    static async deleteTelegram(botToken, chatId, messageIdStr) {
        if (!botToken) {
            return { success: false, platformDeleted: false, error: "Missing Telegram bot token." };
        }
        if (!chatId) {
            return { success: false, platformDeleted: false, error: "Missing Telegram chat ID." };
        }
        const messageId = parseInt(messageIdStr.trim(), 10);
        if (isNaN(messageId)) {
            return { success: false, platformDeleted: false, error: `Invalid Telegram message ID: ${messageIdStr}` };
        }
        const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
            }),
            signal: AbortSignal.timeout(15000),
        });
        const data = (await res.json().catch(() => ({})));
        if (res.ok && data.ok) {
            return { success: true, platformDeleted: true };
        }
        const desc = data.description || `HTTP ${res.status}`;
        // If the message is already deleted or not found on Telegram, consider it successfully cleared
        if (desc.toLowerCase().includes("message to delete not found") ||
            desc.toLowerCase().includes("message not found") ||
            desc.toLowerCase().includes("message can't be deleted")) {
            return { success: true, platformDeleted: true };
        }
        return { success: false, platformDeleted: false, error: `Telegram: ${desc}` };
    }
    /**
     * LinkedIn: Deletes share or UGC post via LinkedIn v2 REST API
     */
    static async deleteLinkedIn(token, providerPostId) {
        if (!token) {
            return { success: false, platformDeleted: false, error: "Missing LinkedIn access token." };
        }
        const pid = providerPostId.trim();
        let deleteUrl = "";
        if (pid.startsWith("urn:li:share:")) {
            const shareId = pid.replace("urn:li:share:", "");
            deleteUrl = `https://api.linkedin.com/v2/shares/${shareId}`;
        }
        else if (pid.startsWith("urn:li:ugcPost:")) {
            deleteUrl = `https://api.linkedin.com/v2/ugcPosts/${encodeURIComponent(pid)}`;
        }
        else {
            deleteUrl = `https://api.linkedin.com/rest/posts/${encodeURIComponent(pid)}`;
        }
        const res = await fetch(deleteUrl, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${token}`,
                "X-Restli-Protocol-Version": "2.0.0",
                "LinkedIn-Version": "202401",
            },
            signal: AbortSignal.timeout(20000),
        });
        // 204 No Content = Successfully deleted. 404 = Already deleted or does not exist.
        if (res.status === 204 || res.status === 200 || res.status === 404) {
            return { success: true, platformDeleted: true };
        }
        const errText = await res.text().catch(() => "");
        return {
            success: false,
            platformDeleted: false,
            error: `LinkedIn delete rejected (HTTP ${res.status}): ${errText.slice(0, 150)}`,
        };
    }
    /**
     * Facebook: Deletes Page post via Meta Graph API
     */
    static async deleteFacebook(token, postId) {
        if (!token) {
            return { success: false, platformDeleted: false, error: "Missing Facebook page access token." };
        }
        const res = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(postId.trim())}?access_token=${encodeURIComponent(token)}`, {
            method: "DELETE",
            signal: AbortSignal.timeout(20000),
        });
        const data = (await res.json().catch(() => ({})));
        if (res.ok && (data.success === true || res.status === 200)) {
            return { success: true, platformDeleted: true };
        }
        if (data.error?.code === 100 || data.error?.message?.includes("does not exist") || res.status === 404) {
            return { success: true, platformDeleted: true };
        }
        return {
            success: false,
            platformDeleted: false,
            error: `Facebook: ${data.error?.message || "Failed to delete post."}`,
        };
    }
    /**
     * Instagram: Deletes media via Instagram Graph API
     */
    static async deleteInstagram(token, mediaId) {
        if (!token) {
            return { success: false, platformDeleted: false, error: "Missing Instagram access token." };
        }
        const res = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(mediaId.trim())}?access_token=${encodeURIComponent(token)}`, {
            method: "DELETE",
            signal: AbortSignal.timeout(20000),
        });
        const data = (await res.json().catch(() => ({})));
        if (res.ok && (data.success === true || res.status === 200)) {
            return { success: true, platformDeleted: true };
        }
        if (data.error?.code === 100 || data.error?.message?.includes("does not exist") || res.status === 404) {
            return { success: true, platformDeleted: true };
        }
        return {
            success: false,
            platformDeleted: false,
            error: `Instagram: ${data.error?.message || "Instagram API limitation: media deletion not permitted."}`,
        };
    }
    /**
     * X (Twitter): Deletes tweet via Twitter API v2
     */
    static async deleteX(token, tweetId) {
        if (!token) {
            return { success: false, platformDeleted: false, error: "Missing X access token." };
        }
        const res = await fetch(`https://api.twitter.com/2/tweets/${encodeURIComponent(tweetId.trim())}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(20000),
        });
        if (res.ok || res.status === 404) {
            return { success: true, platformDeleted: true };
        }
        const data = (await res.json().catch(() => ({})));
        return {
            success: false,
            platformDeleted: false,
            error: `X: ${data.detail || data.title || res.statusText}`,
        };
    }
    /**
     * YouTube: Deletes video via YouTube Data API v3
     */
    static async deleteYouTube(token, videoId) {
        if (!token) {
            return { success: false, platformDeleted: false, error: "Missing YouTube access token." };
        }
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId.trim())}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(20000),
        });
        if (res.status === 204 || res.status === 200 || res.status === 404) {
            return { success: true, platformDeleted: true };
        }
        const data = (await res.json().catch(() => ({})));
        return {
            success: false,
            platformDeleted: false,
            error: `YouTube: ${data.error?.message || res.statusText}`,
        };
    }
}
