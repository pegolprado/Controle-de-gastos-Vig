/**
 * Privacidade na tela: bloqueio (pausa sem apagar a análise) e ocultação de números.
 * Estado só em memória.
 */
import { Lock, LogOut } from 'lucide-react'
import { type FormEvent, useState, useSyncExternalStore } from 'react'
import { api } from '../api/client'
import { ErrorBox } from '../components/ui'
import { setNumberMask } from '../lib/format'
import { deriveKey } from '../lib/passkey'
import { useAuth } from './auth'

type P = { locked: boolean; masked: boolean }
let state: P = { locked: false, masked: false }
const listeners = new Set<() => void>()
const set = (p: Partial<P>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

export const lockScreen = () => set({ locked: true })
export const isLocked = () => state.locked
export function toggleMask() {
  setNumberMask(!state.masked)
  set({ masked: !state.masked })
}
export function usePrivacy(): P {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Tela de bloqueio: esconde tudo e pede a senha; a análise continua na memória. */
export function LockOverlay() {
  const { me, logout } = useAuth()
  const { locked } = usePrivacy()
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  if (!locked || !me) return null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await api('/auth/verify', { body: { key: await deriveKey(me.email, pwd) } })
      setPwd('')
      set({ locked: false })
      window.dispatchEvent(new Event('marx:activity'))
    } catch (x) {
      setErr(x)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-ink/95 px-4 backdrop-blur-2xl" role="dialog" aria-modal="true" aria-label="Tela bloqueada">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 border-accent/40 p-6 text-center">
        <img src="/icon-192.png" alt="" className="mx-auto h-14 w-14 rounded-xl" />
        <div>
          <div className="flex items-center justify-center gap-2 text-lg font-bold text-white">
            <Lock className="h-4 w-4" /> Tela bloqueada
          </div>
          <p className="mt-1 text-sm text-muted">
            {me.name} · a análise continua aberta nesta aba. Digite sua senha para voltar.
          </p>
        </div>
        <input className="w-full" type="password" autoFocus autoComplete="current-password" placeholder="Senha" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        {err ? <ErrorBox error={err} /> : null}
        <button className="btn-primary w-full" disabled={busy || !pwd}>
          {busy ? 'Verificando…' : 'Desbloquear'}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" /> Sair e apagar a análise
        </button>
      </form>
    </div>
  )
}
