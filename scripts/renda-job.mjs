#!/usr/bin/env node
/**
 * Rotina diária da Renda (GitHub Actions):
 *  1. atualiza proventos e cotações de todos os ativos das carteiras (B3, pelo banco);
 *  2. roda o piloto automático de todos os espaços (lança anunciados, recebe os do dia);
 *  3. envia os avisos no celular do dia (Web Push).
 * Usa a chave de serviço do Supabase (segredo do GitHub). As chaves VAPID dos avisos
 * são geradas na primeira execução e guardadas no próprio banco.
 */
import webpush from 'web-push';

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const subject = process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : 'mailto:avisos@financemv.app';
const sendPush = process.env.SEND_PUSH !== '0';

if (!url || !key) {
  console.log('::notice::Rotina da Renda desligada: cadastre o segredo SUPABASE_SERVICE_ROLE_KEY no GitHub (veja docs/OPERACAO.md).');
  process.exit(0);
}

const headers = { apikey: key, 'Content-Type': 'application/json' };
// chaves antigas (JWT) também precisam do Authorization; as novas (sb_secret_) só do apikey
if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

async function rpc(name, body = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) dados de mercado
const assets = await rpc('renda_all_assets');
let ok = 0;
for (const a of assets) {
  try {
    const r = await rpc('renda_job_sync', { p_ticker: a.ticker, p_type: a.asset_type });
    if (r !== 'unavailable') ok++;
  } catch (e) {
    console.log(`::warning::${a.ticker}: ${e.message}`);
  }
  await sleep(300); // gentil com a B3
}
console.log(`Ativos atualizados: ${ok}/${assets.length}`);

// 2) piloto automático
const launched = await rpc('renda_autopilot_all');
console.log(`Piloto automático: ${launched} lançamentos/recebimentos`);

// 3) avisos no celular
if (sendPush) {
  let [keys] = await rpc('push_get_keys');
  if (!keys) {
    const v = webpush.generateVAPIDKeys();
    await rpc('push_set_keys', { p_public: v.publicKey, p_private: v.privateKey });
    [keys] = await rpc('push_get_keys');
    console.log('Chaves dos avisos criadas.');
  }
  webpush.setVapidDetails(subject, keys.public_key, keys.private_key);
  const msgs = await rpc('push_digest');
  let sent = 0;
  for (const m of msgs) {
    try {
      await webpush.sendNotification(
        { endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } },
        JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }),
        { TTL: 6 * 3600, urgency: 'normal' },
      );
      sent++;
      await rpc('push_report', { p_endpoint: m.endpoint, p_ok: true, p_gone: false });
    } catch (e) {
      const gone = e.statusCode === 404 || e.statusCode === 410;
      await rpc('push_report', { p_endpoint: m.endpoint, p_ok: false, p_gone: gone }).catch(() => {});
      console.log(`::warning::aviso não entregue (${e.statusCode ?? e.message})${gone ? ' — inscrição removida' : ''}`);
    }
  }
  console.log(`Avisos enviados: ${sent}/${msgs.length}`);
}
