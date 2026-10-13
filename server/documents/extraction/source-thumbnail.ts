import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { SourceImage } from "./source-images.js";

export const THUMBNAIL_PROFILE = "webp-512-v1";
export function usefulImageDimensions(width: number, height: number) {
  return (
    width >= 96 &&
    height >= 96 &&
    width * height >= 40000 &&
    Math.max(width, height) / Math.min(width, height) <= 15
  );
}
export async function sourceThumbnail(image: SourceImage) {
  if (!usefulImageDimensions(image.width, image.height)) return null;
  let original;
  try {
    original = await loadImage(image.data);
  } catch {
    return null;
  }
  const sample = createCanvas(32, 32),
    sampleCtx = sample.getContext("2d");
  sampleCtx.fillStyle = "#ffffff";
  sampleCtx.fillRect(0, 0, 32, 32);
  sampleCtx.drawImage(original, 0, 0, 32, 32);
  const pixels = sampleCtx.getImageData(0, 0, 32, 32).data;
  let sum = 0,
    square = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const v = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    sum += v;
    square += v * v;
  }
  const variance = square / 1024 - (sum / 1024) ** 2;
  if (variance < 8) return null; // Near-uniform blank/decorative tiles, not semantic inference.
  let longest = 512,
    quality = 72;
  for (let attempt = 0; attempt < 3; attempt++) {
    const scale = Math.min(
      1,
      longest / Math.max(original.width, original.height),
    );
    const width = Math.max(1, Math.round(original.width * scale)),
      height = Math.max(1, Math.round(original.height * scale));
    const canvas = createCanvas(width, height);
    canvas.getContext("2d").drawImage(original, 0, 0, width, height);
    const data = canvas.toBuffer("image/webp", quality);
    if (data.length <= 96 * 1024)
      return { data, width, height, profile: THUMBNAIL_PROFILE };
    longest = 384;
    quality -= 12;
  }
  throw new Error("Thumbnail could not meet the 96 KiB storage limit.");
}
