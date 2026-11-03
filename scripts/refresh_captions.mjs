import { Pool } from 'pg';
import { buildRichCaption } from '../dist-api/documents/caption-generator.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const res = await pool.query(`
    SELECT dvc.id, dvc.concept_title, dvc.source_excerpt, dvc.prompt, dvc.source_page,
           COALESCE(d.original_filename, 'TradeOrbit') as document_name
    FROM document_visual_concepts dvc
    JOIN documents d ON d.id = dvc.document_id
  `);

  console.log(`Found ${res.rows.length} concepts to update...`);
  for (const r of res.rows) {
    const isTradeOrbit = (r.concept_title + ' ' + (r.prompt || '') + ' ' + r.document_name).toLowerCase().includes('tradeorbit');
    const docName = isTradeOrbit ? 'TradeOrbit' : r.document_name;
    const newCap = buildRichCaption({
      title: r.concept_title,
      companyName: docName,
      websiteDomain: isTradeOrbit ? 'www.tradeorbit.live' : undefined,
      excerpt: r.source_excerpt,
      prompt: r.prompt,
      sourcePage: r.source_page || 1,
    });
    await pool.query('UPDATE document_visual_concepts SET caption = $1 WHERE id = $2', [newCap, r.id]);
    console.log(`[UPDATED] ${r.concept_title} -> ${newCap.split('\n')[0]}`);
  }

  console.log('Successfully refreshed all concepts in database!');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  pool.end();
});

