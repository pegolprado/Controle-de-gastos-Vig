import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ErrorBox, Field, Notice } from '../components/ui'

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img
            src="/logo.webp"
            alt="iaMARX Intelligence Pro — Análise • Conexões • Inteligência"
            width={640}
            height={678}
            className="mx-auto h-auto w-72 sm:w-80"
            style={{ maskImage: 'radial-gradient(ellipse 72% 70% at 50% 48%, #000 62%, transparent 100%)', WebkitMaskImage: 'radial-gradient(ellipse 72% 70% at 50% 48%, #000 62%, transparent 100%)' }}
          />
          <h1 className="sr-only">iaMARX Intelligence Pro</h1>
        </div>
        <div className="card border-accent/40 p-6">
          <h2 className="mb-4 text-lg font-bold text-white">{title}</h2>
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-faint">Acesso restrito a usuários autorizados. Todas as operações são registradas em trilha de auditoria.</p>
      </div>
    </div>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [mfa, setMfa] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const next = sp.get('next') || '/'
  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ['me'] })
    navigate(next.startsWith('/') ? next : '/')
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      if (!mfa) {
        const r = await api('/auth/login', { body: { email, password } })
        if (r.mfa_required) setMfa(true)
        else await finish()
      } else {
        await api('/auth/mfa', { body: { code } })
        await finish()
      }
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard title={mfa ? 'Verificação em duas etapas' : 'Entrar'}>
      <form onSubmit={submit} className="space-y-4">
        {!mfa ? (
          <>
            <Field label="E-mail">
              <input className="w-full" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Senha">
              <input className="w-full" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Código do aplicativo autenticador" hint="Seis dígitos exibidos no aplicativo (Google Authenticator, Authy, etc.)">
            <input className="w-full text-center font-mono text-xl tracking-[0.5em]" inputMode="numeric" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        {err ? <ErrorBox error={err} /> : null}
        <button className="btn-primary w-full" disabled={busy}>
          {mfa ? <ShieldCheck className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />} {busy ? 'Verificando…' : mfa ? 'Confirmar' : 'Entrar'}
        </button>
        {!mfa && (
          <div className="text-center">
            <Link to="/esqueci-senha" className="text-sm text-accent hover:underline">
              Esqueci minha senha
            </Link>
          </div>
        )}
      </form>
    </AuthCard>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  return (
    <AuthCard title="Recuperar acesso">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            const r = await api('/auth/password/forgot', { body: { email } })
            setMsg(r.message)
          } catch (e) {
            setErr(e)
          }
        }}
      >
        <Field label="E-mail cadastrado">
          <input className="w-full" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {msg && <Notice tone="green">{msg}</Notice>}
        {err ? <ErrorBox error={err} /> : null}
        <button className="btn-primary w-full">Enviar instruções</button>
        <div className="text-center">
          <Link to="/login" className="text-sm text-accent hover:underline">
            Voltar ao login
          </Link>
        </div>
      </form>
    </AuthCard>
  )
}

export function ResetPassword() {
  const [sp] = useSearchParams()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  return (
    <AuthCard title="Definir nova senha">
      {done ? (
        <div className="space-y-4">
          <Notice tone="green">Senha definida. Sessões anteriores foram encerradas.</Notice>
          <Link to="/login" className="btn-primary w-full">
            Ir para o login
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (p1 !== p2) return setErr(new Error('As senhas não conferem'))
            try {
              await api('/auth/password/reset', { body: { token: sp.get('token'), password: p1 } })
              setDone(true)
            } catch (e) {
              setErr(e)
            }
          }}
        >
          <Field label="Nova senha" hint="Mínimo de 12 caracteres, com letras e números.">
            <input className="w-full" type="password" autoComplete="new-password" required value={p1} onChange={(e) => setP1(e.target.value)} />
          </Field>
          <Field label="Repita a senha">
            <input className="w-full" type="password" autoComplete="new-password" required value={p2} onChange={(e) => setP2(e.target.value)} />
          </Field>
          {err ? <ErrorBox error={err} /> : null}
          <button className="btn-primary w-full">Salvar senha</button>
        </form>
      )}
    </AuthCard>
  )
}
