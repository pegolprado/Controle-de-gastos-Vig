import { supabase } from '@/lib/supabase';
import type { Notification } from '@/lib/types';
import { unwrap, unwrapList } from './base';

export async function refreshNotifications(ws: string): Promise<number> {
  return unwrap(await supabase.rpc('refresh_notifications', { p_workspace: ws })) as number;
}
export async function listNotifications(): Promise<Notification[]> {
  return unwrapList(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50));
}
export async function markAllRead() {
  unwrap(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null));
}
export async function markRead(id: string) {
  unwrap(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id));
}
