import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/Confirm';
import { useWorkspace } from '@/app/WorkspaceProvider';
import type { Transaction, TxKind } from '@/lib/types';
import { TransactionForm, type TransactionFormProps } from './TransactionForm';

interface OpenArgs {
  kind?: TxKind;
  existing?: Transaction | null;
  duplicateOf?: Transaction | null;
  preset?: TransactionFormProps['preset'];
}

const QuickAddContext = createContext<(args?: OpenArgs) => void>(() => undefined);

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [args, setArgs] = useState<OpenArgs | null>(null);
  const [dirty, setDirty] = useState(false);
  const confirm = useConfirm();
  const { canContribute } = useWorkspace();
  const [params, setParams] = useSearchParams();

  const open = useCallback((a: OpenArgs = {}) => setArgs(a), []);

  // atalhos do PWA: /?novo=expense
  useEffect(() => {
    const novo = params.get('novo') as TxKind | null;
    if (novo && canContribute) {
      setArgs({ kind: ['income', 'expense', 'transfer', 'card_payment'].includes(novo) ? novo : 'expense' });
      params.delete('novo');
      setParams(params, { replace: true });
    }
  }, [params, setParams, canContribute]);

  const close = useCallback(async () => {
    if (dirty) {
      const ok = await confirm({ title: 'Descartar alterações?', description: 'As informações digitadas não foram salvas.', confirmLabel: 'Descartar' });
      if (!ok) return;
    }
    setDirty(false);
    setArgs(null);
  }, [dirty, confirm]);

  const title = args?.existing
    ? 'Editar lançamento'
    : args?.duplicateOf
      ? 'Duplicar lançamento'
      : 'Novo lançamento';

  return (
    <QuickAddContext.Provider value={open}>
      {children}
      <Modal open={Boolean(args)} onClose={close} title={title} size="md">
        {args && (
          <TransactionForm
            key={args.existing?.id ?? args.duplicateOf?.id ?? args.kind ?? 'new'}
            initialKind={args.kind}
            existing={args.existing}
            duplicateOf={args.duplicateOf}
            preset={args.preset}
            onDirtyChange={setDirty}
            onDone={() => {
              setDirty(false);
              setArgs(null);
            }}
          />
        )}
      </Modal>
    </QuickAddContext.Provider>
  );
}

export const useQuickAdd = () => useContext(QuickAddContext);
