import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { extractPDFPages } from "../dist-api/documents/extraction/pdf-extractor.js";
import { chunkDocumentPages } from "../dist-api/documents/chunking/document-chunker.js";
import { detectScannedPDF } from "../dist-api/documents/ocr/ocr.provider.js";
import { normalizeText } from "../dist-api/documents/extraction/text-normalizer.js";

async function testPdfProcessing() {
  console.log("=== STEP 3 PDF INTELLIGENCE CORE VERIFICATION ===");

  // 1. Text Normalizer Test
  const rawSample = "  Hello \r\n\r\n\r\n World! \t\t  This is   a   test.  ";
  const normalized = normalizeText(rawSample);
  if (!normalized.includes("Hello") || !normalized.includes("World!")) {
    throw new Error(`Text normalizer failed. Output: '${normalized}'`);
  }
  console.log("✔ Text Normalizer: OK");

  // 2. Create valid multi-page PDF using pdf-lib
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page1 = pdfDoc.addPage([600, 400]);
  page1.drawText("Company Vision and Growth Strategy Page 1. ContentOS is a SaaS platform for social media management.", {
    x: 50,
    y: 350,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });

  const page2 = pdfDoc.addPage([600, 400]);
  page2.drawText("Financial Targets and Revenue Goals Page 2. ContentOS scales to enterprise multi-tenant workspaces.", {
    x: 50,
    y: 350,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);

  // 3. Extract Pages
  const { pageCount, pages } = await extractPDFPages(pdfBuffer);
  console.log(`✔ Page Extraction: ${pageCount} page(s) extracted.`);
  if (pages.length === 0 || !pages[0].cleanText) {
    throw new Error("Page extraction returned 0 pages or empty text");
  }

  // 4. Scanned PDF Detection Test
  const isScanned = detectScannedPDF(pages);
  if (isScanned) {
    throw new Error("Digital text PDF was incorrectly flagged as scanned.");
  }
  console.log("✔ Scanned PDF Heuristic Detector: OK");

  // 5. Chunking & Citation Mapping Test
  const chunks = chunkDocumentPages(pages, { targetTokens: 10, overlapTokens: 2 });
  console.log(`✔ Document Chunker: Generated ${chunks.length} chunks.`);

  if (chunks.length === 0) {
    throw new Error("Chunker generated 0 chunks");
  }

  for (const chunk of chunks) {
    if (chunk.pageStart < 1 || chunk.pageStart > chunk.pageEnd) {
      throw new Error(`Invalid page citation mapping: pageStart=${chunk.pageStart}, pageEnd=${chunk.pageEnd}`);
    }
    if (!chunk.contentHash || chunk.characterCount === 0) {
      throw new Error("Chunk missing contentHash or characterCount");
    }
  }

  console.log("✔ Citation Mapping (pageStart / pageEnd): OK");
  console.log("=== ALL STEP 3 PDF TESTS PASSED SUCCESSFULLY ===");
  process.exit(0);
}

testPdfProcessing().catch((err) => {
  console.error("❌ PDF Processing Test Failed:", err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
