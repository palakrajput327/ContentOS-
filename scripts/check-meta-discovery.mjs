// Read-only investigation. Never print Graph payloads, tokens or database errors.
import { pool } from '../dist-api/db.js';
import { decryptToken } from '../dist-api/security.js';
import { metaPermissions, metaPages, metaTokenDetails, MetaGraphError } from '../dist-api/meta.api.js';
try {
  const pending = await pool.query('SELECT workspace_id,ciphertext FROM meta_oauth_pending WHERE expires_at > NOW() ORDER BY expires_at DESC LIMIT 1');
  if (!pending.rowCount) {
    console.log(JSON.stringify({liveInvestigation:'unavailable',reason:'No unexpired pending Facebook USER token is stored. A failed callback discards its token; reconnect is required to inspect the actual grant.'}));
  } else {
    const row = pending.rows[0];
    const token = decryptToken(row.ciphertext,row.workspace_id);
    const debug = await metaTokenDetails(token);
    await metaPermissions(token);
    const pages = await metaPages(token);
    console.log(JSON.stringify({validUserToken:true,appMatches:true,allScopesGranted:true,selectedPageGrantCount:(debug.granular_scopes||[]).filter(s=>s.scope==='pages_show_list').reduce((n,s)=>n+(s.target_ids||[]).length,0),pageCount:pages.length,pages:pages.map(p=>({id:p.id,hasPageToken:Boolean(p.access_token),tasks:p.tasks||null,linkedInstagramId:p.instagram_business_account?.id||null}))}));
  }
} catch (e) {
  console.log(JSON.stringify({liveInvestigation:'failed',graphCode:e instanceof MetaGraphError?e.code:null,graphSubcode:e instanceof MetaGraphError?e.subcode:null,errorType:e.name}));
  process.exitCode=1;
} finally {await pool.end();}
