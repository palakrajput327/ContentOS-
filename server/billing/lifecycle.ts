import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db.js';

/** Calendar anniversaries, clamped to the last day (Jan 31 -> Feb 28/29). */
export function billingPeriodEnd(start: Date, period: string): Date {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (period === 'YEARLY' ? 12 : 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
  end.setUTCDate(Math.min(day,last));
  return end;
}

export async function provisionWorkspaceBilling(db: DB, workspaceId: string, userId: string) {
  // Serialize per user: concurrent new workspaces cannot each receive a fresh trial.
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
  const first = (await db.query(`SELECT wt.started_at,wt.ends_at FROM workspace_trials wt
    JOIN workspace_members m ON m.workspace_id=wt.workspace_id WHERE m.user_id=$1 AND m.role='Owner'
    ORDER BY wt.started_at,wt.created_at,wt.id LIMIT 1`,[userId])).rows[0];
  const start = first ? new Date(first.started_at) : new Date();
  const end = first ? new Date(first.ends_at) : new Date(start.getTime()+120*3600000);
  await db.query(`INSERT INTO workspace_trials(id,workspace_id,started_at,ends_at,status,daily_post_limit)
    VALUES($1,$2,$3,$4,$5,3) ON CONFLICT(workspace_id) DO NOTHING`,[randomUUID(),workspaceId,start,end,end>new Date()?'ACTIVE':'EXPIRED']);
  await db.query(`INSERT INTO workspace_subscriptions(id,workspace_id,plan_id,status,start_at,current_period_end,custom_limit_source)
    VALUES($1,$2,(SELECT id FROM subscription_plans WHERE code='STARTER'),'TRIALING',$3,$4,'PLAN')
    ON CONFLICT(workspace_id) DO NOTHING`,[randomUUID(),workspaceId,start,end]);
}

export async function extendSubscription(db: DB, sub: any, days: number, reason: string) {
  if (!['ACTIVE','ADMIN_GRANTED','TRIALING','EXPIRED'].includes(sub.status))
    throw new BadRequestException('Activate the subscription before extending it.');
  const trial = (await db.query('SELECT * FROM workspace_trials WHERE workspace_id=$1 FOR UPDATE',[sub.workspace_id])).rows[0];
  const isTrial = sub.status==='TRIALING' || (sub.status==='EXPIRED' && trial &&
    !sub.admin_override_note && new Date(sub.start_at).getTime() <= new Date(trial.ends_at).getTime());
  const current = isTrial ? trial?.ends_at || sub.current_period_end : sub.current_period_end;
  const end = new Date(Math.max(Date.now(),current?new Date(current).getTime():0)+days*86400000);
  await db.query(`UPDATE workspace_subscriptions SET current_period_end=$2,status=$3,admin_override_note=$4,updated_at=now() WHERE id=$1`,
    [sub.id,end,isTrial?'TRIALING':sub.status==='EXPIRED'?'ACTIVE':sub.status,reason]);
  if(isTrial) await db.query(`UPDATE workspace_trials SET ends_at=$2,status='EXTENDED',extension_count=extension_count+1,extension_reason=$3,updated_at=now() WHERE workspace_id=$1`,[sub.workspace_id,end,reason]);
  await db.query(`INSERT INTO subscription_events(id,workspace_id,subscription_id,event_type,details) VALUES($1,$2,$3,'ADMIN_PERIOD_EXTENDED',$4)`,
    [randomUUID(),sub.workspace_id,sub.id,JSON.stringify({days,reason,isTrial,end})]);
  return end;
}
