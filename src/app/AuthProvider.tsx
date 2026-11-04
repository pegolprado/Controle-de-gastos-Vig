import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isConfigured } from '@/lib/env';
import { queryClient } from '@/lib/queryClient';
import { mfaStatus } from '@/services/mfa';

interface AuthState {
  session: Session | null;
  loading: boolean;
  recovery: boolean;
  /** entrou com a senha, mas ativou o 2FA: falta o código do app autenticador */
  mfaRequired: boolean;
  /** reavalia o nível da sessão (depois de digitar o código ou mudar o 2FA) */
  refreshMfa: () => Promise<void>;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isConfigured);
  const [recovery, setRecovery] = useState(false);
  const [mfa, setMfa] = useState<{ token: string | null; required: boolean }>({ token: null, required: false });
  const token = session?.access_token ?? null;
  const refreshMfa = useCallback(async () => {
    const st = await mfaStatus();
    const { data } = await supabase.auth.getSession();
    setMfa({ token: data.session?.access_token ?? null, required: st.required });
  }, []);
  useEffect(() => {
    if (!token) {
      setMfa({ token: null, required: false });
      return;
    }
    let active = true;
    void mfaStatus().then((st) => active && setMfa({ token, required: st.required }));
    return () => {
      active = false;
    };
  }, [token]);
  // até saber o nível da sessão (só na primeira vez; a renovação do token não pisca a tela)
  const mfaPending = Boolean(token) && mfa.token === null;

  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        setRecovery(false);
        queryClient.clear();
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading: loading || mfaPending,
      recovery,
      mfaRequired: Boolean(token) && mfa.required,
      refreshMfa,
      signOut: async (scope = 'local') => {
        await supabase.auth.signOut({ scope });
        queryClient.clear();
        try {
          sessionStorage.clear();
        } catch {
          /* ignore */
        }
      },
    }),
    [session, loading, recovery, mfaPending, mfa.required, token, refreshMfa],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
