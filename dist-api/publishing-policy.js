import { ConflictException } from '@nestjs/common';
export async function requiresPublicationApproval(db, wid, contentId) {
    const result = await db.query('SELECT publication_requires_approval($1,$2) AS required', [wid, contentId]);
    return result.rows[0].required;
}
export async function assertPublicationApproved(db, wid, content) {
    if (content.status === 'NEEDS_REVIEW')
        throw new ConflictException('This content is awaiting approval.');
    if (!content.approved_by && await requiresPublicationApproval(db, wid, content.id))
        throw new ConflictException('This content must be approved before publishing.');
}
