import { PDFParse } from "pdf-parse";
import { usefulImageDimensions } from "./source-thumbnail.js";

export interface SourceImage {
  pageNumber: number;
  imageIndex: number;
  kind: "EMBEDDED_IMAGE" | "PAGE_RENDER";
  data: Buffer;
  width: number;
  height: number;
}

// Process one page at a time; never hold an entire PDF's decoded images in memory.
export async function extractSourceImages(
  buffer: Buffer,
  consume: (image: SourceImage) => Promise<void>,
  options?: {
    pageNumber?: number;
    imageIndex?: number;
    kind?: SourceImage["kind"];
    includeFiltered?: boolean;
  },
) {
  let parser = new PDFParse({ data: buffer });
  const maxImages = 200,
    maxBytes = 100 * 1024 * 1024,
    maxImageBytes = 20 * 1024 * 1024;
  let count = 0,
    bytes = 0;
  try {
    const info = await parser.getInfo();
    if (info.total > (Number(process.env.PDF_MAX_PAGES) || 500))
      throw new Error("PDF page limit exceeded.");
    await parser.destroy();
    for (
      let pageNumber = options?.pageNumber || 1;
      pageNumber <= (options?.pageNumber || info.total);
      pageNumber++
    ) {
      if (pageNumber < 1 || pageNumber > info.total)
        throw new Error("Source page no longer exists.");
      // pdf-parse can wait indefinitely on a shared image resource across separate
      // getImage calls. A fresh parser per page keeps repeated logos/images safe.
      parser = new PDFParse({ data: buffer });
      const result = await parser.getImage({
        partial: [pageNumber],
        imageThreshold: 0,
        imageDataUrl: false,
      });
      const embedded = result.pages[0]?.images || [];
      const images: SourceImage[] = embedded.map((image, imageIndex) => ({
        pageNumber,
        imageIndex,
        kind: "EMBEDDED_IMAGE",
        data: Buffer.from(image.data),
        width: image.width,
        height: image.height,
      }));
      // Vector/composite pages have no reusable bitmap: retain an explicitly labeled page rendition.
      if (
        (!images.some((image) =>
          usefulImageDimensions(image.width, image.height),
        ) &&
          !options?.kind) ||
        options?.kind === "PAGE_RENDER"
      ) {
        const text = await parser.getText({ partial: [pageNumber] });
        // Text-rich pages remain accessible through the original PDF; do not store a screenshot for every page.
        if (
          !options?.includeFiltered &&
          (text.pages[0]?.text || "")
            .replace(/--\s*\d+\s*of\s*\d+\s*--/g, "")
            .trim().length >= 80
        ) {
          await parser.destroy();
          continue;
        }
        const rendered = await parser.getScreenshot({
          partial: [pageNumber],
          desiredWidth: 1200,
          imageDataUrl: false,
        });
        const image = rendered.pages[0];
        if (image)
          images.push({
            pageNumber,
            imageIndex: 0,
            kind: "PAGE_RENDER",
            data: Buffer.from(image.data),
            width: image.width,
            height: image.height,
          });
      }
      for (const image of images) {
        if (
          options?.kind &&
          (image.kind !== options.kind ||
            image.imageIndex !== options.imageIndex)
        )
          continue;
        if (!image.data.length) continue;
        if (
          ++count > maxImages ||
          image.data.length > maxImageBytes ||
          (bytes += image.data.length) > maxBytes
        )
          throw new Error(
            "Source media extraction limit reached (200 images, 20 MB each, 100 MB total). Earlier images were retained.",
          );
        await consume(image);
      }
      await parser.destroy();
    }
    return count;
  } finally {
    await parser.destroy();
  }
}
