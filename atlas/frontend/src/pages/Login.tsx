import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ErrorBox, Field, Notice } from '../components/ui'
import { assertStrong, deriveKey, deriveWithSalt } from '../lib/passkey'

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img
            src="/logo.webp"
            alt="MARX Intelligence Pro — Análise • Conexões • Inteligência"
            width={640}
            height={678}
            className="mx-auto h-auto w-72 sm:w-80"
            style={{ maskImage: 'radial-gradient(ellipse 72% 70% at 50% 48%, #000 62%, transparent 100%)', WebkitMaskImage: 'radial-gradient(ellipse 72% 70% at 50% 48%, #000 62%, transparent 100%)' }}
          />
          <h1 className="sr-only">MARX Intelligence Pro</h1>
        </div>
        <div className="card border-accent/40 p-6">
          <h2 className="mb-4 text-lg font-bold text-white">{title}</h2>
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-faint">Acesso restrito a usuários autorizados. Seus arquivos e consultas são processados só no seu navegador e apagados ao sair — nada fica salvo.</p>
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
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api<{ needed: boolean }>('/setup'), retry: false })
  useEffect(() => {
    if (setup.data?.needed) navigate('/primeiro-acesso', { replace: true })
  }, [setup.data, navigate])
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
        const key = await deriveKey(email, password)
        const r = await api('/auth/login', { body: { email, key } })
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
  return (
    <AuthCard title="Recuperar acesso">
      <div className="space-y-4">
        <Notice>
          Por segurança, a redefinição de senha é feita pelo administrador do MARX: peça a ele um <b>link de redefinição</b> (válido por 24 horas e de uso único). Ao abrir o link, você define a nova senha.
        </Notice>
        <div className="text-center">
          <Link to="/login" className="text-sm text-accent hover:underline">
            Voltar ao login
          </Link>
        </div>
      </div>
    </AuthCard>
  )
}

export function ResetPassword() {
  const [sp] = useSearchParams()
  const token = sp.get('token') ?? ''
  const info = useQuery({ queryKey: ['reset-info', token], queryFn: () => api<{ email: string; name: string; salt: string; iterations: number }>('/auth/password/reset-info', { body: { token } }), retry: false })
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  return (
    <AuthCard title="Definir senha">
      {info.error ? (
        <ErrorBox error={info.error} />
      ) : done ? (
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
            setErr(null)
            try {
              if (p1 !== p2) throw new Error('As senhas não conferem')
              assertStrong(p1)
              setBusy(true)
              const key = await deriveWithSalt(p1, info.data!.salt, info.data!.iterations)
              await api('/auth/password/reset', { body: { token, key } })
              setDone(true)
            } catch (e) {
              setErr(e)
            } finally {
              setBusy(false)
            }
          }}
        >
          {info.data && (
            <p className="text-sm text-muted">
              {info.data.name} · <span className="font-mono">{info.data.email}</span>
            </p>
          )}
          <Field label="Nova senha" hint="Mínimo de 12 caracteres, com letras e números.">
            <input className="w-full" type="password" autoComplete="new-password" required value={p1} onChange={(e) => setP1(e.target.value)} />
          </Field>
          <Field label="Repita a senha">
            <input className="w-full" type="password" autoComplete="new-password" required value={p2} onChange={(e) => setP2(e.target.value)} />
          </Field>
          {err ? <ErrorBox error={err} /> : null}
          <button className="btn-primary w-full" disabled={busy || !info.data}>
            {busy ? 'Protegendo a senha…' : 'Salvar senha'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}

/** Primeiro acesso: cria o administrador inicial usando o código SETUP_TOKEN definido no painel. */
export function FirstSetup() {
  const navigate = useNavigate()
  const [f, setF] = useState({ token: '', name: '', email: '', p1: '', p2: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const st = useQuery({ queryKey: ['setup'], queryFn: () => api<{ needed: boolean; token_configured: boolean }>('/setup'), retry: false })
  if (st.data && !st.data.needed)
    return (
      <AuthCard title="Primeiro acesso">
        <Notice tone="green">O sistema já está configurado.</Notice>
        <Link to="/login" className="btn-primary mt-4 w-full">
          Ir para o login
        </Link>
      </AuthCard>
    )
  return (
    <AuthCard title="Primeiro acesso — criar administrador">
      {st.data && !st.data.token_configured && (
        <div className="mb-4">
          <Notice tone="amber">Defina a variável <b>SETUP_TOKEN</b> no painel da Cloudflare (Settings → Variables) e publique de novo.</Notice>
        </div>
      )}
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          setErr(null)
          try {
            if (f.p1 !== f.p2) throw new Error('As senhas não conferem')
            assertStrong(f.p1)
            setBusy(true)
            const key = await deriveKey(f.email, f.p1)
            await api('/setup', { body: { token: f.token, name: f.name, email: f.email, key } })
            navigate('/login', { replace: true })
          } catch (e) {
            setErr(e)
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Código de configuração (SETUP_TOKEN)">
          <input className="w-full font-mono" type="password" required value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
        </Field>
        <Field label="Seu nome">
          <input className="w-full" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="E-mail">
          <input className="w-full" type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Senha" hint="Mínimo de 12 caracteres, com letras e números.">
          <input className="w-full" type="password" autoComplete="new-password" required value={f.p1} onChange={(e) => setF({ ...f, p1: e.target.value })} />
        </Field>
        <Field label="Repita a senha">
          <input className="w-full" type="password" autoComplete="new-password" required value={f.p2} onChange={(e) => setF({ ...f, p2: e.target.value })} />
        </Field>
        {err ? <ErrorBox error={err} /> : null}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Criando…' : 'Criar administrador'}
        </button>
      </form>
    </AuthCard>
  )
}
