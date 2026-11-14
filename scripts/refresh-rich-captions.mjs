import { pool } from '../server/db.ts';
import { buildRichCaption, extractContactInfoFromText } from '../server/documents/caption-generator.ts';

async function main() {
  try {
    const concepts = (await pool.query(`
      SELECT dvc.id, dvc.concept_title, dvc.source_excerpt, dvc.prompt, dvc.source_page, dvc.caption, dvc.workspace_id, dvc.document_id,
             COALESCE(bi.company_name, d.original_filename) as company_name,
             bi.website_domain
      FROM document_visual_concepts dvc
      JOIN documents d ON d.id = dvc.document_id
      LEFT JOIN document_brand_identities bi ON bi.document_id = dvc.document_id AND bi.workspace_id = dvc.workspace_id
      ORDER BY dvc.updated_at DESC
    `)).rows;

    let updatedCount = 0;
    for (const c of concepts) {
      const cap = c.caption?.trim() || '';
      const isRich = cap.includes('#') && (cap.includes('–') || cap.includes('-') || cap.includes('⚡') || cap.includes('📊') || cap.includes('🛡️') || cap.includes('💎') || cap.includes('📈') || cap.includes('👑') || cap.includes('🚀'));
      
      // If it doesn't have the rich structured format, or has generic boilerplate
      if (!cap || !isRich || cap.includes('In modern enterprise governance, foundational clarity') || cap.includes('Every financial transaction tells a story of connection') || cap.includes('Thank you for your time and attention')) {
        const pagesRes = await pool.query(
          `SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 25`,
          [c.document_id, c.workspace_id]
        );
        const contactInfo = extractContactInfoFromText(pagesRes.rows.map((p) => p.clean_text || ''));

        const rich = buildRichCaption({
          title: c.concept_title,
          companyName: c.company_name,
          websiteDomain: c.website_domain || contactInfo.website,
          phoneNumber: contactInfo.phone,
          excerpt: c.source_excerpt,
          prompt: c.prompt,
          sourcePage: c.source_page || 1,
        });

        await pool.query(
          `UPDATE document_visual_concepts SET caption = $1, updated_at = NOW() WHERE id = $2`,
          [rich, c.id]
        );
        console.log(`Updated concept: "${c.concept_title}" -> Rich Caption`);
        updatedCount++;
      }
    }

    console.log(`Successfully normalized ${updatedCount} concepts to rich structured captions!`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
