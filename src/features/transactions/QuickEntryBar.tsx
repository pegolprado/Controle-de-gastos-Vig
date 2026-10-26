import { useRef, useState } from 'react';
import { Camera, Loader2, Mic, Sparkles, Square } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { parseReceiptText } from '@/domain/quickEntry';
import { useSpeech } from './speech';

export interface ReceiptResult {
  amount_cents: number | null;
  occurred_on: string | null;
  merchant: string | null;
  file: File;
}

/** Lê o texto de uma foto de comprovante no próprio aparelho (nada sai do celular). */
async function readReceipt(file: File, onProgress: (p: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const base = `${import.meta.env.BASE_URL}ocr/`;
  const worker = await createWorker('por', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    void worker.terminate();
  }
}

/**
 * Lançamento em segundos: escreva ou fale ("gastei 42 no mercado") ou fotografe o comprovante,
 * e o formulário é preenchido. É só conferir e salvar.
 */
export function QuickEntryBar({ onText, onReceipt }: { onText: (text: string) => void; onReceipt: (r: ReceiptResult) => void }) {
  const [text, setText] = useState('');
  const [reading, setReading] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const applied = useRef('');
  const apply = (value = text) => {
    const v = value.trim();
    if (!v || v === applied.current) return;
    applied.current = v;
    onText(v);
  };
  const speech = useSpeech((said) => {
    setText(said);
    apply(said);
  });
  const listening = speech.listening;
  const canSpeak = speech.supported;
  const toggleVoice = () => (listening ? speech.stop() : speech.start());
  const shown = listening && speech.transcript ? speech.transcript : text;

  async function pickReceipt(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Envie uma foto (JPG ou PNG) do comprovante.');
      return;
    }
    setReading(0);
    try {
      const raw = await readReceipt(file, setReading);
      const r = parseReceiptText(raw);
      onReceipt({ ...r, file });
      if (r.amount_cents === null) toast.warning('Não achei o valor no comprovante. Confira e digite o valor.');
    } catch {
      toast.error('Não foi possível ler o comprovante. Tente uma foto mais nítida.');
    } finally {
      setReading(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="rounded-2xl border border-brand/25 bg-brand/[0.05] p-2.5" role="group" aria-label="Lançamento rápido">
      <div className="flex items-center gap-1.5">
        <Sparkles className="ml-1 size-4 shrink-0 text-brand" aria-hidden />
        <input
          value={shown}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
          onBlur={() => apply()}
          placeholder={listening ? 'Ouvindo… fale o gasto' : 'Ex.: gastei 42 no mercado'}
          aria-label="Escreva o lançamento, ex.: gastei 42 no mercado"
          enterKeyHint="done"
          data-autofocus
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] outline-none placeholder:text-subtle"
        />
        {canSpeak && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={listening ? 'Parar de ouvir' : 'Falar o lançamento'}
            aria-pressed={listening}
            className={cn('grid size-10 shrink-0 place-items-center rounded-xl transition', listening ? 'animate-pulse bg-negative text-white' : 'text-brand hover:bg-brand/10')}
          >
            {listening ? <Square className="size-4" /> : <Mic className="size-5" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={reading !== null}
          aria-label="Ler comprovante pela foto"
          className="grid size-10 shrink-0 place-items-center rounded-xl text-brand transition hover:bg-brand/10 disabled:opacity-60"
        >
          {reading !== null ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pickReceipt(e.target.files?.[0])} />
      </div>
      <p className="px-1 pt-0.5 text-[12px] text-subtle" aria-live="polite">
        {reading !== null ? `Lendo o comprovante… ${reading}%` : listening ? 'Ex.: “uber 18 e 90 ontem” ou “recebi 3 mil de salário”' : 'Escreva, fale ou fotografe o comprovante. Eu preencho, você confere.'}
      </p>
    </div>
  );
}
