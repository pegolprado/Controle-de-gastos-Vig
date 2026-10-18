import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './app/auth'
import { CaseLayout, Shell } from './app/layout'
import { Loading } from './components/ui'
import Login, { FirstSetup, ForgotPassword, ResetPassword } from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Catalog = lazy(() => import('./pages/Catalog'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const AdminUsers = lazy(() => import('./pages/admin/Users'))
const Overview = lazy(() => import('./pages/case/Overview'))
const Targets = lazy(() => import('./pages/case/Targets'))
const Files = lazy(() => import('./pages/case/Files'))
const ImportWizard = lazy(() => import('./pages/case/ImportWizard'))
const Imports = lazy(() => import('./pages/case/Imports'))
const Quality = lazy(() => import('./pages/case/Quality'))
const Events = lazy(() => import('./pages/case/Events'))
const EventDetail = lazy(() => import('./pages/case/EventDetail'))
const Contacts = lazy(() => import('./pages/case/Contacts'))
const Compare = lazy(() => import('./pages/case/Compare'))
const Links = lazy(() => import('./pages/case/Links'))
const Erb = lazy(() => import('./pages/case/Erb'))
const Registry = lazy(() => import('./pages/case/Registry'))
const GeoMap = lazy(() => import('./pages/case/GeoMap'))
const Timeline = lazy(() => import('./pages/case/Timeline'))
const Stats = lazy(() => import('./pages/case/Stats'))
const CrossMatch = lazy(() => import('./pages/case/CrossMatch'))
const Alerts = lazy(() => import('./pages/case/Alerts'))
const Reports = lazy(() => import('./pages/case/Reports'))
const Assistant = lazy(() => import('./pages/case/Assistant'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Loading />
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (me.must_change_password && loc.pathname !== '/configuracoes') return <Navigate to="/configuracoes?trocar=1" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
          <Route path="/primeiro-acesso" element={<FirstSetup />} />
          <Route
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="ferramentas" element={<Catalog />} />
            <Route path="configuracoes" element={<SettingsPage />} />
            <Route path="admin/usuarios" element={<AdminUsers />} />
            <Route path="analise" element={<CaseLayout />}>
              <Route index element={<Overview />} />
              <Route path="alvos" element={<Targets />} />
              <Route path="arquivos" element={<Files />} />
              <Route path="importar/:fileId" element={<ImportWizard />} />
              <Route path="importacoes" element={<Imports />} />
              <Route path="qualidade" element={<Quality />} />
              <Route path="eventos" element={<Events />} />
              <Route path="eventos/:eventId" element={<EventDetail />} />
              <Route path="contatos" element={<Contacts />} />
              <Route path="comparar" element={<Compare />} />
              <Route path="vinculos" element={<Links />} />
              <Route path="erb" element={<Erb />} />
              <Route path="erb/cadastro" element={<Registry />} />
              <Route path="mapa" element={<GeoMap />} />
              <Route path="linha-do-tempo" element={<Timeline />} />
              <Route path="estatistica" element={<Stats />} />
              <Route path="cruzamento" element={<CrossMatch />} />
              <Route path="alertas" element={<Alerts />} />
              <Route path="relatorios" element={<Reports />} />
              <Route path="assistente" element={<Assistant />} />
            </Route>
            <Route path="casos/*" element={<Navigate to="/analise" replace />} />
            <Route path="*" element={<div className="py-20 text-center text-muted">Página não encontrada.</div>} />
          </Route>
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
