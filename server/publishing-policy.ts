import { ConflictException } from '@nestjs/common';
import type { DB } from './db.js';

export async function requiresPublicationApproval(db: DB, wid: string, contentId: string) {
  const result = await db.query('SELECT publication_requires_approval($1,$2) AS required', [wid, contentId]);
  return result.rows[0].required as boolean;
}

export async function assertPublicationApproved(db: DB, wid: string, content: any) {
  if (content.status === 'NEEDS_REVIEW') throw new ConflictException('This content is awaiting approval.');
  if (!content.approved_by && await requiresPublicationApproval(db, wid, content.id))
    throw new ConflictException('This content must be approved before publishing.');
}
