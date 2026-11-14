import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { audit, transaction } from './db.js';
import { publishingQueue } from './queues.js';
import { assertDailySlot } from './calendar/daily-posting.js';

export const OVERDUE_GRACE_MS = 15 * 60 * 1000;
export const OVERDUE_REVIEW = 'OVERDUE_REVIEW_REQUIRED';
export function needsOverdueReview(job: { state: string; execute_at: string | Date; error_code?: string }, now = new Date()) {
  return ['PENDING', 'ENQUEUED'].includes(job.state) &&
    (job.error_code === OVERDUE_REVIEW || now.getTime() - new Date(job.execute_at).getTime() > OVERDUE_GRACE_MS);
}

export async function resolveOverduePost(workspaceId: string, actorId: string, id: string,
  input: { action: 'publish' | 'reschedule' | 'discard'; scheduledAt?: string; confirm: boolean }) {
  if (input.confirm !== true) throw new BadRequestException('Confirm this overdue post action.');
  return transaction(async db => {
    // Match the worker lock order: content first, then its publishing record.
    const raw = (await db.query('SELECT content_id FROM scheduled_posts WHERE id=$1 AND workspace_id=$2', [id, workspaceId])).rows[0];
    if (!raw) throw new NotFoundException('Scheduled post not found.');
    const content = (await db.query('SELECT * FROM content WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [raw.content_id, workspaceId])).rows[0];
    const job = (await db.query('SELECT * FROM scheduled_posts WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [id, workspaceId])).rows[0];
    if (!content || !job) throw new NotFoundException('Scheduled post not found.');
    if (!needsOverdueReview(job) || job.content_version !== content.version)
      throw new ConflictException('This schedule has changed or already started. Refresh before reviewing.');
    if (input.action === 'discard') {
      await db.query("UPDATE scheduled_posts SET state='CANCELLED',error_code=NULL WHERE id=$1", [id]);
      const remaining = (await db.query("SELECT state,processing_status FROM scheduled_posts WHERE content_id=$1 AND workspace_id=$2 AND content_version=$3 AND state<>'CANCELLED'", [content.id, workspaceId, content.version])).rows;
      if (!remaining.length) await db.query("UPDATE content SET status='DRAFT',scheduled_at=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$2", [content.id, workspaceId]);
      else if (remaining.every(row => row.state === 'PUBLISHED' && row.processing_status !== 'processing'))
        await db.query("UPDATE content SET status='PUBLISHED',updated_at=now() WHERE id=$1 AND workspace_id=$2", [content.id, workspaceId]);
    } else {
      const at = input.action === 'publish' ? new Date() : new Date(input.scheduledAt || '');
      if (!Number.isFinite(at.getTime()) || (input.action === 'reschedule' && at.getTime() <= Date.now()))
        throw new BadRequestException('Choose a future date and time.');
      const account = (await db.query(`SELECT a.platform FROM social_accounts a JOIN social_account_tokens t ON t.account_id=a.id
        WHERE a.id=$1 AND a.workspace_id=$2 AND lower(a.state)='connected'
        AND t.ciphertext IS NOT NULL AND (t.expires_at IS NULL OR t.expires_at>now() OR (lower(a.platform)='youtube' AND t.refresh_ciphertext IS NOT NULL))`, [job.account_id, workspaceId])).rows[0];
      if (!account) throw new BadRequestException('Reconnect this account in Channels before publishing or rescheduling.');
      await assertDailySlot(db, workspaceId, { ...content, platforms: [account.platform] }, at);
      await db.query("UPDATE scheduled_posts SET state='PENDING',execute_at=$2,error_code=NULL WHERE id=$1", [id, at]);
      await publishingQueue.add('publish', { id, workspaceId }, {
        jobId: `${id}-review-${randomUUID()}`, delay: Math.max(0, at.getTime() - Date.now()),
      }, db);
      await db.query('UPDATE content SET scheduled_at=(SELECT min(execute_at) FROM scheduled_posts WHERE content_id=$1 AND workspace_id=$2 AND content_version=$3 AND state IN (\'PENDING\',\'ENQUEUED\')),updated_at=now() WHERE id=$1 AND workspace_id=$2', [content.id, workspaceId, content.version]);
    }
    await audit(db, workspaceId, actorId, `overdue post ${input.action}`, 'content', content.id, content.title, { scheduledPostId: id, executeAt: job.execute_at }, input);
    return { id, action: input.action };
  });
}
