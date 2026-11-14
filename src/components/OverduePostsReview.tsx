import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, ModalFrame } from './ui';
import { request } from '../lib/api';
import { dateLabel } from '../lib/model';

type OverduePost = { id: string; title: string; execute_at: string; platform: string; account_name: string; reconnect_required: boolean; source?: 'post' | 'concept' };
type Action = 'publish' | 'reschedule' | 'discard';

export function OverduePostsReview({ workspaceId, timezone, canSchedule, demo }: {
  workspaceId: string; timezone: string; canSchedule: boolean; demo: boolean;
}) {
  const query = useQueryClient();
  const [selection, setSelection] = useState<{ post: OverduePost; action: Action } | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const overdue = useQuery({ queryKey: ['overdue-posts', workspaceId],
    queryFn: () => request<{ posts: OverduePost[]; graceMinutes: number }>('/calendar/overdue'),
    enabled: !demo, refetchInterval: 30000 });

  async function confirm() {
    if (!selection) return;
    setBusy(true);
    try {
      if (selection.action === 'reschedule' && (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now()))
        throw new Error('Choose a future date and time.');
      await request(`/calendar/overdue/${selection.post.id}/resolve`, 'POST', {
        action: selection.action, source: selection.post.source || 'post', confirm: true,
        ...(selection.action === 'reschedule' ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      });
      setSelection(null);
      toast.success(selection.action === 'discard' ? 'Schedule discarded. Content kept.' : selection.action === 'publish' ? 'Post queued for publishing.' : 'Post rescheduled.');
      await Promise.all([query.invalidateQueries({ queryKey: ['overdue-posts', workspaceId] }), query.invalidateQueries({ queryKey: ['workspace'] })]);
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  }

  if (demo) return null;
  if (overdue.isError) return <div role="alert">Could not load missed schedules. <Button variant="secondary" onClick={() => overdue.refetch()}>Retry</Button></div>;
  if (!overdue.data?.posts.length) return null;
  return <section aria-label="Missed schedules" style={{ border: '1px solid #d99b25', borderRadius: 12, padding: 20, marginBottom: 24 }}>
    <h2>Missed schedules — review required ({overdue.data.posts.length})</h2>
    <p>Posts more than {overdue.data.graceMinutes} minutes late are held automatically. Review each schedule before publishing.</p>
    {overdue.data.posts.map(post => <div key={post.id} style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
      <strong>{post.title || 'Untitled post'}</strong>
      <p>{post.platform} · {post.account_name} · Missed {dateLabel(post.execute_at, timezone)}</p>
      {post.reconnect_required && <p role="alert">Reconnect required. <Link to="/app/channels">Open Channels</Link>. Reconnecting will keep this post on hold.</p>}
      {canSchedule && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button disabled={busy || post.reconnect_required} onClick={() => setSelection({ post, action: 'publish' })}>Publish now</Button>
        <Button variant="secondary" disabled={busy || post.reconnect_required} onClick={() => { setScheduledAt(''); setSelection({ post, action: 'reschedule' }); }}>Reschedule</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setSelection({ post, action: 'discard' })}>Discard schedule</Button>
      </div>}
    </div>)}
    <ModalFrame open={!!selection} onClose={() => { if (!busy) setSelection(null); }} title={selection?.action === 'discard' ? 'Discard this schedule?' : selection?.action === 'reschedule' ? 'Reschedule missed post' : 'Publish this post now?'}>
      <h3>{selection?.action === 'discard' ? 'Discard this schedule?' : selection?.action === 'reschedule' ? 'Reschedule missed post' : 'Publish this post now?'}</h3>
      <p>{selection?.post.title} · {selection?.post.platform} · {selection?.post.account_name}</p>
      <p>{selection?.post.source === 'concept' ? 'This applies to all target channels for this visual concept. Discarding keeps the concept and removes its schedule.' : selection?.action === 'discard' ? 'Only this account’s scheduled publication will be cancelled. Your content is kept.' : 'This applies to this account only. Approval, account health and posting limits still apply.'}</p>
      {selection?.action === 'reschedule' && <label>New time (your device timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone})<input aria-label="New posting time" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} /></label>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" disabled={busy} onClick={() => setSelection(null)}>Cancel</Button>
        <Button disabled={busy || (selection?.action === 'reschedule' && !scheduledAt)} onClick={confirm}>{busy ? 'Saving…' : 'Confirm'}</Button>
      </div>
    </ModalFrame>
  </section>;
}
