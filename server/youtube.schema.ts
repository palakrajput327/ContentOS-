import { z } from "zod";
export const youtubeSchema = z
  .object({
    kind: z.enum(["Short", "Video"]),
    assetId: z.string().uuid(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((v) => !/[<>]/.test(v), "Title cannot contain < or >"),
    description: z
      .string()
      .max(5000)
      .refine(
        (v) => Buffer.byteLength(v, "utf8") <= 5000,
        "Description must be at most 5000 UTF-8 bytes",
      ),
    visibility: z.enum(["private", "unlisted", "public"]).default("private"),
    thumbnailAssetId: z.string().uuid().optional(),
  })
  .refine(
    (v) => v.kind !== "Short" || !v.thumbnailAssetId,
    "Custom thumbnails are available for regular videos only",
  );
export type YouTubeInput = z.infer<typeof youtubeSchema>;
export function validateShort(metadata: {
  width: number;
  height: number;
  duration: number;
}) {
  if (
    !Number.isFinite(metadata.duration) ||
    metadata.duration <= 0 ||
    metadata.duration > 180
  )
    throw new Error("Shorts must be no longer than 3 minutes.");
  if (metadata.width <= 0 || metadata.height < metadata.width)
    throw new Error("Shorts must use a square or vertical video.");
}
