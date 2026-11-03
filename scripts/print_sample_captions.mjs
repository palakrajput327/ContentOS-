import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const res = await pool.query(`
    SELECT concept_title, caption FROM document_visual_concepts
    WHERE concept_title IN (
      'Daily Earning Engine ROI Distribution',
      'Executive Royalty Club Global Profit Sharing',
      'Booster Income Accelerator Tiers'
    )
    LIMIT 3
  `);
  for (const r of res.rows) {
    console.log('==================================================');
    console.log('CONCEPT:', r.concept_title);
    console.log('--------------------------------------------------');
    console.log(r.caption);
  }
  await pool.end();
}

run().catch(console.error);

