// Read-only inventory. These are candidates for a later guarded cleanup, never automatic deletions.
export async function sourceRetentionCandidates(db, workspaceId, now = new Date()) {
    const result = await db.query(`SELECT m.id,m.bucket,m.object_key,m.size_bytes,m.storage_provider,m.source_last_referenced_at
    FROM media_assets m WHERE m.workspace_id=$1 AND m.metadata->>'origin'='PDF_SOURCE' AND m.storage_purged_at IS NULL
    AND m.source_last_referenced_at < $2::timestamptz-interval '30 days'
    AND NOT EXISTS(SELECT 1 FROM document_source_media s WHERE s.media_asset_id=m.id AND s.workspace_id=m.workspace_id)
    AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.media_asset_id=m.id AND d.workspace_id=m.workspace_id)
    AND NOT EXISTS(SELECT 1 FROM content c WHERE c.workspace_id=m.workspace_id AND c.variants::text LIKE '%'||m.id::text||'%')
    AND NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.workspace_id=m.workspace_id AND v.snapshot::text LIKE '%'||m.id::text||'%')
    AND NOT EXISTS(SELECT 1 FROM document_knowledge k WHERE k.workspace_id=m.workspace_id AND k.metadata::text LIKE '%'||m.id::text||'%')
    AND NOT EXISTS(SELECT 1 FROM media_assets derived WHERE derived.workspace_id=m.workspace_id AND derived.id<>m.id AND derived.storage_purged_at IS NULL AND derived.metadata::text LIKE '%'||m.id::text||'%')
    ORDER BY m.source_last_referenced_at LIMIT 1000`, [workspaceId, now]);
    return {
        mode: "dry-run",
        assets: result.rows,
        reclaimableBytes: result.rows.reduce((total, row) => total + Number(row.size_bytes), 0),
    };
}
