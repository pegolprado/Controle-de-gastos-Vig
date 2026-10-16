import { lazy, Suspense, type ComponentProps } from 'react';
import { Skeleton } from '@/components/ui/Card';

const Bars = lazy(() => import('./Charts').then((m) => ({ default: m.BarsChart })));
const Area = lazy(() => import('./Charts').then((m) => ({ default: m.AreaTrend })));

export function LazyBars(props: ComponentProps<typeof Bars>) {
  return (
    <Suspense fallback={<Skeleton className="w-full" />}>
      <Bars {...props} />
    </Suspense>
  );
}

export function LazyArea(props: ComponentProps<typeof Area>) {
  return (
    <Suspense fallback={<Skeleton className="h-52 w-full" />}>
      <Area {...props} />
    </Suspense>
  );
}

export const SERIES_COLORS = {
  income: 'var(--positive)',
  expense: 'var(--negative)',
  net: 'var(--brand)',
  info: 'var(--info)',
};
