const fs = require('fs');

let c = fs.readFileSync('server/social.provider.ts', 'utf8');

// 1. parseConfig with TELEGRAM_BOT_TOKEN fallback
const target1 = `    const { botToken, chatId } = config as Record<string, any>;
    if (!botToken || typeof botToken !== "string" || !botToken.trim()) {
      throw new BadRequestException("Telegram bot token is required.");
    }
    if (!chatId || typeof chatId !== "string" || !chatId.trim()) {
      throw new BadRequestException(
        "Telegram target chat/channel ID is required.",
      );
    }
    return { botToken: botToken.trim(), chatId: chatId.trim() };`.replace(/\r?\n/g, '\r\n');

const repl1 = `    const { botToken, chatId } = config as Record<string, any>;
    const effectiveToken =
      botToken && typeof botToken === "string" && botToken.trim() && botToken !== "undefined"
        ? botToken.trim()
        : (process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!effectiveToken) {
      throw new BadRequestException("Telegram bot token is required.");
    }
    if (!chatId || typeof chatId !== "string" || !chatId.trim()) {
      throw new BadRequestException(
        "Telegram target chat/channel ID is required.",
      );
    }
    return { botToken: effectiveToken, chatId: chatId.trim() };`.replace(/\r?\n/g, '\r\n');

if (c.includes(target1)) {
  c = c.replace(target1, repl1);
  console.log('1. Successfully updated parseConfig in social.provider.ts');
} else {
  console.log('1. target1 not found');
}

// 2. Add direct public URL photo publishing before buffer conversion
const target2 = `        const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';`.replace(/\r?\n/g, '\r\n');

const repl2 = `        // Fast Path: If mediaUrl is a public HTTP/HTTPS URL, pass URL directly to Telegram
        if (!isVideo && request.mediaUrl && request.mediaUrl.startsWith("http") && !request.mediaUrl.includes("localhost") && !request.mediaUrl.includes("127.0.0.1")) {
          try {
            const fastRes = await fetch(
              \`https://api.telegram.org/bot\${botToken}/sendPhoto\`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  photo: request.mediaUrl,
                  caption: request.text.slice(0, 1024),
                }),
              },
            );
            const fastData = await fastRes.json();
            if (fastRes.ok && fastData.ok && fastData.result?.message_id) {
              return {
                success: true,
                providerPostId: String(fastData.result.message_id),
                publishedAt: new Date(fastData.result.date * 1000),
              };
            }
          } catch (fastErr) {
            console.warn("[Telegram Provider] Direct URL sendPhoto attempt skipped:", fastErr);
          }
        }

        const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';`.replace(/\r?\n/g, '\r\n');

if (c.includes(target2)) {
  c = c.replace(target2, repl2);
  console.log('2. Successfully added direct URL fast-path in social.provider.ts');
} else {
  console.log('2. target2 not found');
}

// 3. Fallback without parse_mode: HTML if HTML parsing fails
const target3 = `      const res = await fetch(
        \`https://api.telegram.org/bot\${botToken}/sendMessage\`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: request.text,
            parse_mode: "HTML",
          }),
        },
      );`.replace(/\r?\n/g, '\r\n');

const repl3 = `      let res = await fetch(
        \`https://api.telegram.org/bot\${botToken}/sendMessage\`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: request.text,
          }),
        },
      );`.replace(/\r?\n/g, '\r\n');

if (c.includes(target3)) {
  c = c.replace(target3, repl3);
  console.log('3. Successfully updated plain-text sendMessage in social.provider.ts');
} else {
  console.log('3. target3 not found');
}

fs.writeFileSync('server/social.provider.ts', c, 'utf8');

// Now let's update server/publishing.ts claim and executePublishRecord for Telegram token fallback
let pub = fs.readFileSync('server/publishing.ts', 'utf8');

const targetPub1 = `    if (
      !account?.ciphertext ||
      String(account.state).toLowerCase() !== "connected" ||
      (String(account.platform).toLowerCase() !== "youtube" &&
        account.expires_at &&
        new Date(account.expires_at).getTime() <= now.getTime())
    ) {`.replace(/\r?\n/g, '\r\n');

const replPub1 = `    const isTelegramWithEnv = String(account?.platform).toLowerCase() === "telegram" && Boolean(process.env.TELEGRAM_BOT_TOKEN);
    if (
      (!account?.ciphertext && !isTelegramWithEnv) ||
      String(account.state).toLowerCase() !== "connected" ||
      (String(account.platform).toLowerCase() !== "youtube" &&
        account.expires_at &&
        new Date(account.expires_at).getTime() <= now.getTime())
    ) {`.replace(/\r?\n/g, '\r\n');

if (pub.includes(targetPub1)) {
  pub = pub.replace(targetPub1, replPub1);
  console.log('4. Successfully updated claim() in server/publishing.ts');
} else {
  console.log('4. targetPub1 not found');
}

const targetPub2 = `      let token: string;
      try {
        token = decryptToken(account.ciphertext, record.workspace_id);
      } catch {
        token = decryptToken(account.ciphertext, \`\${record.workspace_id}:\${account.id}\`);
      }`.replace(/\r?\n/g, '\r\n');

const replPub2 = `      let token: string;
      try {
        token = decryptToken(account.ciphertext, record.workspace_id);
      } catch {
        try {
          token = decryptToken(account.ciphertext, \`\${record.workspace_id}:\${account.id}\`);
        } catch (decryptErr) {
          if (metaPlatform === "telegram" && process.env.TELEGRAM_BOT_TOKEN) {
            token = process.env.TELEGRAM_BOT_TOKEN.trim();
          } else {
            throw decryptErr;
          }
        }
      }`.replace(/\r?\n/g, '\r\n');

if (pub.includes(targetPub2)) {
  pub = pub.replace(targetPub2, replPub2);
  console.log('5. Successfully updated token decrypt in server/publishing.ts');
} else {
  console.log('5. targetPub2 not found');
}

fs.writeFileSync('server/publishing.ts', pub, 'utf8');
console.log('All patches applied successfully!');

