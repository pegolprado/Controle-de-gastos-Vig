import type { PostgrestError } from '@supabase/supabase-js';

/** Lança o erro do Supabase (para o React Query tratar) ou devolve os dados. */
export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

export function unwrapList<T>(res: { data: T[] | null; error: PostgrestError | null }): T[] {
  if (res.error) throw res.error;
  return res.data ?? [];
}
