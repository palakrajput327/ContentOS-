import ffmpeg from "ffmpeg-static";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { getStorageProvider } from "./storage/storage.factory.js";
import {uploadManagedMedia} from './storage/managed-media.js';
import type {DB} from './db.js';
interface PosterStorageContext {workspaceId:string;userId?:string;db?:DB}

export function renderTextCardSvg(text: string, titleStr?: string): string {
  const cleanText = (text || "ContentOS Post").slice(0, 500);
  const cleanTitle = (titleStr || "").slice(0, 80);

  const words = cleanText.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    if ((currentLine + " " + word).length > 28) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += (currentLine ? " " : "") + word;
    }
  }
  if (currentLine) lines.push(currentLine.trim());
  const displayLines = lines.slice(0, 10);

  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  return `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="50%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#311042"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#6366f1"/>
          <stop offset="100%" stop-color="#a855f7"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#bg)"/>
      <rect x="80" y="80" width="920" height="12" fill="url(#accent)" rx="6"/>
      ${cleanTitle ? `<text x="80" y="160" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="30" font-weight="700" fill="#a855f7" letter-spacing="1.5">${esc(cleanTitle.toUpperCase())}</text>` : ""}
      <g transform="translate(80, ${cleanTitle ? 260 : 220})">
        ${displayLines.map((line, idx) => `<text x="0" y="${idx * 68}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="44" font-weight="600" fill="#f8fafc">${esc(line)}</text>`).join("\n")}
      </g>
      <rect x="80" y="960" width="920" height="2" fill="rgba(255,255,255,0.15)"/>
      <text x="80" y="1005" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="500" fill="#94a3b8">ContentOS Brand Post</text>
    </svg>`;
}

async function renderSvgToJpegCanvas(
  svg: string,
  width = 1080,
  height = 1080,
): Promise<Buffer | null> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(svg));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    return await canvas.encode("jpeg");
  } catch {
    return null;
  }
}

export async function generateTextCardJpegBuffer(
  text: string,
  title?: string,
): Promise<Buffer> {
  const svg = renderTextCardSvg(text, title);
  const executable = (typeof ffmpeg === "string" ? ffmpeg : (ffmpeg as any)?.default) as string | null;
  if (!executable) {
    const fallback = await renderSvgToJpegCanvas(svg, 1080, 1080);
    if (fallback) return fallback;
    throw new Error(
      "Instagram auto-poster generation failed: JPEG image conversion unavailable on server.",
    );
  }

  return new Promise(async (resolve, reject) => {
    const conversion = spawn(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "image2",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-q:v",
        "2",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timeout = setTimeout(async () => {
      conversion.kill();
      const fallback = await renderSvgToJpegCanvas(svg, 1080, 1080);
      if (fallback) resolve(fallback);
      else reject(new Error("JPEG text card generation timed out."));
    }, 15000);

    conversion.stdout.on("data", (chunk) => chunks.push(chunk));
    conversion.stderr.on("data", (chunk) => errChunks.push(chunk));

    conversion.on("error", async (err) => {
      clearTimeout(timeout);
      const fallback = await renderSvgToJpegCanvas(svg, 1080, 1080);
      if (fallback) resolve(fallback);
      else reject(err);
    });

    conversion.on("close", async (code) => {
      clearTimeout(timeout);
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const fallback = await renderSvgToJpegCanvas(svg, 1080, 1080);
        if (fallback) resolve(fallback);
        else {
          const errStr = Buffer.concat(errChunks).toString().trim();
          reject(
            new Error(`JPEG text card generation failed (exit code ${code}): ${errStr || "Unknown FFmpeg error"}`),
          );
        }
      }
    });

    const stream = new Readable();
    stream.push(Buffer.from(svg));
    stream.push(null);
    stream.pipe(conversion.stdin);
  });
}

export async function uploadAutoPosterJpegToStorage(
  text: string,
  title?: string,
  context?:PosterStorageContext,
): Promise<{ url: string; key: string; bucket: string; size: number }> {
  const jpegBuffer = await generateTextCardJpegBuffer(text, title);
  const { provider, bucket } = getStorageProvider();
  const key = `${context?`workspaces/${context.workspaceId}/`:''}auto-posters/${randomUUID()}.jpg`;

  if(context) await uploadManagedMedia({workspaceId:context.workspaceId,userId:context.userId,provider,bucket,objectKey:key,body:jpegBuffer,mimeType:'image/jpeg',filename:'automatic-poster.jpg',type:'GENERATED_ASSET',metadata:{origin:'AUTO_POSTER'}},context.db);
  else {
    if(process.env.NODE_ENV==='production')throw new Error('Workspace context is required for poster storage.');
    await provider.upload({
    bucket,
    objectKey: key,
    body: jpegBuffer,
    mimeType: "image/jpeg",
  });
  }
  let downloadUrl = await provider.getSignedDownloadUrl(bucket, key, 86400);

  if (downloadUrl.startsWith("/")) {
    const base =
      process.env.META_MEDIA_PUBLIC_BASE_URL ||
      process.env.PUBLIC_URL ||
      process.env.APP_URL ||
      "http://localhost:3001";
    downloadUrl = new URL(downloadUrl, base).toString();
  }

  return {
    url: downloadUrl,
    key,
    bucket,
    size: jpegBuffer.length,
  };
}

export interface BrandKitInfo {
  companyName?: string;
  phone?: string;
  website?: string;
  primaryColor?: string;
  accentColor?: string;
}

export interface FestivalPosterOptions {
  title: string;
  wish: string;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    gradientBg: [string, string, string];
    accentColor: string;
    motif: "DIYA" | "FLAG" | "COLORS" | "STARS" | "PEACOCK" | "FLOWER";
  };
  brandKit?: BrandKitInfo;
}

export function renderFestivalPosterSvg(options: FestivalPosterOptions): string {
  const esc = (s: string) =>
    (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const companyName = options.brandKit?.companyName || "Hindustan Brand";
  const phone = options.brandKit?.phone || "+91 98765 43210";
  const website = options.brandKit?.website || "www.brandsite.in";
  const primaryColor = options.brandKit?.primaryColor || options.theme.primaryColor;
  const accentColor = options.brandKit?.accentColor || options.theme.accentColor;

  // Split wish text into display lines
  const words = (options.wish || "").split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    if ((currentLine + " " + word).length > 28) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += (currentLine ? " " : "") + word;
    }
  }
  if (currentLine) lines.push(currentLine.trim());
  const displayLines = lines.slice(0, 5);

  let motifSvg = "";
  if (options.theme.motif === "DIYA") {
    motifSvg = `
      <g transform="translate(540, 180) scale(1.4)">
        <path d="M -40 20 Q 0 50 40 20 Q 20 60 -20 60 Z" fill="${options.theme.accentColor}"/>
        <path d="M -5 15 Q 0 -30 5 15 Z" fill="#fbbf24"/>
        <circle cx="0" cy="-35" r="8" fill="#f97316" opacity="0.8"/>
      </g>`;
  } else if (options.theme.motif === "FLAG") {
    motifSvg = `
      <g transform="translate(540, 160)">
        <rect x="-120" y="-30" width="240" height="20" fill="#FF9933" rx="4"/>
        <rect x="-120" y="-10" width="240" height="20" fill="#FFFFFF" rx="2"/>
        <rect x="-120" y="10" width="240" height="20" fill="#138808" rx="4"/>
        <circle cx="0" cy="0" r="8" fill="none" stroke="#000080" stroke-width="2"/>
      </g>`;
  } else if (options.theme.motif === "COLORS") {
    motifSvg = `
      <g transform="translate(540, 170)">
        <circle cx="-50" cy="0" r="30" fill="#ec4899" opacity="0.8"/>
        <circle cx="0" cy="-30" r="35" fill="#8b5cf6" opacity="0.8"/>
        <circle cx="50" cy="0" r="30" fill="#f43f5e" opacity="0.8"/>
        <circle cx="0" cy="30" r="25" fill="#eab308" opacity="0.8"/>
      </g>`;
  } else {
    motifSvg = `
      <g transform="translate(540, 170)">
        <polygon points="0,-35 10,-10 35,0 10,10 0,35 -10,10 -35,0 -10,-10" fill="${options.theme.accentColor}"/>
      </g>`;
  }

  return `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="festBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${options.theme.gradientBg[0]}"/>
          <stop offset="50%" stop-color="${options.theme.gradientBg[1]}"/>
          <stop offset="100%" stop-color="${options.theme.gradientBg[2]}"/>
        </linearGradient>
        <linearGradient id="brandBar" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${primaryColor}"/>
          <stop offset="100%" stop-color="${accentColor}"/>
        </linearGradient>
      </defs>

      <!-- Background -->
      <rect width="1080" height="1080" fill="url(#festBg)"/>

      <!-- Festive Motif -->
      ${motifSvg}

      <!-- Festival Title Header -->
      <text x="540" y="320" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="52" font-weight="800" fill="${options.theme.accentColor}" text-anchor="middle" letter-spacing="2">${esc(options.title.toUpperCase())}</text>

      <!-- Decorative Divider -->
      <rect x="290" y="350" width="500" height="4" fill="url(#brandBar)" rx="2"/>

      <!-- Wishing Text -->
      <g transform="translate(540, 440)">
        ${displayLines
          .map(
            (line, idx) =>
              `<text x="0" y="${idx * 64}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="38" font-weight="600" fill="#f8fafc" text-anchor="middle">${esc(line)}</text>`,
          )
          .join("\n")}
      </g>

      <!-- Locked Company Brand Footer Frame -->
      <rect x="0" y="900" width="1080" height="180" fill="#090d16" opacity="0.95"/>
      <rect x="0" y="896" width="1080" height="6" fill="url(#brandBar)"/>

      <!-- Company Name / Logo text -->
      <text x="80" y="970" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="36" font-weight="800" fill="#ffffff">${esc(companyName)}</text>
      <text x="80" y="1010" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="22" font-weight="500" fill="#94a3b8">Official Brand Greetings</text>

      <!-- Contact Info -->
      <text x="1000" y="965" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="600" fill="#e2e8f0" text-anchor="end">📞 ${esc(phone)}</text>
      <text x="1000" y="1005" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="22" font-weight="500" fill="${accentColor}" text-anchor="end">🌐 ${esc(website)}</text>
    </svg>`;
}

export async function generateFestivalPosterJpegBuffer(
  options: FestivalPosterOptions,
): Promise<Buffer> {
  const executable = (typeof ffmpeg === "string" ? ffmpeg : (ffmpeg as any)?.default) as string | null;
  const svg = renderFestivalPosterSvg(options);

  if (!executable) {
    const fallback = await renderSvgToJpegCanvas(svg, 1080, 1080);
    return fallback || Buffer.from(svg);
  }

  return new Promise(async (resolve, reject) => {
    const conversion = spawn(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "image2",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-q:v",
        "2",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timeout = setTimeout(async () => {
      conversion.kill();
      const fallback = await renderSvgToJpegCanvas(svg, 1080, 1080);
      resolve(fallback || Buffer.from(svg));
    }, 15000);

    conversion.stdout.on("data", (chunk) => chunks.push(chunk));
    conversion.stderr.on("data", (chunk) => errChunks.push(chunk));

    conversion.on("error", async () => {
      clearTimeout(timeout);
      const fallback = await renderSvgToJpegCanvas(svg, 1080, 1080);
      resolve(fallback || Buffer.from(svg));
    });

    conversion.on("close", async (code) => {
      clearTimeout(timeout);
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const fallback = await renderSvgToJpegCanvas(svg, 1080, 1080);
        resolve(fallback || Buffer.from(svg));
      }
    });

    const stream = new Readable();
    stream.push(Buffer.from(svg));
    stream.push(null);
    stream.pipe(conversion.stdin);
  });
}

export async function uploadFestivalPosterJpegToStorage(
  options: FestivalPosterOptions,
  context?:PosterStorageContext,
): Promise<{ url: string; key: string; bucket: string; size: number }> {
  const imageBuffer = await generateFestivalPosterJpegBuffer(options);
  const { provider, bucket } = getStorageProvider();
  const key = `${context?`workspaces/${context.workspaceId}/`:''}festival-posters/${randomUUID()}.jpg`;
  const isJpeg = imageBuffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const mimeType = isJpeg ? "image/jpeg" : "image/svg+xml";

  if(context) await uploadManagedMedia({workspaceId:context.workspaceId,userId:context.userId,provider,bucket,objectKey:key,body:imageBuffer,mimeType,filename:'festival-poster.jpg',type:'GENERATED_ASSET',metadata:{origin:'FESTIVAL_POSTER'}},context.db);
  else {
    if(process.env.NODE_ENV==='production')throw new Error('Workspace context is required for poster storage.');
    await provider.upload({
    bucket,
    objectKey: key,
    body: imageBuffer,
    mimeType,
  });
  }
  let downloadUrl = await provider.getSignedDownloadUrl(bucket, key, 86400);

  if (downloadUrl.startsWith("/")) {
    const base =
      process.env.META_MEDIA_PUBLIC_BASE_URL ||
      process.env.PUBLIC_URL ||
      process.env.APP_URL ||
      "http://localhost:3001";
    downloadUrl = new URL(downloadUrl, base).toString();
  }

  return {
    url: downloadUrl,
    key,
    bucket,
    size: imageBuffer.length,
  };
}

