import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, Bug, Copy, Link2, Rocket, ScrollText, Settings2, ShieldCheck, Undo2, Users } from 'lucide-react';
import { useBrand } from '@/app/BrandProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { useConfirm } from '@/components/ui/Confirm';
import { useDebounce } from '@/hooks/useDebounce';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { AppSettings, UserStatus } from '@/lib/types';
import {
  adminAudit, adminErrors, adminListReleases, adminListUsers, adminRegisterRelease, adminSetReleaseStatus, adminSetUserStatus,
  adminStats, adminUpdateSettings,
} from '@/services/admin';
import { createInvite, inviteLink, listInvites, revokeInvite } from '@/services/workspace';

type Tab = 'overview' | 'users' | 'invites' | 'settings' | 'releases' | 'audit' | 'errors';
const TABS: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: 'overview', label: 'Visão geral', icon: Activity },
  { id: 'users', label: 'Usuários', icon: Users },
  { id: 'invites', label: 'Convites', icon: Link2 },
  { id: 'settings', label: 'Configurações', icon: Settings2 },
  { id: 'releases', label: 'Versões', icon: Rocket },
  { id: 'audit', label: 'Auditoria', icon: ScrollText },
  { id: 'errors', label: 'Erros', icon: Bug },
];

const STATUS_LABEL: Record<UserStatus, string> = { active: 'Ativo', pending: 'Pendente', suspended: 'Suspenso', revoked: 'Revogado' };

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <>
      <PageHeader eyebrow="Proprietário do aplicativo" title="Administração" subtitle="Gestão de acessos, configurações e versões. Dados financeiros dos usuários não são acessíveis aqui." />
      <div className="scrollbar-none -mx-1 mb-5 flex gap-1 overflow-x-auto px-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn('flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition', tab === t.id ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')}>
            <t.icon className="size-4" aria-hidden /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <UsersTab />}
      {tab === 'invites' && <InvitesTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'releases' && <ReleasesTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'errors' && <ErrorsTab />}
    </>
  );
}

