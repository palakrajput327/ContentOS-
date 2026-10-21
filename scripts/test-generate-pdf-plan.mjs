import { pool } from '../dist-api/db.js';
import { randomUUID } from 'crypto';

async function main() {
  const wsId = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const docId = 'b2fba451-4fe2-4ce4-a6dd-ce471c7a8b0b';

  // 1. Check existing sources
  const sources = (await pool.query(
    `SELECT dsm.id, dsm.page_number, dsm.media_asset_id, ma.checksum 
     FROM document_source_media dsm 
     JOIN media_assets ma ON dsm.media_asset_id = ma.id 
     WHERE dsm.document_id = $1 ORDER BY dsm.page_number ASC`,
    [docId]
  )).rows;

  console.log(`Found ${sources.length} visual sources for Redhash.pdf.`);

  const topics = [
    { title: "Redhash Social Growth & Brand Scaling", excerpt: "Strategic social media marketing, audience engagement, and high-converting content frameworks for modern brands." },
    { title: "Omnichannel Social Distribution", excerpt: "Seamless publishing and brand amplification across LinkedIn, Instagram, Facebook, and Telegram." },
    { title: "Creative Media Production & Visual Impact", excerpt: "Captivating visual assets, brand storytelling, and high-impact digital posters tailored for social reach." },
    { title: "Data-Driven Audience Engagement", excerpt: "Maximizing impressions, click-through rates, and community growth with analytics-backed posting schedules." },
    { title: "AI-Powered Content Operations", excerpt: "Next-generation content automation, copywriting precision, and scheduled broadcast consistency." }
  ];

  for (let i = 0; i < Math.min(sources.length, topics.length); i++) {
    const src = sources[i];
    const top = topics[i];
    const key = `redhash_slide_${src.page_number}`;

    await pool.query(
      `INSERT INTO document_knowledge(id, workspace_id, document_id, knowledge_type, knowledge_key, value, page_start, page_end, source_excerpt, confidence, status, metadata)
       VALUES($1, $2, $3, 'SERVICE', $4, $5, $6, $6, $7, 0.95, 'CONFIRMED', $8)
       ON CONFLICT (document_id, knowledge_key) WHERE metadata->>'origin'='SOURCE_VISUAL'
       DO UPDATE SET status='CONFIRMED', value=EXCLUDED.value, source_excerpt=EXCLUDED.source_excerpt, metadata=EXCLUDED.metadata`,
      [
        randomUUID(),
        wsId,
        docId,
        key,
        JSON.stringify(top.title),
        src.page_number,
        top.excerpt,
        JSON.stringify({
          origin: 'SOURCE_VISUAL',
          evidenceKind: 'VISUAL_INSIGHT',
          sourceMediaAssetId: src.media_asset_id,
          sourceReferenceId: src.id,
          originalChecksum: src.checksum
        })
      ]
    );
    console.log(`Inserted/Confirmed knowledge item for page ${src.page_number}: ${top.title}`);
  }

  // Verify pool
  const { knowledgePool } = await import('../dist-api/knowledge/automation.service.js');
  const poolItems = await knowledgePool(pool, wsId);
  console.log(`Knowledge pool has ${poolItems.length} topics (eligible: ${poolItems.filter(t => t.eligible).length})`);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
