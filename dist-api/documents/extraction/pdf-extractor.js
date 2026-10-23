import { createRequire } from "node:module";
import { normalizeText } from "./text-normalizer.js";
const require = createRequire(import.meta.url);
function sanitizeText(str) {
    if (!str)
        return "";
    return str.replace(/\0/g, "");
}
export function removeRepeatingWatermarks(pages) {
    if (!pages || pages.length <= 2)
        return;
    const lineOccurrences = new Map();
    for (const page of pages) {
        const lines = (page.cleanText || "")
            .split("\n")
            .map((l) => l.trim().toLowerCase())
            .filter((l) => l.length > 0 && l.length <= 100);
        const uniqueInPage = new Set(lines);
        for (const l of uniqueInPage) {
            lineOccurrences.set(l, (lineOccurrences.get(l) || 0) + 1);
        }
    }
    // Any short line appearing on >= 3 pages AND on >= 20% of pages is a repeating header/footer/watermark
    const watermarkLines = new Set();
    const threshold = Math.max(3, Math.ceil(pages.length * 0.2));
    for (const [line, count] of lineOccurrences.entries()) {
        if (count >= threshold) {
            watermarkLines.add(line);
        }
    }
    if (watermarkLines.size > 0) {
        for (const page of pages) {
            const filteredClean = (page.cleanText || "")
                .split("\n")
                .filter((l) => !watermarkLines.has(l.trim().toLowerCase()))
                .join("\n")
                .trim();
            page.cleanText = filteredClean;
            page.characterCount = filteredClean.length;
        }
    }
}
export async function extractPDFPages(buffer, options) {
    const maxPages = options?.maxPages || Number(process.env.PDF_MAX_PAGES) || 500;
    try {
        const pdfModule = await import("pdf-parse");
        const PDFParseClass = pdfModule.PDFParse || pdfModule.default?.PDFParse;
        if (typeof PDFParseClass === "function") {
            const parser = new PDFParseClass({ data: buffer });
            try {
                const textResult = await parser.getText();
                const pageCount = textResult.total || textResult.pages?.length || 1;
                if (pageCount > maxPages) {
                    throw new Error(`PDF exceeds maximum allowed page limit of ${maxPages} pages.`);
                }
                const pages = [];
                const rawPages = textResult.pages || [];
                if (rawPages.length > 0) {
                    for (let i = 0; i < rawPages.length && i < maxPages; i++) {
                        const pageObj = rawPages[i];
                        const raw = sanitizeText(pageObj.text || `[Page ${i + 1}]`);
                        const clean = normalizeText(raw);
                        pages.push({
                            pageNumber: pageObj.num || i + 1,
                            rawText: raw,
                            cleanText: clean,
                            characterCount: clean.length,
                            extractionMethod: "pdf-parse-v2",
                            ocrUsed: false,
                        });
                    }
                }
                else {
                    const raw = sanitizeText(textResult.text || "[Document Text]");
                    const clean = normalizeText(raw);
                    pages.push({
                        pageNumber: 1,
                        rawText: raw,
                        cleanText: clean,
                        characterCount: clean.length,
                        extractionMethod: "pdf-parse-v2",
                        ocrUsed: false,
                    });
                }
                removeRepeatingWatermarks(pages);
                return { pageCount: pages.length, pages };
            }
            finally {
                if (typeof parser.destroy === "function") {
                    await parser.destroy().catch(() => { });
                }
            }
        }
    }
    catch (err) {
        if (err.message && err.message.includes("maximum allowed page limit")) {
            throw err;
        }
        console.warn("[PDF Extractor] Modern PDFParse failed, trying CJS fallback:", err.message);
    }
    // Fallback: CJS function-style pdf-parse (v1 format if present)
    try {
        const rawPdfParse = require("pdf-parse");
        const pdfParse = typeof rawPdfParse === "function" ? rawPdfParse : rawPdfParse.default;
        if (typeof pdfParse === "function") {
            const data = await pdfParse(buffer, { max: maxPages });
            const pageCount = data.numpages || 1;
            const rawPages = data.text ? data.text.split(/\f|\n\n\n+/) : [];
            const pages = [];
            for (let i = 0; i < pageCount; i++) {
                const raw = sanitizeText(rawPages[i] || data.text || `[Page ${i + 1}]`);
                const clean = normalizeText(raw);
                pages.push({
                    pageNumber: i + 1,
                    rawText: raw,
                    cleanText: clean,
                    characterCount: clean.length,
                    extractionMethod: "pdf-parse-v1",
                    ocrUsed: false,
                });
            }
            return { pageCount, pages };
        }
    }
    catch (err) {
        console.warn("[PDF Extractor] CJS fallback failed:", err.message);
    }
    // Final fallback: empty content with single page placeholder
    return {
        pageCount: 1,
        pages: [
            {
                pageNumber: 1,
                rawText: "[Binary PDF - No Text Extracted]",
                cleanText: "[Binary PDF - No Text Extracted]",
                characterCount: 30,
                extractionMethod: "text-fallback",
                ocrUsed: false,
            },
        ],
    };
}
