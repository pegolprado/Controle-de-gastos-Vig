import { useState } from 'react';
import { Check, ChevronsUpDown, LifeBuoy, Plus, User, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '@/app/WorkspaceProvider';
import { ROLE_LABEL } from '@/domain/labels';
import { cn } from '@/lib/cn';

export function WorkspaceSwitcher() {
  const { ctx, workspace, setWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const list = ctx?.workspaces ?? [];
  if (!workspace) return null;
  const Icon = workspace.is_support ? LifeBuoy : workspace.kind === 'personal' ? User : Users;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-2/60 px-3 py-2.5 text-left transition hover:border-line-strong"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-brand/12 text-brand">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{workspace.name}</span>
          <span className="block text-[12px] text-subtle">{workspace.is_support ? 'Acesso de suporte' : ROLE_LABEL[workspace.role]}</span>
        </span>
        <ChevronsUpDown className="size-4 text-subtle" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div role="listbox" aria-label="Espaços" className="absolute inset-x-0 top-full z-20 mt-2 animate-rise overflow-hidden rounded-2xl border border-line bg-elevated p-1.5 shadow-float">
            {list.map((w) => (
              <button
                key={w.id}
                role="option"
                aria-selected={w.id === workspace.id}
                type="button"
                onClick={() => {
                  setWorkspace(w.id);
                  setOpen(false);
                  navigate('/');
                }}
                className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-surface-2', w.id === workspace.id && 'bg-surface-2')}
              >
                {w.kind === 'personal' ? <User className="size-4 text-subtle" aria-hidden /> : <Users className="size-4 text-subtle" aria-hidden />}
                <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                {w.id === workspace.id && <Check className="size-4 text-brand" aria-hidden />}
              </button>
            ))}
            <div className="my-1 h-px bg-line" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/espaco?novo=1');
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-brand hover:bg-surface-2"
            >
              <Plus className="size-4" aria-hidden /> Criar espaço compartilhado
            </button>
          </div>
        </>
      )}
    </div>
  );
}
