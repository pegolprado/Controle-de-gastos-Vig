import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ensureCsrf, onApiStatus } from '../api/client'

export type Me = {
  id: number
  email: string
  name: string
  role: 'admin' | 'analyst' | 'reviewer' | 'viewer'
  mfa_enabled: boolean
  must_change_password: boolean
  admin_content_access: boolean
}

const Ctx = createContext<{ me: Me | null; loading: boolean; refresh: () => void; logout: () => Promise<void> }>({
  me: null,
  loading: true,
  refresh: () => {},
  logout: async () => {},
})

export const ROLE_LABEL: Record<string, string> = { admin: 'Administrador', analyst: 'Analista', reviewer: 'Revisor', viewer: 'Consulta' }

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const loc = useLocation()
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
  useEffect(
    () =>
      onApiStatus((status, path) => {
        if (status === 401 && !path.startsWith('/auth/')) {
          qc.setQueryData(['me'], null)
          if (!location.pathname.startsWith('/login')) navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
        }
      }),
    [qc, navigate],
  )
  const value = {
    me: q.data ?? null,
    loading: q.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    logout: async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => {})
      qc.clear()
      navigate('/login')
    },
  }
  void loc
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  return useContext(Ctx)
}
