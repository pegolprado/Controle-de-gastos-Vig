import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ensureCsrf, onApiStatus } from '../api/client'
import { resetDb } from '../engine/db'
import { clearSession, getState } from '../engine/session'

export type Me = {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  mfa_enabled: boolean
  must_change_password: boolean
  can_export: boolean
  idle_minutes: number
}

const Ctx = createContext<{ me: Me | null; loading: boolean; refresh: () => void; logout: (reason?: string) => Promise<void> }>({
  me: null,
  loading: true,
  refresh: () => {},
  logout: async () => {},
})

export const ROLE_LABEL: Record<string, string> = { admin: 'Administrador', user: 'Usuário' }

/**
 * Apaga tudo o que a sessão de análise tem na memória e recarrega a página do zero,
 * para que nenhum dado, resultado ou cache continue no navegador.
 */
export async function wipeAndReload(to: string) {
  try {
    await resetDb()
  } catch {
    /* banco local ainda não iniciado */
  }
  clearSession()
  window.location.replace(to)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      await ensureCsrf()
      try {
        return await api<Me>('/auth/me')
      } catch {
        return null
      }
    },
    staleTime: 60_000,
    retry: false,
  })
  const me = q.data ?? null

  const logout = useCallback(async (reason?: string) => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    qc.clear()
    await wipeAndReload(`/login${reason ? `?motivo=${reason}` : ''}`)
  }, [qc])

  useEffect(
    () =>
      onApiStatus((status, path) => {
        if (status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/mfa')) {
          qc.setQueryData(['me'], null)
          if (getState().files.length || getState().targets.length) void wipeAndReload('/login?motivo=expirada')
          else if (!location.pathname.startsWith('/login')) navigate('/login')
        }
      }),
    [qc, navigate],
  )

  // Encerramento por inatividade: apaga a análise da memória e volta ao login.
  const last = useRef(Date.now())
  useEffect(() => {
    if (!me) return
    const mark = () => {
      last.current = Date.now()
    }
    const evs = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }))
    const limit = Math.max(1, me.idle_minutes || 30) * 60_000
    const t = window.setInterval(() => {
      if (getState().busy) last.current = Date.now()
      if (Date.now() - last.current > limit) void logout('inatividade')
    }, 15_000)
    // Mantém a sessão do servidor viva enquanto o usuário trabalha (sem enviar dados).
    const ping = window.setInterval(() => {
      if (Date.now() - last.current < limit) api('/auth/me').catch(() => {})
    }, 5 * 60_000)
    return () => {
      evs.forEach((e) => window.removeEventListener(e, mark))
      window.clearInterval(t)
      window.clearInterval(ping)
    }
  }, [me, logout])

  // Aviso ao fechar/recarregar a aba com dados carregados (tudo será apagado).
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (getState().files.length) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  const value = { me, loading: q.isLoading, refresh: () => qc.invalidateQueries({ queryKey: ['me'] }), logout }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  return useContext(Ctx)
}
