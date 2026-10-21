import { pool } from '../dist-api/db.js';

async function main() {
  const posts = (await pool.query(
    "SELECT id, title, variants FROM content WHERE variants->>'metadata' LIKE '%KNOWLEDGE_AUTOMATION%'"
  )).rows;

  for (const post of posts) {
    let cleanTitle = post.title;
    if (cleanTitle && cleanTitle.startsWith('{')) {
      try {
        const parsed = JSON.parse(cleanTitle);
        cleanTitle = String(parsed.knowledge || 'Social Media Update').replace(/^"|"$/g, '').trim();
      } catch {}
    }
    const variants = post.variants || {};
    for (const p of ['Facebook', 'Instagram', 'LinkedIn', 'Telegram']) {
      if (variants[p]?.caption && variants[p].caption.startsWith('{')) {
        try {
          const parsed = JSON.parse(variants[p].caption.split('\n')[0]);
          const excerpt = parsed.evidence?.[0]?.excerpt || parsed.knowledge || '';
          const tag = '#hindustansoftwaresolution';
          variants[p].caption = `${cleanTitle}\n\n${excerpt}\n\n${tag}`;
        } catch {}
      }
    }
    await pool.query(
      "UPDATE content SET title = $1, variants = $2 WHERE id = $3",
      [cleanTitle, JSON.stringify(variants), post.id]
    );
    console.log('Cleaned up post ID:', post.id, 'New title:', cleanTitle);
  }

  await pool.query(
    "UPDATE content SET title = 'Redhash: Creative Visual Storytelling & Social Reach' WHERE title LIKE '{\"%instruction%'"
  );
  console.log('All truncated titles cleaned up.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
