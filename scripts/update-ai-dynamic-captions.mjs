import fs from 'node:fs';

let code = fs.readFileSync('server/ai.controller.ts', 'utf8').replace(/\r\n/g, '\n');

const targetHelper = `function generateFallbackCaptions(
  topic: string,
  tone = "Professional",
  goal = "Engagement",
  platforms: string[] = ["LinkedIn"],
  brandData?: Record<string, any>
) {`;

const replacementHelper = `function extractContextualHashtags(title: string, content: string, existingHashtags?: string): string {
  const combined = \`\${title} \${content}\`.toLowerCase();
  const words = combined.match(/\\b[a-z]{4,}\\b/g) || [];
  const stopWords = new Set(["this", "that", "with", "from", "your", "have", "more", "will", "been", "only", "were", "into", "their", "about", "which", "there", "brand", "brands", "slide", "page", "write", "claims", "evidence", "approved", "material"]);
  const keywords = words.filter(w => !stopWords.has(w));
  const uniqueKeywords = [...new Set(keywords)].slice(0, 4);
  const dynamicTags = uniqueKeywords.map(k => \`#\${k.charAt(0).toUpperCase() + k.slice(1)}\`);
  
  const userTags = existingHashtags ? existingHashtags.split(/\\s+/).filter(t => t.startsWith('#')) : [];
  const allTags = [...new Set([...dynamicTags, ...userTags, '#hindustansoftwaresolution'])];
  return allTags.join(' ');
}

function generateFallbackCaptions(
  topic: string,
  tone = "Professional",
  goal = "Engagement",
  platforms: string[] = ["LinkedIn"],
  brandData?: Record<string, any>
) {`;

code = code.replace(targetHelper, replacementHelper);

const targetLoop = `  const cta = typeof brandData?.cta === "string" ? brandData.cta.trim() : "";
  const hashtags = typeof brandData?.hashtags === "string" ? brandData.hashtags.trim() : "";

  const variants: Record<string, string> = {};

  for (const p of platforms) {
    switch (p) {
      case "Telegram": {
        const parts = [cleanContent];
        if (cta) parts.push(\`\\n👉 \${cta}\`);
        if (hashtags) parts.push(\`\\n\${hashtags}\`);
        variants["Telegram"] = parts.join("\\n").slice(0, 4000);
        break;
      }
      case "X": {
        let xText = cleanContent;
        if (xText.length > 240) {
          xText = xText.slice(0, 237) + "...";
        }
        if (hashtags && xText.length + hashtags.length + 2 <= 280) {
          xText += "\\n\\n" + hashtags.split(" ").slice(0, 3).join(" ");
        }
        variants["X"] = xText.slice(0, 280);
        break;
      }
      case "Instagram": {
        const parts = [cleanContent];
        if (cta) parts.push(\`\\n\${cta}\`);
        if (hashtags) parts.push(\`\\n.\\n.\\n\${hashtags}\`);
        variants["Instagram"] = parts.join("\\n").slice(0, 2200);
        break;
      }
      case "YouTube": {
        const parts = [cleanContent];
        if (cta) parts.push(\`\\n\\n\${cta}\`);
        if (hashtags) parts.push(\`\\n\${hashtags}\`);
        variants["YouTube"] = parts.join("\\n").slice(0, 5000);
        break;
      }
      case "LinkedIn": {
        const parts = [cleanContent];
        if (cta) parts.push(\`\\n\\n\${cta}\`);
        if (hashtags) parts.push(\`\\n\${hashtags}\`);
        variants["LinkedIn"] = parts.join("\\n").slice(0, 3000);
        break;
      }
      case "Facebook":
      default: {
        const parts = [cleanContent];
        if (cta) parts.push(\`\\n\\n\${cta}\`);
        if (hashtags) parts.push(\`\\n\${hashtags}\`);
        variants[p] = parts.join("\\n").slice(0, 5000);
        break;
      }
    }
  }`;

const replacementLoop = `  const cta = typeof brandData?.cta === "string" ? brandData.cta.trim() : "";
  const dynamicHashtags = extractContextualHashtags(cleanTitle, cleanContent, typeof brandData?.hashtags === "string" ? brandData.hashtags : undefined);

  const variants: Record<string, string> = {};

  for (const p of platforms) {
    switch (p) {
      case "Telegram": {
        const parts = [
          \`📢 **\${cleanTitle}**\`,
          \`\\n\${cleanContent}\`
        ];
        if (cta) parts.push(\`\\n👉 \${cta}\`);
        parts.push(\`\\n\${dynamicHashtags}\`);
        variants["Telegram"] = parts.join("\\n").slice(0, 4000);
        break;
      }
      case "X": {
        let xText = \`\${cleanTitle}: \${cleanContent}\`;
        if (xText.length > 220) {
          xText = xText.slice(0, 217) + "...";
        }
        const topTags = dynamicHashtags.split(" ").slice(0, 3).join(" ");
        variants["X"] = \`\${xText}\\n\\n\${topTags}\`.slice(0, 280);
        break;
      }
      case "Instagram": {
        const parts = [
          \`✨ \${cleanTitle}\`,
          \`\\n\${cleanContent}\`
        ];
        if (cta) parts.push(\`\\n\${cta}\`);
        parts.push(\`\\n.\\n.\\n\${dynamicHashtags}\`);
        variants["Instagram"] = parts.join("\\n").slice(0, 2200);
        break;
      }
      case "YouTube": {
        const parts = [cleanTitle, \`\\n\${cleanContent}\`];
        if (cta) parts.push(\`\\n\\n\${cta}\`);
        parts.push(\`\\n\${dynamicHashtags}\`);
        variants["YouTube"] = parts.join("\\n").slice(0, 5000);
        break;
      }
      case "LinkedIn": {
        const parts = [
          \`💡 \${cleanTitle}\`,
          \`\\n\${cleanContent}\`
        ];
        if (cta) parts.push(\`\\n\\n\${cta}\`);
        parts.push(\`\\n\${dynamicHashtags}\`);
        variants["LinkedIn"] = parts.join("\\n").slice(0, 3000);
        break;
      }
      case "Facebook":
      default: {
        const parts = [
          \`🚀 \${cleanTitle}\`,
          \`\\n\${cleanContent}\`
        ];
        if (cta) parts.push(\`\\n\\n\${cta}\`);
        parts.push(\`\\n\${dynamicHashtags}\`);
        variants[p] = parts.join("\\n").slice(0, 5000);
        break;
      }
    }
  }`;

code = code.replace(targetLoop, replacementLoop);

// Also ensure LLM returned variants have the tags
const targetLlmReturn = `        return {
          title: result.data.title,
          variants: Object.fromEntries(
            platforms.map((p) => [p, variantsMap[p]])
          ),
        };`;

const replacementLlmReturn = `        const title = result.data.title || "Social Post";
        const enhancedVariants: Record<string, string> = {};
        for (const p of platforms) {
          let text = variantsMap[p] || "";
          if (!text.includes("#hindustansoftwaresolution")) {
            const tags = extractContextualHashtags(title, text, brandData?.hashtags);
            text = \`\${text.trim()}\\n\\n\${tags}\`;
          }
          enhancedVariants[p] = text;
        }
        return {
          title,
          variants: enhancedVariants,
        };`;

code = code.replace(targetLlmReturn, replacementLlmReturn);

fs.writeFileSync('server/ai.controller.ts', code, 'utf8');
console.log('Successfully updated ai.controller.ts with dynamic hashtags and platform hooks!');
