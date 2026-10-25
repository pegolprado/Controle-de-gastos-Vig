import { ArrowLeftRight, LineChart, PiggyBank, BarChart3, Building2, CalendarClock, CreditCard, Gauge, Landmark, PieChart, Repeat, Settings, Shield, Target, Users } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Painel', icon: Gauge, end: true },
  { to: '/lancamentos', label: 'Lançamentos', icon: ArrowLeftRight },
  { to: '/contas', label: 'Contas', icon: Landmark },
  { to: '/cartoes', label: 'Cartões', icon: CreditCard },
  { to: '/compromissos', label: 'Compromissos', icon: CalendarClock },
  { to: '/previsao', label: 'Previsão', icon: LineChart },
  { to: '/economia', label: 'Economia', icon: PiggyBank },
  { to: '/orcamentos', label: 'Orçamentos', icon: PieChart },
  { to: '/metas', label: 'Metas', icon: Target },
  { to: '/recorrencias', label: 'Recorrências', icon: Repeat },
  { to: '/renda-fii', label: 'Renda FII', icon: Building2 },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
] as const;

export const NAV_SECONDARY = [
  { to: '/espaco', label: 'Compartilhamento', icon: Users },
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
] as const;

export const NAV_ADMIN = { to: '/admin', label: 'Administração', icon: Shield } as const;

/** Itens da barra inferior no celular (o "+" central fica entre eles). */
export const MOBILE_NAV = [
  { to: '/', label: 'Painel', icon: Gauge, end: true },
  { to: '/lancamentos', label: 'Extrato', icon: ArrowLeftRight },
  { to: '/compromissos', label: 'Agenda', icon: CalendarClock },
] as const;
