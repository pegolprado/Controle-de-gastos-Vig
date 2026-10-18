import { useQuery } from '@tanstack/react-query'
import { KeyRound, Settings as Gear, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'
import { ROLE_LABEL, useAuth } from '../app/auth'
import { ErrorBox, Field, Notice, PageHeader } from '../components/ui'
import { assertStrong, deriveKey } from '../lib/passkey'
import { RULES_VERSION } from '../engine/normalize'

export default function SettingsPage() {
  const { me, refresh } = useAuth()
  const [sp] = useSearchParams()
  const sys = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings') })
  return (
    <div>
      <PageHeader icon={<Gear className="h-5 w-5" />} title="Configurações" subtitle={`${me?.name} · ${me?.email} · perfil ${ROLE_LABEL[me?.role ?? '']}`} />
      {(sp.get('trocar') || me?.must_change_password) && (
        <div className="mb-4">
          <Notice tone="amber" title="Troca de senha obrigatória">
            Defina uma nova senha para continuar usando a plataforma.
          </Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChangePassword onDone={refresh} />
        <Mfa enabled={!!me?.mfa_enabled} onChange={refresh} />
        <section className="card p-6 lg:col-span-2">
          <h2 className="section-title mb-3 text-muted">Sistema</h2>
          {sys.data && (
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="label">Versão do sistema / regras</dt>
                <dd className="font-mono">
                  {sys.data.app_version} / {RULES_VERSION}
                </dd>
              </div>
              <div>
                <dt className="label">Envio de e-mail (recuperação de acesso)</dt>
                <dd>{sys.data.smtp_configured ? 'configurado' : 'não configurado — o administrador gera links de redefinição'}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="label">Mapa</dt>
                <dd className="font-mono text-xs break-all text-muted">{sys.data.map_tile_url || 'desativado (sem camada de mapa externa)'}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="label">Privacidade das análises</dt>
                <dd className="text-muted">
                  Os arquivos e resultados são processados somente no seu navegador e ficam na memória desta aba. O servidor não recebe nem grava arquivos, consultas ou relatórios. Sair, fechar a aba, recarregar ou ficar {sys.data.idle_minutes} minutos sem atividade apaga tudo.
                </dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </div>
  )
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [cur, setCur] = useState('')
  const [n1, setN1] = useState('')
  const [n2, setN2] = useState('')
  const [err, setErr] = useState<unknown>(null)
  return (
    <form
      className="card space-y-3 p-6"
      onSubmit={async (e) => {
        e.preventDefault()
        setErr(null)
        if (n1 !== n2) return setErr(new Error('As novas senhas não conferem'))
        try {
          assertStrong(n1)
          const email = (await api<{ email: string }>('/auth/me')).email
          await api('/auth/password/change', { body: { current: await deriveKey(email, cur), new: await deriveKey(email, n1) } })
          toast.success('Senha alterada; outras sessões foram encerradas')
          setCur('')
          setN1('')
          setN2('')
          onDone()
        } catch (e) {
          setErr(e)
        }
      }}
    >
      <h2 className="section-title mb-1 flex items-center gap-2 text-muted">
        <KeyRound className="h-4 w-4" /> Alterar senha
      </h2>
      <Field label="Senha atual">
        <input type="password" className="w-full" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      </Field>
      <Field label="Nova senha" hint="Mínimo de 12 caracteres, com letras e números.">
        <input type="password" className="w-full" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} required />
      </Field>
      <Field label="Repita a nova senha">
        <input type="password" className="w-full" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} required />
      </Field>
      {err ? <ErrorBox error={err} /> : null}
      <button className="btn-primary">Salvar nova senha</button>
    </form>
  )
}

function Mfa({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null)
  const [code, setCode] = useState('')
  const [pwd, setPwd] = useState('')
  const [err, setErr] = useState<unknown>(null)
  return (
    <section className="card space-y-3 p-6">
      <h2 className="section-title flex items-center gap-2 text-muted">
        <ShieldCheck className="h-4 w-4" /> Verificação em duas etapas
      </h2>
      <p className="text-sm text-muted">{enabled ? 'Ativa. O login exige o código do aplicativo autenticador.' : 'Recomendada para todos os perfis. Use um aplicativo TOTP (Google Authenticator, Microsoft Authenticator, Authy, 1Password).'}</p>
      {!enabled && !setup && (
        <button
          className="btn-ghost"
          onClick={async () => {
            try {
              setSetup(await api('/auth/mfa/setup', { method: 'POST' }))
            } catch (e) {
              setErr(e)
            }
          }}
        >
          Configurar
        </button>
      )}
      {!enabled && setup && (
        <div className="space-y-3">
          <Notice>
            No aplicativo, escolha “inserir chave manualmente” e informe a chave abaixo (tipo: baseada em tempo).
          </Notice>
          <div className="rounded-lg border border-line bg-ink-2 p-3 text-center font-mono text-lg tracking-widest break-all text-white select-all">{setup.secret}</div>
          <details className="text-xs text-faint">
            <summary className="cursor-pointer">URI otpauth (para gerar QR code em ferramenta confiável)</summary>
            <div className="mt-1 font-mono break-all select-all">{setup.otpauth}</div>
          </details>
          <Field label="Código gerado">
            <input className="w-full font-mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <button
            className="btn-primary"
            onClick={async () => {
              try {
                await api('/auth/mfa/enable', { body: { code } })
                toast.success('Verificação em duas etapas ativada')
                setSetup(null)
                onChange()
              } catch (e) {
                setErr(e)
              }
            }}
          >
            Ativar
          </button>
        </div>
      )}
      {enabled && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input type="password" placeholder="Senha" value={pwd} onChange={(e) => setPwd(e.target.value)} />
          <input placeholder="Código" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button
            className="btn-danger sm:col-span-2"
            onClick={async () => {
              try {
                const email = (await api<{ email: string }>('/auth/me')).email
                await api('/auth/mfa/disable', { body: { key: await deriveKey(email, pwd), code } })
                toast.success('Verificação em duas etapas desativada')
                onChange()
              } catch (e) {
                setErr(e)
              }
            }}
          >
            Desativar
          </button>
        </div>
      )}
      {err ? <ErrorBox error={err} /> : null}
    </section>
  )
}
