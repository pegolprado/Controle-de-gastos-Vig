import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { QuickAddProvider } from '@/features/transactions/QuickAdd';
import { FullScreenLoader, PublicOnly, RequireAppOwner, RequireAuth } from '@/app/guards';
import { MaintenanceBanner } from '@/app/MaintenanceBanner';
import { UpdatePrompt } from '@/pwa/UpdatePrompt';
import { RouteError } from '@/app/ErrorBoundary';
import { BASE_URL } from '@/lib/appUrl';

// Carregamento sob demanda: cada tela é um módulo separado.
const Dashboard = lazy(() => import('@/features/dashboard/DashboardPage'));
const Transactions = lazy(() => import('@/features/transactions/TransactionsPage'));
const Accounts = lazy(() => import('@/features/accounts/AccountsPage'));
const AccountDetail = lazy(() => import('@/features/accounts/AccountDetailPage'));
const Cards = lazy(() => import('@/features/cards/CardsPage'));
const CardDetail = lazy(() => import('@/features/cards/CardDetailPage'));
const Bills = lazy(() => import('@/features/bills/BillsPage'));
const Budgets = lazy(() => import('@/features/budgets/BudgetsPage'));
const Goals = lazy(() => import('@/features/goals/GoalsPage'));
const Recurrences = lazy(() => import('@/features/recurrences/RecurrencesPage'));
const Reports = lazy(() => import('@/features/reports/ReportsPage'));
const Fii = lazy(() => import('@/features/fii/FiiPage'));
const Workspace = lazy(() => import('@/features/workspace/WorkspacePage'));
const Settings = lazy(() => import('@/features/settings/SettingsPage'));
const Categories = lazy(() => import('@/features/settings/CategoriesPage'));
const Admin = lazy(() => import('@/features/admin/AdminPage'));
const Login = lazy(() => import('@/features/auth/LoginPage'));
const Signup = lazy(() => import('@/features/auth/SignupPage'));
const Recover = lazy(() => import('@/features/auth/RecoverPage').then((m) => ({ default: m.RecoverPage })));
const ResetPassword = lazy(() => import('@/features/auth/RecoverPage').then((m) => ({ default: m.ResetPasswordPage })));
const Callback = lazy(() => import('@/features/auth/CallbackPage'));
const Invite = lazy(() => import('@/features/auth/InvitePage'));
const Privacy = lazy(() => import('@/features/auth/PrivacyPage'));
const NotFound = lazy(() => import('@/app/NotFound'));

function Root() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Outlet />
      <UpdatePrompt />
    </Suspense>
  );
}

function Protected() {
  return (
    <RequireAuth>
      <QuickAddProvider>
        <AppShell banner={<MaintenanceBanner />} />
      </QuickAddProvider>
    </RequireAuth>
  );
}

const router = createBrowserRouter(
  [
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/entrar', element: <PublicOnly><Login /></PublicOnly> },
      { path: '/cadastro', element: <PublicOnly><Signup /></PublicOnly> },
      { path: '/recuperar', element: <PublicOnly><Recover /></PublicOnly> },
      { path: '/redefinir-senha', element: <ResetPassword /> },
      { path: '/auth/callback', element: <Callback /> },
      { path: '/convite/:token', element: <Invite /> },
      { path: '/privacidade', element: <Privacy /> },
      {
        element: <Protected />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'lancamentos', element: <Transactions /> },
          { path: 'contas', element: <Accounts /> },
          { path: 'contas/:id', element: <AccountDetail /> },
          { path: 'cartoes', element: <Cards /> },
          { path: 'cartoes/:id', element: <CardDetail /> },
          { path: 'compromissos', element: <Bills /> },
          { path: 'orcamentos', element: <Budgets /> },
          { path: 'metas', element: <Goals /> },
          { path: 'recorrencias', element: <Recurrences /> },
          { path: 'relatorios', element: <Reports /> },
          { path: 'renda-fii', element: <Fii /> },
          { path: 'espaco', element: <Workspace /> },
          { path: 'ajustes', element: <Settings /> },
          { path: 'categorias', element: <Categories /> },
          { path: 'admin', element: <RequireAppOwner><Admin /></RequireAppOwner> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  ],
  { basename: BASE_URL.replace(/\/$/, '') || '/' },
);

export default function App() {
  return <RouterProvider router={router} />;
}
