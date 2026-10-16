// Supabase Edge Function (Deno): exclusão definitiva da conta do próprio usuário (LGPD).
// Publicação: supabase functions deploy delete-account
// A service_role existe SOMENTE aqui, no servidor (variável injetada pelo Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // 1) Identifica o usuário pelo JWT dele (nunca por parâmetro do corpo)
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await asUser.auth.getUser();
  if (userErr || !user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: { ...cors, 'content-type': 'application/json' } });

  // 2) Remove dados financeiros com as regras do banco (RLS + checagens)
  const { error: dataErr } = await asUser.rpc('delete_my_data');
  if (dataErr) return new Response(JSON.stringify({ error: dataErr.message }), { status: 400, headers: { ...cors, 'content-type': 'application/json' } });

  // 3) Remove o login (requer service_role, apenas no servidor)
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return new Response(JSON.stringify({ error: 'Falha ao remover o login' }), { status: 500, headers: { ...cors, 'content-type': 'application/json' } });

  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'content-type': 'application/json' } });
});
