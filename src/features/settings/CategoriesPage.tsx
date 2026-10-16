import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useCategories } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, Skeleton } from '@/components/ui/Card';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/Segmented';
import { CATEGORY_ICONS, CategoryIcon, ColorPicker } from '@/components/ui/CategoryIcon';
import { useConfirm } from '@/components/ui/Confirm';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import { cn } from '@/lib/cn';
import type { Category, CategoryKind } from '@/lib/types';
import { createCategory, deleteCategory, updateCategory } from '@/services/categories';

export default function CategoriesPage() {
  const ws = useWsId();
  const { canEdit } = useWorkspace();
  const q = useCategories();
  const confirm = useConfirm();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const all = q.data ?? [];
  const roots = all.filter((c) => c.kind === kind && !c.parent_id);
  const archive = useMutation({ mutationFn: (c: Category) => updateCategory(c.id, { archived: !c.archived }), onSuccess: () => void invalidateFinance(ws), onError: (e) => toast.error(errorMessage(e)) });
  const del = useMutation({ mutationFn: (c: Category) => deleteCategory(c.id), onSuccess: () => { toast.success('Categoria excluída. Lançamentos ficaram sem categoria.'); void invalidateFinance(ws); }, onError: (e) => toast.error(errorMessage(e)) });

  const row = (c: Category, child = false) => (
    <li key={c.id} className={cn('flex items-center gap-3 py-2.5 pr-3', child ? 'pl-12' : 'pl-3', c.archived && 'opacity-50')}>
      <CategoryIcon icon={c.icon} color={c.color} size={child ? 'sm' : 'md'} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
      {c.is_fixed && <Badge tone="info">Fixa</Badge>}
      {canEdit && (
        <span className="flex gap-0.5">
          {!child && <IconButton size="sm" label="Nova subcategoria" onClick={() => setEditing({ kind, parent_id: c.id, color: c.color, icon: c.icon })}><Plus className="size-4" /></IconButton>}
          <IconButton size="sm" label="Editar" onClick={() => setEditing(c)}><Pencil className="size-4" /></IconButton>
          <IconButton size="sm" label={c.archived ? 'Reativar' : 'Arquivar'} onClick={() => archive.mutate(c)}>{c.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}</IconButton>
          <IconButton size="sm" label="Excluir" onClick={async () => { if (await confirm({ title: `Excluir “${c.name}”?`, description: 'Lançamentos com esta categoria ficarão sem categoria. Subcategorias também serão excluídas. Prefira arquivar para manter os relatórios.', confirmLabel: 'Excluir' })) del.mutate(c); }}><Trash2 className="size-4" /></IconButton>
        </span>
      )}
    </li>
  );

  return (
    <>
      <PageHeader title="Categorias" subtitle="Organize receitas e despesas em categorias e subcategorias." actions={canEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ kind, parent_id: null })}>Nova categoria</Button>} />
      <Segmented className="mb-4 max-w-xs" label="Tipo" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Despesas' }, { value: 'income', label: 'Receitas' }]} />
      <Card>
        {q.isLoading ? <Skeleton className="m-4 h-40" /> : (
          <ul className="divide-y divide-line">
            {roots.map((r) => (
              <li key={r.id}>
                <ul>{row(r)}{all.filter((c) => c.parent_id === r.id).map((c) => row(c, true))}</ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <CategoryForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CategoryForm({ initial, onClose }: { initial: Partial<Category>; onClose: () => void }) {
  const ws = useWsId();
  const q = useCategories();
  const [name, setName] = useState(initial.name ?? '');
  const [kind] = useState<CategoryKind>(initial.kind ?? 'expense');
  const [parent, setParent] = useState(initial.parent_id ?? '');
  const [color, setColor] = useState(initial.color ?? '#64748b');
  const [icon, setIcon] = useState(initial.icon ?? 'tag');
  const [fixed, setFixed] = useState(initial.is_fixed ?? false);
  const m = useMutation({
    mutationFn: () => {
      const p = { name: name.trim(), kind, parent_id: parent || null, color, icon, is_fixed: fixed };
      return initial.id ? updateCategory(initial.id, p) : createCategory(ws, p);
    },
    onSuccess: () => { toast.success('Categoria salva.'); void invalidateFinance(ws); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const roots = (q.data ?? []).filter((c) => c.kind === kind && !c.parent_id && c.id !== initial.id);
  const hasChildren = (q.data ?? []).some((c) => c.parent_id === initial.id);
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Editar categoria' : 'Nova categoria'} size="sm" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => !m.isPending && m.mutate()}>Salvar</Button></div>}>
      <div className="grid gap-4">
        <Field label="Nome">{(id) => <Input id={id} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        {!hasChildren && (
          <Field label="Categoria pai" optional>{(id) => <Select id={id} value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Nenhuma (categoria principal)</option>{roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        )}
        <Field label="Cor">{() => <ColorPicker value={color} onChange={setColor} />}</Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-muted">Ícone</legend>
          <div className="grid grid-cols-8 gap-1.5">
            {Object.keys(CATEGORY_ICONS).map((k) => (
              <button key={k} type="button" aria-label={k} aria-pressed={icon === k} onClick={() => setIcon(k)} className={cn('rounded-xl p-0.5 transition', icon === k ? 'ring-2 ring-brand' : 'opacity-70 hover:opacity-100')}>
                <CategoryIcon icon={k} color={color} size="sm" />
              </button>
            ))}
          </div>
        </fieldset>
        {kind === 'expense' && <Switch checked={fixed} onChange={setFixed} label="Despesa fixa" description="Usada no relatório de despesas fixas × variáveis." />}
      </div>
    </Modal>
  );
}
