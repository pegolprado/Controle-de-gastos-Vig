import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useBrand } from '@/app/BrandProvider';
import { Logo } from '@/components/layout/Logo';

/** Composição da tela de entrada: formulário + painel com o "extrato vivo". */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const brand = useBrand();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="pt-safe flex flex-col px-5 py-8 sm:px-10">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </div>
        <p className="flex items-center justify-center gap-1.5 text-[12px] text-subtle">
          <ShieldCheck className="size-3.5" aria-hidden /> Conexão criptografada. Nunca pedimos senhas de banco.
        </p>
      </div>
      <div className="relative hidden overflow-hidden border-l border-line bg-[linear-gradient(160deg,var(--hero-from),var(--hero-to))] lg:block">
        <div className="absolute -right-24 -top-24 size-[520px] rounded-full bg-brand/20 blur-[120px]" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <p className="max-w-md font-display text-[34px] font-semibold leading-[1.15] tracking-tight">
            {brand.tagline}
          </p>
          <LedgerPreview />
          <p className="text-sm text-white/50">Contas, cartões, orçamentos e metas — para você ou para toda a família.</p>
        </div>
      </div>
    </div>
  );
}

/** Ilustração decorativa (dados fictícios) construída com a própria UI do produto. */
function LedgerPreview() {
  const rows = [
    { d: 'Salário', v: '+ R$ 8.450,00', c: 'text-emerald-300', w: '92%' },
    { d: 'Aluguel', v: '− R$ 2.300,00', c: 'text-rose-300', w: '48%' },
    { d: 'Mercado', v: '− R$ 684,90', c: 'text-rose-300', w: '22%' },
    { d: 'Reserva', v: '→ R$ 1.500,00', c: 'text-sky-300', w: '34%' },
  ];
  return (
    <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur" aria-hidden>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Saldo do mês</p>
      <p className="font-num mt-1 text-4xl font-semibold">R$ 3.965,10</p>
      <div className="mt-6 space-y-3.5">
        {rows.map((r) => (
          <div key={r.d} className="flex items-center gap-3 text-sm">
            <span className="w-20 text-white/60">{r.d}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-white/40" style={{ width: r.w }} />
            </span>
            <span className={`font-num w-32 text-right ${r.c}`}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
