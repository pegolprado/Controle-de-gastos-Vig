import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2, Mic, Square, Undo2 } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { cn } from '@/lib/cn';
import { formatDate, relativeDay, todayISO } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { newRequestId } from '@/lib/id';
import { invalidateFinance } from '@/lib/queryClient';
import { parseQuickEntries, type QuickEntry } from '@/domain/quickEntry';
import { createInstallments, createTransaction, deleteTransaction, listCategoryHints } from '@/services/transactions';
import { quickCategory, quickSource } from './quickResolve';
import { useSpeech } from './speech';

interface Saved {
  key: string;
  id: string | null;
  q: QuickEntry;
  category: string | null;
  source: string | null;
  undone?: boolean;
}

const VoiceContext = createContext<() => void>(() => undefined);
export const useVoiceCapture = () => useContext(VoiceContext);

/**
 * "Falar um gasto": abre ouvindo, entende uma ou várias despesas na mesma frase
 * ("gastei 100 de gasolina e 35 no mercado") e já salva cada uma no lugar certo.
 */
export function VoiceCaptureProvider({ children }: { children: ReactNode }) {
  const ws = useWsId();
  const { canContribute } = useWorkspace();
  const { accounts, cards, categories } = useLookups();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  const hints = useQuery({ queryKey: wsKey(ws, 'category-hints'), queryFn: () => listCategoryHints(ws), enabled: open, staleTime: 10 * 60_000 });

  async function save(said: string) {
    const sources = [...cards.filter((c) => !c.archived).map((c) => c.name), ...accounts.filter((a) => !a.archived).map((a) => a.name)];
    const entries = parseQuickEntries(said, sources);
    const ok = entries.filter((q) => q.amount_cents && q.description);
    setMissing(entries.filter((q) => !q.amount_cents).map((q) => q.description || said));
    if (!ok.length) {
      toast.info('Não entendi o valor. Tente: “gastei 50 reais no mercado”.');
      return;
    }
    setSaving(true);
    const hintList = hints.data ?? (await listCategoryHints(ws).catch(() => []));
    const done: Saved[] = [];
    for (const q of ok) {
      const category = quickCategory(q, categories, hintList) || null;
      const { useCard, card, account } = quickSource(q, accounts, cards);
      if (!useCard && !account) {
        toast.error('Cadastre uma conta antes de lançar.');
        break;
      }
      try {
        let id: string | null = null;
        if (useCard && q.installments > 1) {
          await createInstallments(ws, { description: q.description, total_cents: q.amount_cents!, installments: q.installments, purchase_date: q.occurred_on, card_id: card!.id, account_id: null, category_id: category, tags: [], notes: null, first_status: 'paid' }, newRequestId());
        } else {
          const tx = await createTransaction(
            ws,
            {
              kind: q.kind,
              status: q.kind === 'income' ? 'received' : 'paid',
              description: q.description,
              amount_cents: q.amount_cents!,
              occurred_on: q.occurred_on,
              due_on: null,
              category_id: category,
              account_id: useCard ? null : account!.id,
              destination_account_id: null,
              card_id: useCard ? card!.id : null,
              payment_method: useCard ? 'credit_card' : q.payment_method,
              tags: [],
              notes: null,
            },
            newRequestId(),
          );
          id = tx.id;
        }
        done.push({ key: newRequestId(), id, q, category: categories.find((c) => c.id === category)?.name ?? null, source: useCard ? card!.name : account!.name });
      } catch (e) {
        toast.error(`${q.description}: ${errorMessage(e)}`);
      }
    }
    setSaving(false);
    setSaved((s) => [...done, ...s]);
    setText('');
    if (done.length) void invalidateFinance(ws);
  }

  const speech = useSpeech((said) => {
    setText(said);
    void save(said);
  });

  const start = useCallback(() => {
    if (!canContribute) return;
    setSaved([]);
    setMissing([]);
    setText('');
    setOpen(true);
    // dentro do toque: o navegador só libera o microfone a partir de um gesto
    if (speech.supported) speech.start();
  }, [canContribute, speech]);

  // atalho do app instalado: /?voz=1
  useEffect(() => {
    if (params.get('voz') && canContribute) {
      setOpen(true);
      params.delete('voz');
      setParams(params, { replace: true });
    }
  }, [params, setParams, canContribute]);

  async function undo(s: Saved) {
    if (!s.id) return;
    try {
      await deleteTransaction(s.id);
      setSaved((list) => list.map((x) => (x.key === s.key ? { ...x, undone: true } : x)));
      void invalidateFinance(ws);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const close = () => {
    speech.stop();
    setOpen(false);
  };
  const today = todayISO();
  const shown = speech.listening && speech.transcript ? speech.transcript : text;

  return (
    <VoiceContext.Provider value={start}>
      {children}
      <Modal
        open={open}
        onClose={close}
        title="Falar um gasto"
        size="sm"
        footer={
          <div className="flex w-full gap-2">
            {saved.length > 0 && <Button className="flex-1" onClick={close}>Pronto</Button>}
            {speech.supported && (
              <Button variant="primary" className="flex-1" icon={speech.listening ? <Square className="size-4" /> : <Mic className="size-4" />} onClick={() => (speech.listening ? speech.stop() : speech.start())} disabled={saving}>
                {speech.listening ? 'Parar' : saved.length ? 'Falar outro' : 'Falar'}
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <button
            type="button"
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            disabled={!speech.supported || saving}
            aria-label={speech.listening ? 'Parar de ouvir' : 'Começar a ouvir'}
            className={cn(
              'grid size-20 place-items-center rounded-full transition',
              speech.listening ? 'animate-pulse bg-negative text-white shadow-[0_0_0_10px_color-mix(in_oklab,var(--negative)_18%,transparent)]' : 'bg-brand text-[color:var(--brand-fg)]',
              !speech.supported && 'opacity-40',
            )}
          >
            {saving ? <Loader2 className="size-8 animate-spin" /> : <Mic className="size-8" />}
          </button>
          <p className="text-[14px] font-medium" aria-live="polite">
            {saving ? 'Salvando…' : speech.listening ? 'Ouvindo… pode falar' : saved.some((x) => !x.undone) ? `Pronto! ${saved.filter((x) => !x.undone).length === 1 ? '1 lançamento salvo' : `${saved.filter((x) => !x.undone).length} lançamentos salvos`}.` : speech.supported ? 'Toque no microfone e fale' : 'Seu navegador não tem reconhecimento de voz: escreva abaixo'}
          </p>
          <p className="text-[12px] text-subtle">Ex.: “gastei 100 reais com gasolina e 35 com mercado”</p>
        </div>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !saving) void save(text.trim());
          }}
        >
          <input
            value={shown}
            onChange={(e) => setText(e.target.value)}
            aria-label="O que você gastou"
            placeholder="Ou escreva aqui"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-brand"
          />
          <Button type="submit" disabled={!text.trim() || saving}>Salvar</Button>
        </form>

        {missing.length > 0 && <p className="mt-3 text-[13px] text-warning">Faltou o valor de: {missing.join(', ')}.</p>}

        {saved.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line" aria-label="Lançamentos salvos">
            {saved.map((s) => (
              <li key={s.key} className={cn('flex items-center gap-3 px-3 py-2.5', s.undone && 'opacity-50')}>
                <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', s.undone ? 'bg-surface-2 text-subtle' : 'bg-positive/15 text-positive')}>
                  {s.undone ? <Undo2 className="size-3.5" aria-hidden /> : <Check className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate font-medium', s.undone && 'line-through')}>{s.q.description}{s.q.installments > 1 ? ` · ${s.q.installments}x` : ''}</p>
                  <p className="truncate text-[12px] text-subtle">
                    {[s.category ?? 'Sem categoria', s.source, s.q.occurred_on === today ? 'hoje' : relativeDay(s.q.occurred_on, today) === 'ontem' ? 'ontem' : formatDate(s.q.occurred_on)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Money cents={s.q.kind === 'income' ? s.q.amount_cents! : -s.q.amount_cents!} signed className={cn('font-num font-semibold', s.q.kind === 'income' && 'text-positive')} />
                {s.id && !s.undone && (
                  <button type="button" onClick={() => void undo(s)} className="text-[12px] font-semibold text-brand hover:underline" aria-label={`Desfazer ${s.q.description}`}>
                    Desfazer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </VoiceContext.Provider>
  );
}
