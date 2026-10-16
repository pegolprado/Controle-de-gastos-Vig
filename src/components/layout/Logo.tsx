import { useBrand } from '@/app/BrandProvider';
import { cn } from '@/lib/cn';

export function LogoMark({ className }: { className?: string }) {
  const brand = useBrand();
  if (brand.logo_url) return <img src={brand.logo_url} alt="" className={cn('size-9 rounded-xl object-cover', className)} />;
  return (
    <svg viewBox="0 0 64 64" className={cn('size-9', className)} aria-hidden>
      <rect width="64" height="64" rx="18" fill="currentColor" className="text-surface-2" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="17.5" fill="none" stroke="currentColor" className="text-line-strong" />
      <rect x="15" y="34" width="8" height="15" rx="3" fill="var(--brand)" opacity=".5" />
      <rect x="28" y="25" width="8" height="24" rx="3" fill="var(--brand)" opacity=".78" />
      <rect x="41" y="15" width="8" height="34" rx="3" fill="var(--brand)" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  const brand = useBrand();
  const [first, ...rest] = brand.app_name.split(' ');
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <span className="font-display text-[17px] font-semibold tracking-tight">
          {first}
          {rest.length > 0 && <span className="text-brand"> {rest.join(' ')}</span>}
        </span>
      )}
    </div>
  );
}
