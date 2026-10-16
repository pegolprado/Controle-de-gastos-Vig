import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, LifeBuoy, Link2, LogOut, MessageCircle, Pencil, Plus, Trash2, UserMinus, Users } from 'lucide-react';
import { useBrand } from '@/app/BrandProvider';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/Confirm';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/domain/labels';
import { formatDateTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import type { WorkspaceRole } from '@/lib/types';
import {
  createInvite, createWorkspace, deleteWorkspace, grantSupport, inviteLink, listInvites, listMembers, removeMember,
  renameWorkspace, revokeInvite, revokeSupport, setMemberRole,
} from '@/services/workspace';

const ASSIGNABLE: WorkspaceRole[] = ['admin', 'editor', 'contributor', 'viewer'];

export default function WorkspacePage() {
  const ws = useWsId();
  const brand = useBrand();
  const { workspace, canAdmin, isOwnerOfWs, ctx, reload, setWorkspace } = useWorkspace();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('novo') === '1');
  const [inviting, setInviting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const myId = ctx?.profile?.id;
  const shared = workspace?.kind === 'shared';

  useEffect(() => {
    if (params.get('novo')) {
      params.delete('novo');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const members = useQuery({ queryKey: ['ws', ws, 'members'], queryFn: () => listMembers(ws) });
  const invites = useQuery({ queryKey: ['ws', ws, 'invites'], queryFn: () => listInvites(ws), enabled: canAdmin && shared });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ws', ws] });
    void reload();
  };
  const onErr = (e: unknown) => toast.error(errorMessage(e));
  const role = useMutation({ mutationFn: ({ user, r }: { user: string; r: WorkspaceRole }) => setMemberRole(ws, user, r), onSuccess: () => { toast.success('Permissão atualizada.'); refresh(); }, onError: onErr });
  const remove = useMutation({ mutationFn: (user: string) => removeMember(ws, user), onSuccess: () => { toast.success('Membro removido.'); refresh(); }, onError: onErr });
  const revoke = useMutation({ mutationFn: revokeInvite, onSuccess: () => { toast.success('Convite cancelado.'); refresh(); }, onError: onErr });
  const leave = useMutation({
    mutationFn: () => removeMember(ws, myId!),
    onSuccess: async () => {
      toast.success('Você saiu do espaço.');
      const personal = ctx?.workspaces.find((w) => w.kind === 'personal');
      if (personal) setWorkspace(personal.id);
      await reload();
      navigate('/');
    },
    onError: onErr,
  });
  const del = useMutation({
    mutationFn: () => deleteWorkspace(ws),
    onSuccess: async () => {
      toast.success('Espaço excluído.');
      const personal = ctx?.workspaces.find((w) => w.kind === 'personal');
      if (personal) setWorkspace(personal.id);
      await reload();
      navigate('/');
    },
    onError: onErr,
  });
  const support = useMutation({ mutationFn: (on: boolean) => (on ? grantSupport(ws, 24) : revokeSupport(ws)), onSuccess: () => { toast.success('Acesso de suporte atualizado.'); refresh(); }, onError: onErr });

  const supportMember = members.data?.find((m) => m.is_support);
  const pendingInvites = (invites.data ?? []).filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date());

  return (
    <>
      <PageHeader
        title="Compartilhamento"
        subtitle={shared ? `Pessoas com acesso a “${workspace?.name}”.` : 'Seu espaço pessoal é privado. Crie um espaço compartilhado para a família ou equipe.'}
        actions={
          <>
            {brand.features.shared_workspaces !== false && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo espaço compartilhado</Button>}
            {shared && canAdmin && <Button variant="primary" icon={<Link2 className="size-4" />} onClick={() => setInviting(true)}>Convidar pessoa</Button>}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Membros" subtitle={shared ? 'Permissões aplicadas pelo servidor em cada consulta.' : undefined} action={shared && canAdmin && <IconButton label="Renomear espaço" onClick={() => setRenaming(true)}><Pencil className="size-4" /></IconButton>} />
          <ul className="divide-y divide-line p-2">
            {members.isLoading && <Skeleton className="m-2 h-16" />}
            {members.data?.map((m) => {
              const canChange = canAdmin && m.role !== 'owner' && !m.is_support && m.user_id !== myId && (isOwnerOfWs || m.role !== 'admin');
              return (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <span className="grid size-9 place-items-center rounded-full bg-surface-2 text-sm font-semibold uppercase text-muted">{(m.full_name || m.email).slice(0, 1)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{m.full_name || m.email}{m.user_id === myId && <span className="font-normal text-subtle"> (você)</span>}</span>
                    <span className="block truncate text-[13px] text-subtle">{m.email}</span>
                  </span>
                  {m.is_support ? (
                    <Badge tone="info"><LifeBuoy className="size-3" aria-hidden /> Suporte até {formatDateTime(m.expires_at)}</Badge>
                  ) : canChange ? (
                    <Select aria-label={`Permissão de ${m.email}`} value={m.role} onChange={(e) => role.mutate({ user: m.user_id, r: e.target.value as WorkspaceRole })} className="h-9 w-44 text-sm">
                      {ASSIGNABLE.filter((r) => isOwnerOfWs || r !== 'admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                  ) : (
                    <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                  )}
                  {canChange && (
                    <IconButton size="sm" label="Remover membro" onClick={async () => { if (await confirm({ title: `Remover ${m.full_name || m.email}?`, description: 'A pessoa perde o acesso imediatamente. Os lançamentos que ela registrou permanecem.', confirmLabel: 'Remover' })) remove.mutate(m.user_id); }}>
                      <UserMinus className="size-4" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
          {shared && !isOwnerOfWs && (
            <div className="border-t border-line p-4">
              <Button size="sm" variant="ghost" icon={<LogOut className="size-4" />} onClick={async () => { if (await confirm({ title: 'Sair deste espaço?', description: 'Você precisará de um novo convite para voltar.', confirmLabel: 'Sair' })) leave.mutate(); }}>
                Sair do espaço
              </Button>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Níveis de permissão" />
            <dl className="space-y-3 p-5 pt-4">
              {(['owner', ...ASSIGNABLE] as WorkspaceRole[]).map((r) => (
                <div key={r}>
                  <dt className="text-sm font-semibold">{ROLE_LABEL[r]}</dt>
                  <dd className="text-[13px] text-muted">{ROLE_DESCRIPTION[r]}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {shared && canAdmin && (
            <Card>
              <CardHeader title="Convites pendentes" />
              <ul className="p-2">
                {pendingInvites.length === 0 ? <li className="px-3 py-4 text-sm text-subtle">Nenhum convite pendente.</li> : pendingInvites.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{i.email ?? 'Qualquer pessoa com o link'}</span>
                      <span className="block text-[12px] text-subtle">{ROLE_LABEL[i.role]} · expira {formatDateTime(i.expires_at)}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Cancelar</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {isOwnerOfWs && brand.features.support_access !== false && (
            <Card className="p-5">
              <p className="flex items-center gap-2 font-semibold"><LifeBuoy className="size-4 text-info" aria-hidden /> Acesso de suporte</p>
              <p className="mt-1 text-[13px] text-muted">O administrador do aplicativo não vê seus dados. Se precisar de ajuda, conceda acesso somente leitura por 24 horas. A concessão fica registrada.</p>
              <Button className="mt-3" size="sm" variant={supportMember ? 'danger' : 'secondary'} loading={support.isPending} onClick={() => support.mutate(!supportMember)}>
                {supportMember ? 'Revogar acesso de suporte' : 'Conceder acesso por 24h'}
              </Button>
            </Card>
          )}

          {shared && isOwnerOfWs && (
            <Card className="border-negative/25 p-5">
              <p className="font-semibold text-negative">Excluir espaço</p>
              <p className="mt-1 text-[13px] text-muted">Remove definitivamente todas as contas, cartões e lançamentos deste espaço para todos os membros.</p>
              <Button className="mt-3" size="sm" variant="danger" icon={<Trash2 className="size-4" />} loading={del.isPending} onClick={async () => {
                if (await confirm({ title: `Excluir “${workspace?.name}” definitivamente?`, description: 'Esta ação não pode ser desfeita. Exporte os dados antes, se necessário.', confirmLabel: 'Excluir espaço' })) del.mutate();
              }}>Excluir espaço</Button>
            </Card>
          )}
        </div>
      </div>

      {!shared && (members.data?.length ?? 0) <= 1 && (
        <Card className="mt-5"><EmptyState icon={<Users className="size-6" />} title="Orçamento em família" description="Crie um espaço compartilhado, convide pessoas e defina o que cada uma pode fazer. Seu espaço pessoal continua privado." action={<Button variant="primary" onClick={() => setCreating(true)}>Criar espaço compartilhado</Button>} /></Card>
      )}

      {creating && <CreateWorkspace onClose={() => setCreating(false)} onCreated={async (id) => { await reload(); setWorkspace(id); setCreating(false); }} />}
      {inviting && <InviteDialog onClose={() => { setInviting(false); refresh(); }} />}
      {renaming && <RenameDialog current={workspace?.name ?? ''} onClose={() => { setRenaming(false); refresh(); }} />}
    </>
  );
}

function CreateWorkspace({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const m = useMutation({ mutationFn: () => createWorkspace(name.trim()), onSuccess: (id) => { toast.success('Espaço criado.'); onCreated(id); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Modal open onClose={onClose} title="Novo espaço compartilhado" description="Ex.: Casa, Família Silva, Viagem 2027." size="sm" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => !m.isPending && m.mutate()}>Criar</Button></div>}>
      <Field label="Nome do espaço">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
    </Modal>
  );
}

function RenameDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const ws = useWsId();
  const [name, setName] = useState(current);
  const m = useMutation({ mutationFn: () => renameWorkspace(ws, name.trim()), onSuccess: () => { toast.success('Espaço renomeado.'); onClose(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Modal open onClose={onClose} title="Renomear espaço" size="sm" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate()}>Salvar</Button></div>}>
      <Field label="Nome">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
    </Modal>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const ws = useWsId();
  const { workspace, isOwnerOfWs } = useWorkspace();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('contributor');
  const [days, setDays] = useState(7);
  const [link, setLink] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => createInvite(ws, email.trim() || null, role, days), onSuccess: (r) => setLink(inviteLink(r.token)), onError: (e) => toast.error(errorMessage(e)) });
  const share = `Você foi convidado para o espaço “${workspace?.name}”. Acesse: ${link}`;
  return (
    <Modal open onClose={onClose} title="Convidar pessoa" description="Gere um link de convite e envie por WhatsApp, e-mail ou mensagem." size="sm">
      {link ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted">Link gerado. Ele funciona uma única vez{email ? ` e apenas para ${email}` : ''}, e expira em {days} dias. Por segurança, ele não será exibido novamente.</p>
          <div className="break-all rounded-xl border border-line bg-surface-2 p-3 font-mono text-[13px]">{link}</div>
          <div className="grid grid-cols-2 gap-2">
            <Button icon={<Copy className="size-4" />} onClick={async () => { await navigator.clipboard.writeText(link); toast.success('Link copiado.'); }}>Copiar</Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer"><Button block icon={<MessageCircle className="size-4" />}>WhatsApp</Button></a>
          </div>
          <Button variant="primary" onClick={onClose}>Concluir</Button>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!m.isPending) m.mutate(); }}>
          <Field label="E-mail da pessoa" optional hint="Se informado, só esse e-mail poderá aceitar.">{(id, d) => <Input id={id} aria-describedby={d} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Permissão" hint={ROLE_DESCRIPTION[role]}>
            {(id, d) => <Select id={id} aria-describedby={d} value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>{ASSIGNABLE.filter((r) => isOwnerOfWs || r !== 'admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>}
          </Field>
          <Field label="Validade">{(id) => <Select id={id} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} {d === 1 ? 'dia' : 'dias'}</option>)}</Select>}</Field>
          <Button type="submit" variant="primary" loading={m.isPending}>Gerar link de convite</Button>
        </form>
      )}
    </Modal>
  );
}
