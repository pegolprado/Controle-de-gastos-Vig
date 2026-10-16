import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Money } from '@/components/ui/Money';
import type { CategoryTotal } from '@/lib/types';

/** Ranking horizontal de categorias (mais legível que pizza para comparar). */
export function CategoryBars({ data, limit = 6, onSelect }: { data: CategoryTotal[]; limit?: number; onSelect?: (c: CategoryTotal) => void }) {
  const total = data.reduce((a, c) => a + c.total_cents, 0);
  const max = Math.max(...data.map((c) => c.total_cents), 1);
  const shown = data.slice(0, limit);
  const rest = data.slice(limit);
  const others = rest.reduce((a, c) => a + c.total_cents, 0);
  const rows = others > 0 ? [...shown, { category_id: 'others', name: `Outras (${rest.length})`, color: '#64748b', icon: 'circle-dashed', total_cents: others, items: 0 }] : shown;
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((c) => {
        const pct = total ? (c.total_cents / total) * 100 : 0;
        return (
          <li key={c.category_id ?? 'none'}>
            <button
              type="button"
              disabled={!onSelect || c.category_id === 'others'}
              onClick={() => onSelect?.(c)}
              className="group flex w-full items-center gap-3 text-left disabled:cursor-default"
              title={`${c.name}: ${pct.toFixed(1).replace('.', ',')}% do total`}
            >
              <CategoryIcon icon={c.icon} color={c.color} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium group-enabled:group-hover:underline">{c.name}</span>
                  <span className="shrink-0 text-[13px] text-subtle">{pct.toFixed(0)}%</span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${(c.total_cents / max) * 100}%`, backgroundColor: c.color }} />
                </span>
              </span>
              <Money cents={c.total_cents} className="w-24 text-right text-sm font-semibold" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
