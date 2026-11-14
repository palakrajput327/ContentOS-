import fs from 'node:fs';

const file = 'server/documents/visual-concepts.service.ts';
let code = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// 1. Remove generateImageCaptions from generateConceptVisual so it never overwrites the rich caption
const oldGen = `    let generatedCaption:string|undefined;
    try{const {generateImageCaptions}=await import('../ai.controller.js');const copy=await generateImageCaptions(opts.workspaceId,opts.userId,rawAssetId,'Instagram',promptToUse);generatedCaption=copy.options[0]?.caption;}catch(e){console.warn('[VisualConcepts] Image retained; caption generation can be retried');}
    // Save both final (branded) poster and raw (pure AI artwork) to concept row
    await pool.query(
      \`UPDATE document_visual_concepts
       SET asset_id = $1, image_url = $2, raw_asset_id = $3, raw_image_url = $4, prompt = $5, caption=COALESCE($7,caption), updated_at = NOW()
       WHERE id = $6\`,
      [finalAssetId, finalImageUrl, rawAssetId, rawImageUrl, promptToUse, opts.conceptId,generatedCaption||null]
    );

    return {
      conceptId: opts.conceptId,
      caption:generatedCaption,
      assetId: finalAssetId,
      imageUrl: finalImageUrl,
    };`;

const newGen = `    // Save both final (branded) poster and raw (pure AI artwork) to concept row without overwriting rich social caption
    await pool.query(
      \`UPDATE document_visual_concepts
       SET asset_id = $1, image_url = $2, raw_asset_id = $3, raw_image_url = $4, prompt = $5, updated_at = NOW()
       WHERE id = $6\`,
      [finalAssetId, finalImageUrl, rawAssetId, rawImageUrl, promptToUse, opts.conceptId]
    );

    const savedCaption = (await pool.query('SELECT caption FROM document_visual_concepts WHERE id = $1', [opts.conceptId])).rows[0]?.caption;

    return {
      conceptId: opts.conceptId,
      caption: savedCaption,
      assetId: finalAssetId,
      imageUrl: finalImageUrl,
    };`;

if (!code.includes(oldGen)) {
  console.error("Could not find oldGen in visual-concepts.service.ts");
  process.exit(1);
}
code = code.replace(oldGen, newGen);

// 2. In dispatchConcept, ensure rich structured caption is resolved and content row is always updated
const oldDispatchPrep = `    // Resolve high-converting structured caption with website, phone, highlights & hashtags
    let caption = (opts.caption && opts.caption.trim()) || (row.caption && row.caption.trim());
    if (!caption || caption.includes("In modern enterprise governance, foundational clarity")) {
      let contactInfo: any = {};
      try {
        const pagesRes = await pool.query(
          \`SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 25\`,
          [effectiveDocId, opts.workspaceId]
        );
        contactInfo = extractContactInfoFromText(pagesRes.rows.map((p) => p.clean_text || ""));
      } catch {}

      caption = buildRichCaption({
        title: row.concept_title,
        companyName: brand.companyName,
        websiteDomain: brand.websiteDomain || contactInfo.website,
        phoneNumber: contactInfo.phone,
        excerpt: row.source_excerpt,
        prompt: row.prompt,
      });
      pool.query("UPDATE document_visual_concepts SET caption = $1 WHERE id = $2", [caption, row.id]).catch(() => {});
    }`;

const newDispatchPrep = `    // Resolve high-converting structured caption with website, phone, highlights & hashtags
    let caption = (opts.caption && opts.caption.trim()) || (row.caption && row.caption.trim());
    const isRich = caption && caption.includes("#") && (caption.includes("–") || caption.includes("-") || caption.includes("⚡") || caption.includes("📊") || caption.includes("🛡️") || caption.includes("💎") || caption.includes("📈"));
    if (!caption || !isRich || caption.includes("In modern enterprise governance, foundational clarity")) {
      let contactInfo: any = {};
      try {
        const pagesRes = await pool.query(
          \`SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 25\`,
          [effectiveDocId, opts.workspaceId]
        );
        contactInfo = extractContactInfoFromText(pagesRes.rows.map((p) => p.clean_text || ""));
      } catch {}

      caption = buildRichCaption({
        title: row.concept_title,
        companyName: brand.companyName,
        websiteDomain: brand.websiteDomain || contactInfo.website,
        phoneNumber: contactInfo.phone,
        excerpt: row.source_excerpt,
        prompt: row.prompt,
      });
      pool.query("UPDATE document_visual_concepts SET caption = $1 WHERE id = $2", [caption, row.id]).catch(() => {});
    } else if (opts.caption && opts.caption.trim()) {
      pool.query("UPDATE document_visual_concepts SET caption = $1 WHERE id = $2", [opts.caption.trim(), row.id]).catch(() => {});
    }`;

if (!code.includes(oldDispatchPrep)) {
  console.error("Could not find oldDispatchPrep in visual-concepts.service.ts");
  process.exit(1);
}
code = code.replace(oldDispatchPrep, newDispatchPrep);

// 3. Update existing content record if content_id exists
const oldContentReturn = `if (concept.content_id && (await db.query("SELECT id FROM content WHERE id=$1 AND workspace_id=$2",[concept.content_id,opts.workspaceId])).rowCount) return concept.content_id;`;
const newContentReturn = `if (concept.content_id && (await db.query("SELECT id FROM content WHERE id=$1 AND workspace_id=$2",[concept.content_id,opts.workspaceId])).rowCount) {
        await db.query(
          \`UPDATE content 
           SET title = $1, body = $2, variants = $3, platforms = $4, image_asset_id = $5, updated_by = $6, updated_at = NOW() 
           WHERE id = $7 AND workspace_id = $8\`,
          [
            row.concept_title,
            caption,
            JSON.stringify(variants),
            JSON.stringify(channels.map(ch=>Object.keys(PLATFORM_CAPABILITIES).find(p=>p.toLowerCase()===ch.toLowerCase())||ch)),
            row.asset_id || null,
            opts.userId,
            concept.content_id,
            opts.workspaceId
          ]
        );
        return concept.content_id;
      }`;

if (!code.includes(oldContentReturn)) {
  console.error("Could not find oldContentReturn in visual-concepts.service.ts");
  process.exit(1);
}
code = code.replace(oldContentReturn, newContentReturn);

fs.writeFileSync(file, code);
console.log("Successfully patched visual-concepts.service.ts!");
