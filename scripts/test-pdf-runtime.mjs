import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { Readable } from 'node:stream';
import { PDFDocument, StandardFonts } from 'pdf-lib';

let workers = 0, redisClients = 0;
mock.module('bullmq', { namedExports: {
  Worker: class { constructor() { workers++; } },
  Queue: class {},
} });
mock.module('ioredis', { namedExports: { Redis: class { constructor() { redisClients++; } } } });
let responses = [];
const writes = [];
let pdfBytes, knowledgeRuns = 0;
mock.module('../dist-api/storage/storage.factory.js', { namedExports: {
  getStorageProvider: () => ({ bucket: 'test', provider: { read: async () => Readable.from([pdfBytes]) } }),
} });
mock.module('../dist-api/documents/source-media.service.js', { namedExports: { persistDocumentImages: async () => {} } });
mock.module('../dist-api/knowledge/knowledge.service.js', { namedExports: {
  KnowledgeService: class { async processKnowledgeExtraction() { knowledgeRuns++; } },
} });
mock.module('../dist-api/db.js', { namedExports: {
  pool: { query: async (sql, args) => { writes.push({ sql, args }); return responses.shift() || { rows: [], rowCount: 0 }; } },
  transaction: async fn => fn({ query: async (sql, args) => {
    writes.push({ sql, args });
    return { rowCount: 1, rows: [{ id: 'document' }] };
  } }), audit: async () => {},
} });
const { processPDFDocument } = await import('../dist-api/pdf-processing.js');

test('PDF utility imports do not instantiate workers or Redis clients', () => {
  assert.equal(workers, 0);
  assert.equal(redisClients, 0);
});
test('PDF processing rejects documents outside the workspace', async () => {
  responses = [{ rowCount: 0, rows: [] }];
  await assert.rejects(processPDFDocument('missing', 'workspace'), /not found in workspace/);
});
test('PDF processing preserves duplicate-processing lease protection', async () => {
  responses = [{ rowCount: 1, rows: [{ page_count: 3 }] }, { rowCount: 0, rows: [] }];
  assert.deepEqual(await processPDFDocument('document', 'workspace'), { pageCount: 3, chunkCount: 0 });
  assert.equal(workers, 0);
});
test('PDF processing extracts a real PDF, persists pages and chunks, and invokes knowledge extraction', async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText('ContentOS document processing regression test with enough text for digital PDF detection.', { font, size: 12 });
  pdfBytes = Buffer.from(await document.save());
  responses = [{ rowCount: 1, rows: [{ object_key: 'fixture.pdf', original_filename: 'fixture.pdf', created_by: 'test-user' }] }, { rowCount: 1, rows: [{ id: 'document' }] }];
  const result = await processPDFDocument('document', 'workspace');
  assert.equal(result.pageCount, 1);
  assert.ok(result.chunkCount > 0);
  assert.ok(writes.some(w => w.sql.includes('INSERT INTO document_pages')));
  assert.ok(writes.some(w => w.sql.includes('INSERT INTO document_chunks')));
  assert.ok(writes.some(w => w.sql.includes("SET status = 'READY'")));
  assert.equal(knowledgeRuns, 1);
  assert.equal(workers, 0);
});
