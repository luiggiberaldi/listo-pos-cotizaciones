// src/App.jsx
// Configuración central de React Router v7
// Rutas públicas, protegidas y exclusivas de supervisor
import { useEffect, lazy, Suspense } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import useAuthStore from './store/useAuthStore'

// Layout (se carga siempre con las rutas protegidas)
import AppLayout from './components/layout/AppLayout'

// Auth (se carga siempre en /login)
import LoginPage from './modules/auth/LoginPage'

// Views — lazy loading para que solo se descarguen al navegar
const DashboardView     = lazy(() => import('./views/DashboardView'))
const ClientesView      = lazy(() => import('./views/ClientesView'))
const CotizacionesView  = lazy(() => import('./views/CotizacionesView'))
const InventarioView    = lazy(() => import('./views/InventarioView'))
const TransportistasView = lazy(() => import('./views/TransportistasView'))
const UsuariosView      = lazy(() => import('./views/UsuariosView'))
const AuditoriaView     = lazy(() => import('./views/AuditoriaView'))
const ConfiguracionView = lazy(() => import('./views/ConfiguracionView'))

// ─── QueryClient (instancia única) ────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,  // 5 minutos
      retry: 1,
    },
  },
})

// ─── Pantalla de carga mientras se verifica la sesión ─────────────────────────
function PantallaCarga() {
  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #ecfdf5 100%)' }}>
      <div className="flex flex-col items-center gap-4">
        <img src="/logo.png" alt="Listo POS" className="h-24 w-auto object-contain opacity-90" />
        <div className="w-8 h-8 border-[3px] border-sky-300 border-t-sky-500 rounded-full animate-spin" />
      </div>
    </div>
  )
}

// ─── Fallback para lazy loading de vistas ────────────────────────────────────
function ViewLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-[3px] border-sky-300 border-t-sky-500 rounded-full animate-spin" />
    </div>
  )
}

// ─── Ruta protegida: requiere sesión activa ────────────────────────────────────
// Si aún se está verificando la sesión → pantalla de carga
// Si no hay sesión → redirige a /login
function RutaProtegida() {
  const { perfil, initialized } = useAuthStore()

  if (!initialized) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  return <Outlet />
}

// ─── Ruta pública: redirige a / si ya hay sesión ──────────────────────────────
function RutaPublica() {
  const { perfil, initialized } = useAuthStore()

  if (!initialized) return <PantallaCarga />
  if (perfil) return <Navigate to="/" replace />
  return <Outlet />
}

// ─── Ruta exclusiva de supervisor ─────────────────────────────────────────────
// Requiere sesión activa Y rol supervisor
// Si el usuario es vendedor → redirige al dashboard
function RutaSupervisor() {
  const { perfil, initialized } = useAuthStore()

  if (!initialized) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (perfil.rol !== 'supervisor') return <Navigate to="/" replace />
  return <Outlet />
}

// ─── App raíz ─────────────────────────────────────────────────────────────────
function AppRoutes() {
  const initialize = useAuthStore((s) => s.initialize)

  // Inicializar listener de auth una sola vez al montar la app
  useEffect(() => {
    const cleanup = initialize()
    return cleanup
  }, [initialize])

  return (
    <Suspense fallback={<ViewLoader />}>
      <Routes>

        {/* Rutas públicas (no accesibles si ya hay sesión) */}
        <Route element={<RutaPublica />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        {/* Rutas protegidas para todos los roles */}
        <Route element={<RutaProtegida />}>
          <Route element={<AppLayout />}>
            <Route path="/"               element={<DashboardView />} />
            <Route path="/clientes"       element={<ClientesView />} />
            <Route path="/cotizaciones"   element={<CotizacionesView />} />
            <Route path="/inventario"     element={<InventarioView />} />
            <Route path="/transportistas" element={<TransportistasView />} />

            {/* Rutas exclusivas de supervisor */}
            <Route element={<RutaSupervisor />}>
              <Route path="/usuarios"      element={<UsuariosView />} />
              <Route path="/auditoria"     element={<AuditoriaView />} />
              <Route path="/configuracion" element={<ConfiguracionView />} />
            </Route>
          </Route>
        </Route>

        {/* Cualquier ruta desconocida → dashboard (o login si no hay sesión) */}
        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </Suspense>
  )
}

// ─── Componente raíz con providers ────────────────────────────────────────────
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