function Overview() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminStats });
  const server = useQuery({ queryKey: ['admin', 'version.json'], queryFn: async () => (await fetch('/version.json', { cache: 'no-store' })).json() as Promise<{ version: string; commit: string; builtAt: string }>, retry: false });
  const s = stats.data ?? {};
  const items = [
    ['Usuários', s.users_total], ['Ativos', s.users_active], ['Pendentes', s.users_pending], ['Suspensos/revogados', s.users_suspended],
    ['Cadastros (30 dias)', s.signups_30d], ['Espaços compartilhados', s.workspaces_shared], ['Lançamentos (30 dias)', s.transactions_30d], ['Erros (24h)', s.errors_24h],
  ];
  return (
    <div className="grid gap-5">
      {stats.error && <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(([l, v]) => (
          <Card key={l as string} className="p-4">
            <p className="text-[13px] font-semibold text-muted">{l}</p>
            {stats.isLoading ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="font-num text-2xl font-semibold">{(v as number | undefined)?.toLocaleString('pt-BR') ?? '—'}</p>}
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Status da implantação" />
        <dl className="grid gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-2">
          <div><dt className="text-subtle">Versão neste navegador</dt><dd className="font-semibold">{env.version} · {env.commit.slice(0, 7)}</dd></div>
          <div><dt className="text-subtle">Versão publicada no servidor</dt><dd className="font-semibold">{server.data ? `${server.data.version} · ${server.data.commit.slice(0, 7)}` : server.isLoading ? '…' : 'indisponível (ambiente local)'}</dd></div>
          <div><dt className="text-subtle">Build do servidor</dt><dd>{formatDateTime(server.data?.builtAt)}</dd></div>
          <div><dt className="text-subtle">Ambiente</dt><dd><Badge tone={env.appEnv === 'production' ? 'positive' : 'warning'}>{env.appEnv}</Badge></dd></div>
          <div><dt className="text-subtle">Banco de dados</dt><dd>{stats.data ? <Badge tone="positive">Conectado · {s.db_size_mb} MB</Badge> : stats.error ? <Badge tone="negative">Falha</Badge> : '…'}</dd></div>
          <div><dt className="text-subtle">Backend</dt><dd className="truncate">{env.supabaseUrl.replace(/^https?:\/\//, '')}</dd></div>
        </dl>
      </Card>
      <Card className="flex gap-3 p-5 text-sm text-muted">
        <ShieldCheck className="size-5 shrink-0 text-brand" aria-hidden />
        <p>Por desenho, o papel de proprietário do aplicativo não concede leitura de dados financeiros. Para dar suporte a um usuário, ele mesmo precisa conceder acesso temporário (somente leitura) na tela de Compartilhamento — a concessão é registrada na auditoria.</p>
      </Card>
    </div>
  );
}

function UsersTab() {
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const users = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => adminListUsers(q) });
  const setStatus = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: UserStatus; reason: string | null }) => adminSetUserStatus(id, status, reason),
    onSuccess: () => { toast.success('Status atualizado.'); void qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  async function change(id: string, email: string, status: UserStatus) {
    const destructive = status === 'suspended' || status === 'revoked';
    if (destructive && !(await confirm({ title: `${status === 'suspended' ? 'Suspender' : 'Revogar'} ${email}?`, description: 'O acesso a todos os dados é bloqueado imediatamente pelo banco de dados.', confirmLabel: 'Confirmar' }))) return;
    setStatus.mutate({ id, status, reason: destructive ? 'Alterado pelo administrador' : null });
  }
  return (
    <Card>
      <div className="p-4"><Input type="search" placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuários" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {users.isLoading ? <Skeleton className="m-4 h-40" /> : users.error ? <ErrorState error={users.error} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-y border-line bg-surface-2/50 text-left text-[12px] uppercase tracking-wider text-subtle">
              <tr><th className="px-4 py-2.5">Usuário</th><th className="px-3">Cadastro</th><th className="px-3">Último acesso</th><th className="px-3">Espaços</th><th className="px-3">Status</th><th className="px-4 text-right">Ação</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.data!.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3"><p className="font-medium">{u.full_name || '—'} {u.is_app_owner && <Badge tone="brand">Proprietário</Badge>}</p><p className="text-[13px] text-subtle">{u.email}</p></td>
                  <td className="px-3 text-muted">{formatDateTime(u.created_at)}</td>
                  <td className="px-3 text-muted">{formatDateTime(u.last_sign_in_at)}</td>
                  <td className="px-3">{u.workspaces}</td>
                  <td className="px-3"><Badge tone={u.status === 'active' ? 'positive' : u.status === 'pending' ? 'warning' : 'negative'}>{STATUS_LABEL[u.status]}</Badge></td>
                  <td className="px-4 text-right">
                    {!u.is_app_owner && (
                      <Select aria-label={`Alterar status de ${u.email}`} value={u.status} onChange={(e) => void change(u.id, u.email, e.target.value as UserStatus)} className="h-9 w-36 text-sm">
                        {(Object.keys(STATUS_LABEL) as UserStatus[]).map((s) => <option key={s} value={s}>{s === 'active' && u.status === 'pending' ? 'Aprovar' : STATUS_LABEL[s]}</option>)}
                      </Select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function InvitesTab() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(7);
  const [link, setLink] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin', 'invites'], queryFn: () => listInvites(null) });
  const create = useMutation({ mutationFn: () => createInvite(null, email.trim() || null, 'viewer', days), onSuccess: (r) => { setLink(inviteLink(r.token)); setEmail(''); void qc.invalidateQueries({ queryKey: ['admin', 'invites'] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const revoke = useMutation({ mutationFn: revokeInvite, onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'invites'] }), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Convite de cadastro" subtitle="Útil no modo “somente convite”. O link libera a conta ao ser aceito." />
        <form className="grid gap-4 p-5" onSubmit={(e) => { e.preventDefault(); if (!create.isPending) create.mutate(); }}>
          <Field label="E-mail" optional hint="Vazio = qualquer pessoa com o link (uso único).">{(id, d) => <Input id={id} aria-describedby={d} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Validade">{(id) => <Select id={id} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} dias</option>)}</Select>}</Field>
          <Button type="submit" variant="primary" loading={create.isPending}>Gerar link</Button>
          {link && (
            <div className="grid gap-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
              <p className="break-all font-mono text-[13px]">{link}</p>
              <Button size="sm" icon={<Copy className="size-4" />} onClick={async () => { await navigator.clipboard.writeText(link); toast.success('Copiado.'); }}>Copiar link</Button>
            </div>
          )}
        </form>
      </Card>
      <Card>
        <CardHeader title="Convites emitidos" />
        <ul className="divide-y divide-line p-2">
          {(list.data ?? []).length === 0 && <li className="p-4 text-sm text-subtle">Nenhum convite.</li>}
          {(list.data ?? []).map((i) => {
            const state = i.accepted_at ? 'Aceito' : i.revoked_at ? 'Cancelado' : new Date(i.expires_at) < new Date() ? 'Expirado' : 'Pendente';
            return (
              <li key={i.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1"><span className="block truncate">{i.email ?? 'Link aberto'}</span><span className="text-[12px] text-subtle">{formatDateTime(i.created_at)}</span></span>
                <Badge tone={state === 'Aceito' ? 'positive' : state === 'Pendente' ? 'warning' : 'neutral'}>{state}</Badge>
                {state === 'Pendente' && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Cancelar</Button>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function SettingsTab() {
  const brand = useBrand();
  const qc = useQueryClient();
  const [s, setS] = useState<AppSettings>(brand);
  useEffect(() => setS(brand), [brand]);
  const save = useMutation({
    mutationFn: () => adminUpdateSettings({
      app_name: s.app_name, tagline: s.tagline, logo_url: s.logo_url ?? '', primary_color: s.primary_color, signup_mode: s.signup_mode,
      features: s.features, limits: s.limits, min_client_version: s.min_client_version ?? '', maintenance_message: s.maintenance_message ?? '',
    } as Partial<AppSettings>),
    onSuccess: () => { toast.success('Configurações publicadas para todos os usuários.'); void qc.invalidateQueries({ queryKey: ['app-settings'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setFeature = (k: keyof AppSettings['features'], v: boolean) => setS((x) => ({ ...x, features: { ...x.features, [k]: v } }));
  const setLimit = (k: keyof AppSettings['limits'], v: number) => setS((x) => ({ ...x, limits: { ...x.limits, [k]: v } }));
  return (
    <form className="grid gap-5 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Card>
        <CardHeader title="Identidade visual" />
        <div className="grid gap-4 p-5">
          <Field label="Nome do aplicativo">{(id) => <Input id={id} value={s.app_name} maxLength={40} onChange={(e) => setS({ ...s, app_name: e.target.value })} />}</Field>
          <Field label="Frase da tela de entrada">{(id) => <Input id={id} value={s.tagline} maxLength={80} onChange={(e) => setS({ ...s, tagline: e.target.value })} />}</Field>
          <Field label="URL do logotipo" optional hint="Imagem quadrada, HTTPS.">{(id, d) => <Input id={id} aria-describedby={d} value={s.logo_url ?? ''} onChange={(e) => setS({ ...s, logo_url: e.target.value })} />}</Field>
          <Field label="Cor principal">{(id) => <div className="flex gap-2"><input id={id} type="color" value={s.primary_color} onChange={(e) => setS({ ...s, primary_color: e.target.value })} className="h-11 w-14 rounded-xl border border-line bg-transparent" /><Input aria-label="Hex" value={s.primary_color} onChange={(e) => setS({ ...s, primary_color: e.target.value })} /></div>}</Field>
          <p className="text-[12px] text-subtle">Nome e ícone do app instalado (PWA) vêm do manifesto publicado; altere em <code>vite.config.ts</code> e publique uma nova versão para mudá-los na tela inicial dos aparelhos.</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Acesso e recursos" />
        <div className="grid gap-3 p-5">
          <Field label="Cadastro">{(id) => <Select id={id} value={s.signup_mode} onChange={(e) => setS({ ...s, signup_mode: e.target.value as AppSettings['signup_mode'] })}><option value="open">Aberto (qualquer pessoa com o link)</option><option value="invite_only">Somente convite / aprovação</option></Select>}</Field>
          <Switch checked={s.features.shared_workspaces !== false} onChange={(v) => setFeature('shared_workspaces', v)} label="Espaços compartilhados" />
          <Switch checked={s.features.attachments !== false} onChange={(v) => setFeature('attachments', v)} label="Anexos de comprovantes" />
          <Switch checked={s.features.exports !== false} onChange={(v) => setFeature('exports', v)} label="Exportação CSV/PDF" />
          <Switch checked={s.features.support_access !== false} onChange={(v) => setFeature('support_access', v)} label="Acesso de suporte autorizado pelo usuário" />
        </div>
      </Card>
      <Card>
        <CardHeader title="Limites de uso" />
        <div className="grid grid-cols-2 gap-3 p-5">
          <Field label="Espaços por usuário">{(id) => <Input id={id} type="number" min={1} value={s.limits.max_workspaces_per_user ?? 5} onChange={(e) => setLimit('max_workspaces_per_user', Number(e.target.value))} />}</Field>
          <Field label="Membros por espaço">{(id) => <Input id={id} type="number" min={2} value={s.limits.max_members_per_workspace ?? 12} onChange={(e) => setLimit('max_members_per_workspace', Number(e.target.value))} />}</Field>
          <Field label="Lançamentos/mês por espaço">{(id) => <Input id={id} type="number" min={100} value={s.limits.max_transactions_per_month ?? 3000} onChange={(e) => setLimit('max_transactions_per_month', Number(e.target.value))} />}</Field>
          <Field label="Anexo máx. (MB)">{(id) => <Input id={id} type="number" min={1} max={5} value={s.limits.max_attachment_mb ?? 5} onChange={(e) => setLimit('max_attachment_mb', Number(e.target.value))} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Comunicação e versões" />
        <div className="grid gap-4 p-5">
          <Field label="Aviso para todos os usuários" optional hint="Exibido no topo do app (ex.: manutenção programada).">{(id, d) => <Textarea id={id} aria-describedby={d} maxLength={300} value={s.maintenance_message ?? ''} onChange={(e) => setS({ ...s, maintenance_message: e.target.value })} />}</Field>
          <Field label="Versão mínima exigida" optional hint="Clientes abaixo dela atualizam automaticamente assim que não houver formulário aberto.">{(id, d) => <Input id={id} aria-describedby={d} placeholder="1.0.0" value={s.min_client_version ?? ''} onChange={(e) => setS({ ...s, min_client_version: e.target.value })} />}</Field>
        </div>
      </Card>
      <div className="lg:col-span-2"><Button type="submit" variant="primary" loading={save.isPending}>Salvar e publicar configurações</Button></div>
    </form>
  );
}

function ReleasesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const releases = useQuery({ queryKey: ['admin', 'releases'], queryFn: adminListReleases });
  const [version, setVersion] = useState(env.version);
  const [notes, setNotes] = useState('');
  const register = useMutation({ mutationFn: () => adminRegisterRelease(version, notes || null, env.commit !== 'local' ? env.commit : null), onSuccess: () => { toast.success('Versão registrada.'); void qc.invalidateQueries({ queryKey: ['admin', 'releases'] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const rollback = useMutation({ mutationFn: (id: string) => adminSetReleaseStatus(id, 'rolled_back'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'releases'] }), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader title="Como publicar uma nova versão" />
        <ol className="list-decimal space-y-2 p-5 pl-9 text-sm text-muted">
          <li>Desenvolva e teste localmente (<code>npm run check</code>).</li>
          <li>Abra um Pull Request: o CI executa lint, tipos, testes unitários e testes do banco.</li>
          <li>Com o PR aprovado e mesclado em <code>main</code>, o CI aplica as migrações e publica o front-end.</li>
          <li>Os usuários recebem um aviso discreto e atualizam sem reinstalar. Para forçar, defina a versão mínima em Configurações.</li>
          <li>Para reverter: na hospedagem, promova a implantação anterior (rollback instantâneo) e marque a versão como revertida aqui. Detalhes em <code>docs/OPERACAO.md</code>.</li>
        </ol>
        <form className="grid gap-3 border-t border-line p-5" onSubmit={(e) => { e.preventDefault(); register.mutate(); }}>
          <p className="text-sm font-semibold">Registrar notas de versão manualmente</p>
          <Field label="Versão">{(id) => <Input id={id} value={version} onChange={(e) => setVersion(e.target.value)} />}</Field>
          <Field label="Notas" optional>{(id) => <Textarea id={id} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <Button type="submit" loading={register.isPending} disabled={!/^\d+\.\d+\.\d+$/.test(version)}>Registrar</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Histórico de versões" />
        {releases.isLoading ? <Skeleton className="m-4 h-32" /> : (releases.data ?? []).length === 0 ? <EmptyState title="Nenhuma versão registrada" description="O CI registra automaticamente a cada publicação quando configurado." /> : (
          <ul className="divide-y divide-line p-2">
            {releases.data!.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-3 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">v{r.version} {r.version === env.version && <Badge tone="brand">em uso</Badge>} {r.status === 'rolled_back' && <Badge tone="negative">revertida</Badge>}</span>
                  <span className="block text-[12px] text-subtle">{formatDateTime(r.published_at)} · {r.channel}{r.commit_sha && ` · ${r.commit_sha.slice(0, 7)}`}</span>
                  {r.notes && <span className="mt-1 block whitespace-pre-wrap text-[13px] text-muted">{r.notes}</span>}
                </span>
                {r.status === 'published' && <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={async () => { if (await confirm({ title: `Marcar v${r.version} como revertida?`, description: 'Isto registra a reversão. O rollback do código é feito na hospedagem (ver documentação).', confirmLabel: 'Marcar' })) rollback.mutate(r.id); }}>Reverter</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AuditTab() {
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: adminAudit });
  return (
    <Card>
      {q.isLoading ? <Skeleton className="m-4 h-40" /> : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).length === 0 && <li className="p-5 text-sm text-subtle">Sem registros.</li>}
          {(q.data ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span className="w-40 shrink-0 text-subtle">{formatDateTime(a.created_at)}</span>
              <span className="font-semibold">{a.action}</span>
              <span className="text-muted">{a.actor_email ?? 'sistema'}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-subtle">{a.target_type}:{a.target_id} {Object.keys(a.details ?? {}).length ? JSON.stringify(a.details) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ErrorsTab() {
  const q = useQuery({ queryKey: ['admin', 'errors'], queryFn: adminErrors });
  return (
    <Card>
      <p className="border-b border-line px-5 py-3 text-[13px] text-subtle">Mensagens técnicas sanitizadas no navegador (sem tokens, e-mails ou valores). Retidas por 90 dias.</p>
      {q.isLoading ? <Skeleton className="m-4 h-40" /> : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).length === 0 && <li className="p-5 text-sm text-subtle">Nenhum erro registrado. 🎉</li>}
          {(q.data ?? []).map((e) => (
            <li key={e.id} className="px-5 py-3 text-sm">
              <p className="font-mono text-[13px]">{e.message}</p>
              <p className="text-[12px] text-subtle">{formatDateTime(e.created_at)} · v{e.app_version} · {e.route} · {e.user_email ?? 'anônimo'}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
