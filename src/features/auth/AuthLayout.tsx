import { useEffect, useState, type ReactNode } from 'react';
import { Building2, Check, LineChart, Mic, PiggyBank, ShieldCheck, Smartphone, Sparkles, Target, Users } from 'lucide-react';
import { useBrand } from '@/app/BrandProvider';
import { Logo } from '@/components/layout/Logo';
import { cn } from '@/lib/cn';

const FEATURES = [
  { icon: Mic, title: 'Fale e pronto', text: '“Gastei 100 de gasolina e 35 no mercado” vira dois lançamentos, na categoria certa.' },
  { icon: LineChart, title: 'Previsão do saldo', text: 'Veja quanto vai sobrar até o salário e se dá para gastar hoje.' },
  { icon: PiggyBank, title: 'Economia automática', text: 'Assinaturas esquecidas, contas que subiram e tarifas: o app aponta.' },
  { icon: Target, title: 'Metas com plano', text: 'Reserva, carro, viagem: quanto guardar por mês, pelo que sobra de verdade.' },
  { icon: Building2, title: 'Renda de FII e ações', text: 'Quanto e quando cada fundo paga, direto da B3.' },
  { icon: Users, title: 'Para a família', text: 'Compartilhe contas e cartões com quem divide as despesas.' },
];

/**
 * Tela de entrada: apresenta o produto e deixa o formulário à mão.
 * Celular: chamada curta + formulário logo abaixo, demonstração e recursos depois.
 * Computador: apresentação à esquerda, formulário fixo à direita.
 */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const brand = useBrand();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* apresentação */}
      <section className="relative overflow-hidden bg-[linear-gradient(155deg,var(--hero-from),var(--hero-to))] text-white lg:order-1" aria-label={`Conheça o ${brand.app_name}`}>
        <div className="pointer-events-none absolute -left-32 -top-32 size-[420px] rounded-full bg-brand/25 blur-[110px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 right-0 size-[380px] rounded-full bg-sky-500/15 blur-[120px]" aria-hidden />
        <div className="pt-safe relative mx-auto flex h-full max-w-2xl flex-col">
          <div className="flex h-full flex-col px-5 pb-8 pt-6 sm:px-10 lg:px-14 lg:py-12">
          <Logo />
          <div className="mt-7 lg:mt-14">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[12px] font-semibold text-emerald-200">
              <Sparkles className="size-3.5" aria-hidden /> Gratuito · sem anúncios · feito para o Brasil
            </p>
            <p className="mt-4 font-display text-[30px] font-semibold leading-[1.1] tracking-tight sm:text-[40px] lg:text-[48px]">
              Seu dinheiro no{' '}
              <span className="bg-[linear-gradient(90deg,#34d399,#38bdf8)] bg-clip-text text-transparent">piloto automático</span>.
            </p>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-white/70 sm:text-[17px]">
              Fale um gasto e ele é salvo. Saiba quanto vai sobrar até o salário. Descubra onde economizar, sem planilha e sem culpa.
            </p>
          </div>

          {/* celular: só os destaques em chips; a demonstração vem depois do formulário */}
          <ul className="scrollbar-none -mx-5 mt-5 flex gap-2 overflow-x-auto px-5 lg:hidden" aria-label="Destaques">
            {FEATURES.slice(0, 4).map((f) => (
              <li key={f.title} className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[13px] font-medium">
                <f.icon className="size-3.5 text-emerald-300" aria-hidden />
                {f.title}
              </li>
            ))}
          </ul>

          <div className="mt-10 hidden lg:block">
            <LiveDemo />
          </div>
          <ul className="mt-10 hidden grid-cols-2 gap-x-6 gap-y-5 lg:grid" aria-label="Recursos">
            {FEATURES.map((f) => <Feature key={f.title} {...f} />)}
          </ul>
          <Trust className="mt-auto hidden pt-10 lg:flex" />
          </div>
        </div>
      </section>

      {/* formulário */}
      <div className="flex flex-col lg:order-2 lg:min-h-dvh">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-8 sm:px-0 lg:py-12">
          <div className="rounded-3xl border border-line bg-surface p-6 shadow-float sm:p-7 lg:p-8">
            <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
            <div className="mt-6">{children}</div>
            {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-[12px] text-subtle">
            <ShieldCheck className="size-3.5" aria-hidden /> Conexão criptografada. Nunca pedimos senhas de banco.
          </p>
        </div>

        {/* celular: demonstração e recursos depois do formulário */}
        <section className="border-t border-line bg-[linear-gradient(180deg,var(--hero-to),var(--hero-from))] px-5 py-10 text-white lg:hidden" aria-label="Como funciona">
          <h2 className="font-display text-[22px] font-semibold tracking-tight">Veja como é simples</h2>
          <div className="mt-5"><LiveDemo /></div>
          <ul className="mt-8 grid gap-5" aria-label="Recursos">
            {FEATURES.map((f) => <Feature key={f.title} {...f} />)}
          </ul>
          <Trust className="mt-8 flex" />
        </section>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: (typeof FEATURES)[number]) {
  return (
    <li className="flex gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-emerald-300 ring-1 ring-white/10">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-[13px] leading-snug text-white/60">{text}</p>
      </div>
    </li>
  );
}

