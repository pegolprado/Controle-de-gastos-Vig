import { useBrand } from '@/app/BrandProvider';
import { cn } from '@/lib/cn';
import { BASE_URL } from '@/lib/appUrl';

export function LogoMark({ className }: { className?: string }) {
  const brand = useBrand();
  const src = brand.logo_url || `${BASE_URL}logo-mark.png`;
  return <img src={src} alt="" width={36} height={36} className={cn('size-9 shrink-0 rounded-full object-cover', className)} />;
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
