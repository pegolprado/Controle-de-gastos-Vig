import { supabase } from '@/lib/supabase';
import type { Invite, Member, WorkspaceRole } from '@/lib/types';
import { unwrap, unwrapList } from './base';
import { appUrl } from '@/lib/appUrl';

export async function createWorkspace(name: string): Promise<string> {
  return unwrap(await supabase.rpc('create_workspace', { p_name: name })) as string;
}
export async function renameWorkspace(id: string, name: string) {
  unwrap(await supabase.rpc('rename_workspace', { p_workspace: id, p_name: name }));
}
export async function deleteWorkspace(id: string) {
  unwrap(await supabase.rpc('delete_workspace', { p_workspace: id }));
}
export async function listMembers(ws: string): Promise<Member[]> {
  return unwrapList(await supabase.rpc('list_workspace_members', { p_workspace: ws }));
}
export async function setMemberRole(ws: string, user: string, role: WorkspaceRole) {
  unwrap(await supabase.rpc('set_member_role', { p_workspace: ws, p_user: user, p_role: role }));
}
export async function removeMember(ws: string, user: string) {
  unwrap(await supabase.rpc('remove_member', { p_workspace: ws, p_user: user }));
}
export async function listInvites(ws: string | null): Promise<Invite[]> {
  let q = supabase.from('invites').select('id, workspace_id, email, role, created_at, expires_at, accepted_at, revoked_at');
  q = ws ? q.eq('workspace_id', ws) : q.is('workspace_id', null);
  return unwrapList(await q.order('created_at', { ascending: false }).limit(100));
}
export async function createInvite(ws: string | null, email: string | null, role: WorkspaceRole, days: number): Promise<{ id: string; token: string }> {
  return unwrap(await supabase.rpc('create_invite', { p_workspace: ws, p_email: email, p_role: role, p_days: days })) as { id: string; token: string };
}
export async function revokeInvite(id: string) {
  unwrap(await supabase.rpc('revoke_invite', { p_invite: id }));
}
export async function peekInvite(token: string) {
  return unwrap(await supabase.rpc('peek_invite', { p_token: token })) as {
    valid: boolean; reason?: string; workspace_name?: string | null; role?: WorkspaceRole; email_hint?: string | null; expires_at?: string;
  };
}
export async function acceptInvite(token: string): Promise<{ workspace_id: string | null }> {
  return unwrap(await supabase.rpc('accept_invite', { p_token: token })) as { workspace_id: string | null };
}
export async function grantSupport(ws: string, hours: number) {
  unwrap(await supabase.rpc('grant_support_access', { p_workspace: ws, p_hours: hours }));
}
export async function revokeSupport(ws: string) {
  unwrap(await supabase.rpc('revoke_support_access', { p_workspace: ws }));
}
export function inviteLink(token: string) {
  return appUrl(`/convite/${token}`);
}
