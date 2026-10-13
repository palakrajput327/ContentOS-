import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction,type DB} from './db.js';
import type {Request} from 'express';
import {hash} from './security.js';
const idSchema=z.string().uuid();
export const adminUserEditSchema=z.object({name:z.string().trim().min(1).max(100),status:z.enum(['ACTIVE','SUSPENDED']),note:z.string().trim().max(500),version:z.number().int().positive()}).strict();
export const adminUserDeleteSchema=z.object({confirmation:z.string().email(),version:z.number().int().positive()}).strict();
export async function adminUserImpact(id:string,db:DB=pool){
 idSchema.parse(id);
 const user=(await db.query('SELECT id,name,email,account_status,admin_note,admin_version,deleted_at FROM users WHERE id=$1',[id])).rows[0];
 if(!user)throw new NotFoundException('User not found.');
 const stats=(await db.query("SELECT (SELECT COUNT(*)::int FROM content WHERE created_by=$1) AS posts,(SELECT COUNT(*)::int FROM workspace_members WHERE user_id=$1) AS memberships",[id])).rows[0];
 return {user,...stats,canDelete:user.account_status!=='DELETED',policy:'The platform administrator can delete this account. Sign-in access will be removed. Workspaces, posts and audit history remain under platform administration.'};
}
async function revoke(db:DB,id:string){
 await db.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1',[id]);
 await db.query('UPDATE auth_tokens SET used_at=COALESCE(used_at,now()) WHERE user_id=$1',[id]);
 // Some deployments retain the older authentication table.
 if((await db.query("SELECT to_regclass('sessions') AS present")).rows[0].present)await db.query('DELETE FROM sessions WHERE user_id=$1',[id]);
}
export async function mutateAdminUser(id:string,input:unknown,req:Request,remove=false){
 idSchema.parse(id);const body=remove?adminUserDeleteSchema.parse(input):adminUserEditSchema.parse(input);
 return transaction(async db=>{
  const actor=(await db.query('SELECT username FROM system_admin_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[hash(req.cookies.contentos_admin_session)])).rows[0];
  if(!actor)throw new ConflictException('Admin session expired. Sign in again.');
  const user=(await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!user)throw new NotFoundException('User not found.');
  if(user.admin_version!==body.version)throw new ConflictException('This account changed. Refresh and try again.');
  if(user.account_status==='DELETED')throw new ConflictException('Deleted accounts cannot be edited.');
  // Status changes share the ownership lock with deletion checks.
  await db.query("SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 AND m.role='Owner' ORDER BY w.id FOR UPDATE OF w",[id]);
  if(remove){
   if((body as z.infer<typeof adminUserDeleteSchema>).confirmation!==user.email)throw new BadRequestException('Enter the exact account email to confirm deletion.');
   // Super Admin may remove the last Owner; workspace records remain intact.
   await db.query("UPDATE users SET account_status='DELETED',deleted_at=now(),updated_at=now(),admin_version=admin_version+1 WHERE id=$1",[id]);
  }else{
   const edit=body as z.infer<typeof adminUserEditSchema>;
   await db.query('UPDATE users SET name=$2,account_status=$3,admin_note=$4,updated_at=now(),admin_version=admin_version+1 WHERE id=$1',[id,edit.name,edit.status,edit.note]);
  }
  const next=(await db.query('SELECT name,account_status,admin_note,admin_version FROM users WHERE id=$1',[id])).rows[0];
  if(remove||next.account_status!=='ACTIVE')await revoke(db,id);
  await db.query('INSERT INTO system_admin_events(id,username,action,target_user_id,details,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),actor.username,remove?'USER_DELETED':'USER_UPDATED',id,JSON.stringify({previous:{name:user.name,status:user.account_status,note:user.admin_note},next}),req.ip,(req.get('user-agent')||'').slice(0,512)]);
  return {success:true,message:remove?'Account deleted. Content and audit history retained.':'User updated.',user:{id,...next}};
 });
}