function Trust({ className }: { className?: string }) {
  const items = [
    { icon: ShieldCheck, text: 'Dados protegidos e só seus' },
    { icon: Smartphone, text: 'Funciona como app no celular' },
    { icon: Users, text: 'Compartilhe com a família' },
  ];
  return (
    <ul className={cn('flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/60', className)} aria-label="Por que confiar">
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-1.5">
          <i.icon className="size-4 text-emerald-300" aria-hidden /> {i.text}
        </li>
      ))}
    </ul>
  );
}

const PHRASE = 'gastei 100 de gasolina e 35 no mercado';

/** Demonstração animada (dados fictícios): fala → lançamentos salvos → previsão. */
function LiveDemo() {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const total = PHRASE.length + 22;
  const [step, setStep] = useState(reduced ? total : 0);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setStep((s) => (s >= total + 14 ? 0 : s + 1)), 70);
    return () => window.clearInterval(id);
  }, [reduced, total]);
  const typed = PHRASE.slice(0, Math.min(step, PHRASE.length));
  const saved = step - PHRASE.length; // depois de "falar"
  const rows = [
    { d: 'Gasolina', c: 'Transporte', v: '− R$ 100,00' },
    { d: 'Mercado', c: 'Alimentação', v: '− R$ 35,00' },
  ];
  const bars = [62, 58, 55, 49, 46, 41, 38, 92, 88, 84];
  return (
    <div className="relative w-full max-w-md" aria-hidden>
      <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur sm:p-5">
        <div className="flex items-center gap-3">
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#06281d]', saved < 0 && 'animate-pulse')}>
            <Mic className="size-5" />
          </span>
          <p className="min-h-[1.5em] flex-1 rounded-2xl bg-white/[0.07] px-3 py-2 text-[14px] text-white/85">
            “{typed}
            {saved < 0 && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-emerald-300" />}
            {saved >= 0 && '”'}
          </p>
        </div>
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li
              key={r.d}
              className={cn('flex items-center gap-3 rounded-2xl bg-white/[0.05] px-3 py-2.5 transition duration-500', saved > 3 + i * 5 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0')}
            >
              <span className="grid size-6 place-items-center rounded-full bg-emerald-400/20 text-emerald-300"><Check className="size-3.5" /></span>
              <span className="flex-1 text-[14px]">
                {r.d} <span className="text-[12px] text-white/50">· {r.c} · hoje</span>
              </span>
              <span className="font-num text-[14px] text-rose-300">{r.v}</span>
            </li>
          ))}
        </ul>
        <div className={cn('mt-3 rounded-2xl bg-white/[0.05] px-3 py-3 transition duration-500', saved > 14 ? 'opacity-100' : 'opacity-40')}>
          <div className="flex items-baseline justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-white/50">Previsão até o salário</p>
            <p className="font-num text-[15px] font-semibold text-emerald-300">sobram R$ 1.240</p>
          </div>
          <div className="mt-2 flex h-10 items-end gap-1">
            {bars.map((h, i) => (
              <span key={i} className={cn('flex-1 rounded-t-sm', i >= 7 ? 'bg-emerald-400/70' : 'bg-sky-400/50')} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-white/40">Demonstração com dados fictícios</p>
    </div>
  );
}
