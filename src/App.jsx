// src/App.jsx
// Configuración central de React Router v7
// Rutas públicas, protegidas y exclusivas de supervisor
import { useEffect } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import useAuthStore from './store/useAuthStore'

// Layout
import AppLayout from './components/layout/AppLayout'

// Auth
import LoginPage from './modules/auth/LoginPage'

// Views
import DashboardView    from './views/DashboardView'
import ClientesView     from './views/ClientesView'
import CotizacionesView from './views/CotizacionesView'
import InventarioView   from './views/InventarioView'
import TransportistasView from './views/TransportistasView'
import UsuariosView     from './views/UsuariosView'
import AuditoriaView    from './views/AuditoriaView'

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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-lg font-medium">Cargando...</p>
      </div>
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
            <Route path="/usuarios"  element={<UsuariosView />} />
            <Route path="/auditoria" element={<AuditoriaView />} />
          </Route>
        </Route>
      </Route>

      {/* Cualquier ruta desconocida → dashboard (o login si no hay sesión) */}
      <Route path="*" element={<Navigate to="/" replace />} />

    </Routes>
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
