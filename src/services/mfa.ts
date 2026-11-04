import { supabase } from '@/lib/supabase';

/** Verificação em duas etapas (app autenticador: Google Authenticator, Authy, Microsoft…). */
export async function mfaStatus(): Promise<{ required: boolean; enabled: boolean }> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return { required: false, enabled: false };
    return { required: data.nextLevel === 'aal2' && data.currentLevel !== 'aal2', enabled: data.nextLevel === 'aal2' };
  } catch {
    return { required: false, enabled: false };
  }
}

export async function listTotp() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp;
}

export async function enrollTotp() {
  // remove tentativas antigas não confirmadas (o Supabase limita a quantidade)
  const { data: all } = await supabase.auth.mfa.listFactors();
  for (const f of all?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Autenticador ${new Date().toLocaleDateString('pt-BR')}` });
  if (error) throw error;
  return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyTotp(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\D/g, '') });
  if (error) throw error;
}

export async function removeTotp(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  await supabase.auth.refreshSession();
}
