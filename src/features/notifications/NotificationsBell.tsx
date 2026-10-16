import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CalendarClock, PieChart } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { listNotifications, markAllRead, markRead } from '@/services/notifications';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data = [] } = useQuery({ queryKey: ['notifications'], queryFn: listNotifications, refetchInterval: 5 * 60_000 });
  const unread = data.filter((n) => !n.read_at).length;
  const readAll = useMutation({ mutationFn: markAllRead, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const icon = (k: string) => (k === 'budget' ? PieChart : k === 'overdue' ? AlertTriangle : CalendarClock);

  return (
    <div className="relative">
      <IconButton label={unread ? `Notificações (${unread} não lidas)` : 'Notificações'} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-negative ring-2 ring-bg" aria-hidden />}
      </IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed inset-x-3 top-16 z-40 animate-rise overflow-hidden rounded-2xl border border-line bg-elevated shadow-float sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Notificações</h2>
              {unread > 0 && (
                <button type="button" className="text-[13px] font-semibold text-brand" onClick={() => readAll.mutate()}>
                  Marcar todas como lidas
                </button>
              )}
            </div>
            <ul className="max-h-[60dvh] overflow-y-auto">
              {data.length === 0 && <li className="px-4 py-8 text-center text-sm text-subtle">Tudo em dia por aqui.</li>}
              {data.map((n) => {
                const Icon = icon(n.kind);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!n.read_at) void markRead(n.id).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
                        setOpen(false);
                        if (n.link) navigate(n.link);
                      }}
                      className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2', !n.read_at && 'bg-brand/[0.04]')}
                    >
                      <Icon className={cn('mt-0.5 size-4 shrink-0', n.kind === 'overdue' || n.title.includes('estourado') ? 'text-negative' : 'text-warning')} aria-hidden />
                      <span className="min-w-0">
                        <span className={cn('block text-sm', !n.read_at ? 'font-semibold' : 'text-muted')}>{n.title}</span>
                        {n.body && <span className="block text-[13px] text-subtle">{n.body}</span>}
                        <span className="mt-0.5 block text-[11px] text-subtle">{formatDateTime(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-[11px] text-subtle">Alertas exibidos dentro do app. Notificações push não estão ativas.</p>
          </div>
        </>
      )}
    </div>
  );
}
