import { env } from './env';
import { supabase } from './supabase';

/** Mensagem amigável a partir de erros do Supabase/PostgREST/rede. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Erro desconhecido.';
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Sem conexão com a internet. Nada foi salvo — tente novamente quando a conexão voltar.';
  }
  const e = err as { message?: string; code?: string; status?: number; name?: string };
  const msg = e.message ?? String(err);
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ERR_INTERNET|Network request failed/i.test(msg)) {
    return 'Não foi possível falar com o servidor. Verifique a conexão; nada foi salvo.';
  }
  if (e.code === '42501' || /row-level security/i.test(msg)) return 'Você não tem permissão para esta ação.';
  if (e.code === 'P0429') return msg;
  if (e.code === '23505') return 'Este registro já existe.';
  if (e.code === '23503') return 'Este item está em uso por outros registros e não pode ser removido. Considere arquivá-lo.';
  if (e.code === '23514') return 'Algum valor informado é inválido.';
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar (verifique a caixa de entrada).';
  if (/User already registered/i.test(msg)) return 'Já existe uma conta com este e-mail.';
  if (/Password should be/i.test(msg)) return 'A senha não atende aos requisitos mínimos.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (/JWT|session/i.test(msg) && e.status === 401) return 'Sua sessão expirou. Entre novamente.';
  return msg.length > 220 ? 'Ocorreu um erro inesperado. Tente novamente.' : msg;
}

let reported = 0;
/** Reporta erros técnicos (sem dados financeiros, sem tokens) ao painel do proprietário. */
export function reportError(err: unknown, route?: string) {
  if (reported > 10) return;
  reported++;
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  // remove possíveis tokens/e-mails/valores antes de enviar
  const message = raw
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\d{3,}/g, '#')
    .slice(0, 480);
  void supabase.rpc('log_client_error', { p_message: message, p_route: route ?? location.pathname, p_version: env.version });
}
