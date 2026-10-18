import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, KeyRound, LogOut, Monitor, Moon, Smartphone, Sun, Tags, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { useTheme } from '@/app/ThemeProvider';
import { useWorkspace } from '@/app/WorkspaceProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Switch } from '@/components/ui/Field';
import { PushToggle } from '@/pwa/PushToggle';
import { Segmented } from '@/components/ui/Segmented';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/Confirm';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { downloadFile } from '@/lib/csv';
import { formatDateTime, todayISO } from '@/lib/dates';
import { passwordIssues } from '@/features/auth/SignupPage';
import { updatePreferences, updateProfile } from '@/services/session';
import { InstallButton } from '@/pwa/InstallPrompt';

const EXPORT_TABLES = ['accounts', 'categories', 'credit_cards', 'card_invoices', 'transactions', 'tx_settlements', 'installment_groups', 'recurrences', 'budgets', 'goals', 'goal_contributions'] as const;

export default function SettingsPage() {
  const { session, signOut } = useAuth();
  const { ctx, reload } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const confirm = useConfirm();
  const userId = session?.user.id ?? '';
  const [name, setName] = useState(ctx?.profile?.full_name ?? '');
  const [pwOpen, setPwOpen] = useState(false);
  const prefs = ctx?.preferences;

  const saveName = useMutation({ mutationFn: () => updateProfile(userId, { full_name: name.trim() || null }), onSuccess: () => { toast.success('Perfil atualizado.'); void reload(); }, onError: (e) => toast.error(errorMessage(e)) });
  const pref = useMutation({ mutationFn: (p: Record<string, unknown>) => updatePreferences(userId, p), onSuccess: () => void reload(), onError: (e) => toast.error(errorMessage(e)) });

  const exportData = useMutation({
    mutationFn: async () => {
      const out: Record<string, unknown> = { exported_at: new Date().toISOString(), app_version: env.version, profile: ctx?.profile, workspaces: [] as unknown[] };
      for (const w of ctx?.workspaces ?? []) {
        if (w.is_support) continue;
        const data: Record<string, unknown> = { id: w.id, name: w.name, kind: w.kind, role: w.role };
        for (const t of EXPORT_TABLES) {
          const rows: unknown[] = [];
          for (let from = 0; ; from += 1000) {
            const { data: batch, error } = await supabase.from(t).select('*').eq('workspace_id', w.id).range(from, from + 999);
            if (error) throw error;
            rows.push(...(batch ?? []));
            if (!batch || batch.length < 1000) break;
          }
          data[t] = rows;
        }
        (out.workspaces as unknown[]).push(data);
      }
      downloadFile(JSON.stringify(out, null, 2), `meus-dados-${todayISO()}.json`, 'application/json');
    },
    onSuccess: () => toast.success('Exportação concluída.'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
      if (error) {
        // Fallback: se a função não estiver publicada, remove os dados e desativa o perfil
        const r = await supabase.rpc('delete_my_data');
        if (r.error) throw r.error;
      }
    },
    onSuccess: async () => { toast.success('Conta excluída.'); await signOut('global'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader title="Ajustes" subtitle="Perfil, aparência, segurança e privacidade." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Perfil" />
          <form className="grid gap-4 p-5" onSubmit={(e) => { e.preventDefault(); saveName.mutate(); }}>
            <Field label="Nome">{(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="E-mail" hint="Para alterar, fale com o administrador.">{(id, d) => <Input id={id} aria-describedby={d} value={ctx?.profile?.email ?? ''} disabled />}</Field>
            <Button type="submit" variant="primary" loading={saveName.isPending} className="justify-self-start">Salvar</Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Aparência e preferências" />
          <div className="grid gap-4 p-5">
            <Segmented label="Tema" value={theme} onChange={(t) => { setTheme(t); pref.mutate({ theme: t }); }} options={[{ value: 'system', label: 'Automático' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }]} />
            <p className="flex items-center gap-2 text-[13px] text-subtle">{theme === 'dark' ? <Moon className="size-4" /> : theme === 'light' ? <Sun className="size-4" /> : <Monitor className="size-4" />} O modo automático segue o sistema do aparelho.</p>
            <Switch checked={prefs?.hide_values ?? false} onChange={(v) => pref.mutate({ hide_values: v })} label="Ocultar valores ao abrir" description="Valores ficam borrados até você tocar no ícone de olho." />
            <Switch checked={prefs?.budget_alerts ?? true} onChange={(v) => pref.mutate({ budget_alerts: v })} label="Alertas de orçamento" description="Avisos ao atingir 50%, 75%, 90% e 100%." />
            <Switch checked={prefs?.due_alerts ?? true} onChange={(v) => pref.mutate({ due_alerts: v })} label="Alertas de vencimento" description="Contas que vencem em até 3 dias ou estão atrasadas." />
            <Switch checked={prefs?.renda_alerts ?? true} onChange={(v) => pref.mutate({ renda_alerts: v })} label="Avisos de proventos" description="FII e ações que pagam hoje ou amanhã (Renda FII)." />
            <PushToggle />
            <Link to="/categorias" className="inline-flex items-center gap-2 text-sm font-semibold text-brand"><Tags className="size-4" /> Gerenciar categorias</Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="Segurança" />
          <div className="grid gap-3 p-5">
            <p className="text-[13px] text-muted">Último acesso: {formatDateTime(session?.user.last_sign_in_at)}</p>
            <div className="flex flex-wrap gap-2">
              <Button icon={<KeyRound className="size-4" />} onClick={() => setPwOpen(true)}>Alterar senha</Button>
              <Button icon={<LogOut className="size-4" />} onClick={async () => { if (await confirm({ title: 'Sair de todos os dispositivos?', description: 'Todas as sessões abertas (celular, computador) serão encerradas.', confirmLabel: 'Sair de todos', tone: 'primary' })) await signOut('global'); }}>
                Sair de todos os dispositivos
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Seus dados (LGPD)" />
          <div className="grid gap-3 p-5">
            <p className="text-[13px] text-muted">Baixe uma cópia completa de todos os dados dos espaços a que você tem acesso, em formato aberto (JSON).</p>
            <Button icon={<Download className="size-4" />} loading={exportData.isPending} onClick={() => exportData.mutate()} className="justify-self-start">Exportar meus dados</Button>
            <div className="mt-2 border-t border-line pt-4">
              <p className="text-sm font-semibold text-negative">Excluir conta</p>
              <p className="text-[13px] text-muted">Apaga seu login, seu espaço pessoal e os espaços compartilhados que você criou. Você será removido dos demais espaços.</p>
              <Button className="mt-3" size="sm" variant="danger" icon={<Trash2 className="size-4" />} loading={deleteAccount.isPending} disabled={ctx?.is_app_owner} onClick={async () => {
                if (await confirm({ title: 'Excluir sua conta definitivamente?', description: 'Esta ação não pode ser desfeita. Recomendamos exportar seus dados antes.', confirmLabel: 'Excluir minha conta' })) deleteAccount.mutate();
              }}>Excluir minha conta</Button>
              {ctx?.is_app_owner && <p className="mt-2 text-[12px] text-subtle">O proprietário do aplicativo precisa transferir a função antes.</p>}
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Aplicativo" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="text-sm">
              <p>Versão <strong>{env.version}</strong> <span className="text-subtle">({env.commit.slice(0, 7)})</span></p>
              <p className="text-[13px] text-subtle">Publicada em {formatDateTime(env.builtAt)} · ambiente {env.appEnv}</p>
              <p className="mt-2 text-[13px] text-muted">Atualizações chegam automaticamente: quando houver uma nova versão, um aviso aparece e você escolhe o momento de atualizar.</p>
            </div>
            <div className="flex gap-3 text-[13px] text-muted">
              <Smartphone className="size-5 shrink-0 text-brand" aria-hidden />
              <div className="flex flex-col gap-3"><InstallButton /><p><strong className="text-fg">Instalar no celular:</strong> no Android (Chrome), toque em ⋮ → “Instalar app”. No iPhone (Safari), toque em Compartilhar → “Adicionar à Tela de Início”. No computador, use o ícone de instalação na barra de endereço.</p></div>
            </div>
          </div>
        </Card>
      </div>
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const issues = passwordIssues(pw);
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.auth.updateUser({ password: pw }); if (error) throw error; },
    onSuccess: () => { toast.success('Senha alterada.'); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Alterar senha" size="sm" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={issues.length > 0 || pw !== confirm} onClick={() => m.mutate()}>Salvar</Button></div>}>
      <div className="grid gap-4">
        <Field label="Nova senha" hint={pw && issues.length ? `Use ${issues.join(' e ')}.` : undefined}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        <Field label="Confirmar" error={confirm && confirm !== pw ? 'As senhas não coincidem.' : undefined}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
