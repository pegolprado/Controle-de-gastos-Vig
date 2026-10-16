import { supabase } from '@/lib/supabase';
import type { Category, CategoryKind } from '@/lib/types';
import { unwrap, unwrapList } from './base';

export async function listCategories(ws: string): Promise<Category[]> {
  return unwrapList(await supabase.from('categories').select('*').eq('workspace_id', ws).order('name'));
}

export interface CategoryInput {
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  color: string;
  icon: string;
  is_fixed: boolean;
}

export async function createCategory(ws: string, input: CategoryInput) {
  return unwrap(await supabase.from('categories').insert({ ...input, workspace_id: ws }).select().single());
}

export async function updateCategory(id: string, patch: Partial<CategoryInput> & { archived?: boolean }) {
  return unwrap(await supabase.from('categories').update(patch).eq('id', id).select().single());
}

export async function deleteCategory(id: string) {
  unwrap(await supabase.from('categories').delete().eq('id', id));
}
