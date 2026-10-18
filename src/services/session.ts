import { supabase } from '@/lib/supabase';
import type { AppSettings, SessionContext } from '@/lib/types';
import { unwrap } from './base';

export async function fetchSessionContext(): Promise<SessionContext> {
  return unwrap(await supabase.rpc('session_context')) as SessionContext;
}

export async function fetchAppSettings(): Promise<AppSettings> {
  return unwrap(await supabase.from('app_settings').select('*').eq('id', 1).single()) as AppSettings;
}

export async function updatePreferences(userId: string, patch: Record<string, unknown>) {
  return unwrap(await supabase.from('user_preferences').update(patch).eq('user_id', userId).select().single());
}

export async function updateProfile(userId: string, patch: { full_name?: string | null }) {
  return unwrap(await supabase.from('profiles').update(patch).eq('id', userId).select().single());
}

export async function fetchLatestRelease() {
  const res = await supabase
    .from('app_releases')
    .select('version, notes, published_at, status, commit_sha')
    .eq('channel', 'production')
    .order('published_at', { ascending: false })
    .limit(10);
  return res.data ?? [];
}

/** Registra que a pessoa está usando o app (o servidor grava no máximo a cada 5 min). */
export async function touchLastSeen() {
  await supabase.rpc('touch_last_seen');
}
