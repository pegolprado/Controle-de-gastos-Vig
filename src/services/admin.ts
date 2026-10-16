import { supabase } from '@/lib/supabase';
import type { AppSettings, UserStatus } from '@/lib/types';
import { unwrap, unwrapList } from './base';

export interface AdminUser {
  id: string; email: string; full_name: string | null; status: UserStatus; status_reason: string | null;
  created_at: string; last_sign_in_at: string | null; is_app_owner: boolean; workspaces: number;
}

export async function adminListUsers(search: string, offset = 0): Promise<AdminUser[]> {
  return unwrapList(await supabase.rpc('admin_list_users', { p_search: search || null, p_limit: 50, p_offset: offset }));
}
export async function adminSetUserStatus(user: string, status: UserStatus, reason: string | null) {
  unwrap(await supabase.rpc('admin_set_user_status', { p_user: user, p_status: status, p_reason: reason }));
}
export async function adminUpdateSettings(patch: Partial<AppSettings>) {
  return unwrap(await supabase.rpc('admin_update_settings', { p_patch: patch })) as AppSettings;
}
export async function adminStats() {
  return unwrap(await supabase.rpc('admin_stats')) as Record<string, number>;
}
export async function adminAudit() {
  return unwrapList<{ id: number; actor_email: string | null; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: string }>(
    await supabase.rpc('admin_list_audit', { p_limit: 150 }),
  );
}
export async function adminErrors() {
  return unwrapList<{ id: number; user_email: string | null; app_version: string | null; route: string | null; message: string; created_at: string }>(
    await supabase.rpc('admin_list_errors', { p_limit: 150 }),
  );
}
export async function adminRegisterRelease(version: string, notes: string | null, commit: string | null) {
  return unwrap(await supabase.rpc('admin_register_release', { p_version: version, p_notes: notes, p_commit: commit, p_channel: 'production' }));
}
export async function adminSetReleaseStatus(id: string, status: 'published' | 'rolled_back') {
  unwrap(await supabase.rpc('admin_set_release_status', { p_release: id, p_status: status }));
}
export async function adminListReleases() {
  return unwrapList<{ id: string; version: string; channel: string; commit_sha: string | null; notes: string | null; status: string; published_at: string }>(
    await supabase.from('app_releases').select('*').order('published_at', { ascending: false }).limit(30),
  );
}
