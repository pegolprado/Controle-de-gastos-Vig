import { Megaphone } from 'lucide-react';
import { useBrand } from './BrandProvider';

export function MaintenanceBanner() {
  const { maintenance_message } = useBrand();
  if (!maintenance_message) return null;
  return (
    <div role="status" className="border-t border-warning/20 bg-warning/10 px-4 py-2 text-center text-[13px] font-medium text-warning">
      <Megaphone className="mr-1.5 inline size-3.5" aria-hidden />
      {maintenance_message}
    </div>
  );
}
