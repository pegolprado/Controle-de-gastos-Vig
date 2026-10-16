import { Wifi } from 'lucide-react';
import type { CreditCard } from '@/lib/types';
import { Money } from '@/components/ui/Money';

/** Representação visual do cartão (sem dados sensíveis). */
export function CardVisual({ card, available, used }: { card: CreditCard; available?: number; used?: number }) {
  const pct = card.limit_cents ? Math.min(100, ((used ?? 0) / card.limit_cents) * 100) : 0;
  return (
    <div
      className="relative aspect-[1.586] w-full overflow-hidden rounded-[22px] p-5 text-white shadow-float"
      style={{ background: `linear-gradient(135deg, ${card.color} 0%, color-mix(in oklab, ${card.color} 45%, #050810) 100%)` }}
    >
      <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-white/15 blur-2xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -left-10 size-56 rounded-full bg-black/25 blur-2xl" aria-hidden />
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between">
          <span className="font-display text-lg font-semibold drop-shadow">{card.name}</span>
          <Wifi className="size-5 rotate-90 opacity-70" aria-hidden />
        </div>
        <div className="mt-3 h-7 w-10 rounded-md bg-gradient-to-br from-amber-200/90 to-amber-500/80 opacity-90" aria-hidden />
        <div className="mt-auto">
          <p className="font-num text-[15px] tracking-[0.2em] opacity-80">•••• {card.last_digits ?? '••••'}</p>
          <div className="mt-2 flex items-end justify-between gap-2 text-[12px]">
            <span>
              <span className="block opacity-70">Disponível</span>
              <Money cents={available ?? card.limit_cents} className="font-num text-base font-semibold text-white" />
            </span>
            <span className="text-right opacity-80">
              Fecha dia {card.closing_day}
              <br />
              Vence dia {card.due_day}
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/20" aria-hidden>
            <div className="h-full rounded-full bg-white/90" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
