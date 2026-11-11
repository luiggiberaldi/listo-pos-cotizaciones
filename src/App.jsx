// src/App.jsx
// Configuración central de React Router v7
// Rutas públicas, protegidas y exclusivas de supervisor
import { useState, useEffect, lazy, Suspense, useCallback } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import queryClient from './lib/queryClient'
import { indexedDbPersister, CACHE_BUSTER } from './lib/queryPersister'
import { mayPersistQuery } from './utils/dashboardAccess'
import OfflineBanner from './components/ui/OfflineBanner'
import AvisoVersionNueva from './components/ui/AvisoVersionNueva'
import useAuthStore from './store/useAuthStore'
import { ToastProvider } from './components/ui/Toast'
import { ErrorBoundary } from './components/ui/ErrorBoundary'

// Layout (se carga siempre con las rutas protegidas)
import AppLayout from './components/layout/AppLayout'

// Auth (se carga siempre en /login)
import LoginPage from './modules/auth/LoginPage'

// ─── Lazy import con retry automático para chunks obsoletos ──────────────────
function lazyRetry(importFn) {
  return lazy(() =>
    importFn().catch((err) => {
      // Si falla la carga de un módulo dinámico (chunks viejos tras un deploy),
      // recargar la página una sola vez para obtener los chunks nuevos
      const key = 'lazy_retry_reload'
      const lastReload = sessionStorage.getItem(key)
      const now = Date.now()
      if (!lastReload || now - Number(lastReload) > 10000) {
        sessionStorage.setItem(key, String(now))
        window.location.reload()
      }
      throw err
    })
  )
}

// Dashboard — preloaded since it's the default route
const DashboardView = lazyRetry(() => import('./views/DashboardView'))
// Preload Dashboard chunk in idle time
if (typeof window !== 'undefined') {
  const preloadDashboard = () => import('./views/DashboardView')
  if ('requestIdleCallback' in window) {
    requestIdleCallback(preloadDashboard)
  } else {
    setTimeout(preloadDashboard, 200)
  }
}

// Views — lazy loading para que solo se descarguen al navegar
const ClientesView      = lazyRetry(() => import('./views/ClientesView'))
const PersonalView      = lazyRetry(() => import('./views/PersonalView'))
const CotizacionesView  = lazyRetry(() => import('./views/CotizacionesView'))
const DespachosView     = lazyRetry(() => import('./views/DespachosView'))
const VentaRapidaView   = lazyRetry(() => import('./views/VentaRapidaView'))
const MisVentasView     = lazyRetry(() => import('./views/MisVentasView'))
const InventarioView    = lazyRetry(() => import('./views/InventarioView'))
const TransportistasView = lazyRetry(() => import('./views/TransportistasView'))
const UsuariosView      = lazyRetry(() => import('./views/UsuariosView'))
// Auditoría activada exclusivamente para desarrollador
const AuditoriaView     = lazyRetry(() => import('./views/AuditoriaView'))
const ConfiguracionView = lazyRetry(() => import('./views/ConfiguracionView'))
const ComisionesView    = lazyRetry(() => import('./views/ComisionesView'))
const ReportesView      = lazyRetry(() => import('./views/ReportesView'))
const ProveedoresView   = lazyRetry(() => import('./views/ProveedoresView'))
const LogsView              = lazyRetry(() => import('./views/LogsView'))
const ReporteVendedoresView = lazyRetry(() => import('./views/ReporteVendedoresView'))
const OrdenCompraView       = lazyRetry(() => import('./views/OrdenCompraView'))
const TesterView        = lazyRetry(() => import('./views/TesterView'))
const TesterFlowView    = lazyRetry(() => import('./views/TesterFlowView'))
const TutorialView      = lazyRetry(() => import('./views/TutorialView'))

// ─── Precarga de las pantallas más usadas (OP-2026-021) ──────────────────────
// Al entrar con el PIN se descargan en segundo plano, de una en una y solo cuando
// el navegador está libre, para que el primer cambio de pestaña no tenga que esperar.
// Si falla (sin red, versión vieja) no pasa nada: la pantalla se pide al abrirla.
const PRECARGA_COMUN = [
  () => import('./views/DespachosView'),
  () => import('./views/InventarioView'),
]
const PRECARGA_VENTAS = [
  () => import('./views/CotizacionesView'),
  () => import('./views/VentaRapidaView'),
]
let precargaHecha = false

function precargarPantallas(rol) {
  if (precargaHecha || typeof window === 'undefined') return
  if (navigator.connection?.saveData) return // respeta el "ahorro de datos" del teléfono
  precargaHecha = true
  const cola = rol === 'logistica' ? [...PRECARGA_COMUN] : [...PRECARGA_VENTAS, ...PRECARGA_COMUN]
  const enReposo = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 1500))
  const siguiente = () => {
    const cargar = cola.shift()
    if (!cargar) return
    cargar().catch(() => {}).finally(() => enReposo(siguiente))
  }
  enReposo(siguiente)
}

// ─── QueryClient — importado desde lib/queryClient.js ────────────────────────



// ─── Pantalla de carga mientras se verifica la sesión ─────────────────────────
function PantallaCarga() {
  const [showRetry, setShowRetry] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShowRetry(true), 6000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a1a0f 100%)' }}>
      <div className="flex flex-col items-center gap-6">
        <img src="/logo.png" alt="Construacero Carabobo" className="h-32 md:h-48 w-auto object-contain opacity-90 drop-shadow-2xl" />
        <div className="loader">
          <div className="loader-square" />
          <div className="loader-square" />
          <div className="loader-square" />
          <div className="loader-square" />
          <div className="loader-square" />
          <div className="loader-square" />
          <div className="loader-square" />
        </div>
        {showRetry && (
          <button type="button"
            onClick={() => {
              // Limpiar service worker cache y recargar
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(regs => {
                  regs.forEach(r => r.unregister())
                })
                caches.keys().then(names => {
                  names.forEach(name => caches.delete(name))
                })
              }
              window.location.reload()
            }}
            className="mt-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white/80 text-sm font-semibold rounded-xl backdrop-blur-sm transition-all active:scale-95 border border-white/10">
            Toca aquí si no carga
          </button>
        )}
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
  // Selector estable: solo re-renderizar cuando cambian campos relevantes para routing
  // (NO suscribirse a 'user' directamente — TOKEN_REFRESHED lo actualiza frecuentemente)
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  return <Outlet />
}

// ─── Ruta pública: redirige a / si ya hay sesión ──────────────────────────────
function RutaPublica() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))

  if (!initialized) return <PantallaCarga />
  if (perfil) return <Navigate to="/" replace />
  return <Outlet />
}

// ─── Ruta exclusiva de supervisor ─────────────────────────────────────────────
// Requiere sesión activa Y rol supervisor
// Si el usuario es vendedor → redirige al dashboard
function RutaSupervisor() {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (perfil.rol !== 'supervisor' && perfil.rol !== 'desarrollador' && perfil.rol !== 'jefe') return <Navigate to="/" replace />
  return <Outlet />
}

// ─── Ruta por lista de roles ──────────────────────────────────────────────────
// Para pantallas que el supervisor NO debe abrir (Configuración, Usuarios, Reporte Vendedores)
function RutaRoles({ roles }) {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (!roles.includes(perfil.rol)) return <Navigate to="/" replace />
  return <Outlet />
}

// ─── Ruta para supervisor O administracion ───────────────────────────────────
// Para secciones compartidas como reportes
function RutaSupervisorOAdmin() {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (perfil.rol !== 'supervisor' && perfil.rol !== 'administracion' && perfil.rol !== 'desarrollador' && perfil.rol !== 'jefe') return <Navigate to="/" replace />
  return <Outlet />
}

// ─── Ruta de Reportes: administración, jefe, desarrollador y logística ────────
// Logística entra solo para la pestaña Transportistas (ReportesView filtra el resto).
function RutaReportes() {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (!['administracion', 'desarrollador', 'jefe', 'logistica'].includes(perfil.rol)) return <Navigate to="/" replace />
  return <Outlet />
}

// ─── Ruta exclusiva de administración (y desarrollador) —————————————————─
function RutaSoloAdmin() {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (perfil.rol !== 'administracion' && perfil.rol !== 'desarrollador' && perfil.rol !== 'jefe') return <Navigate to="/" replace />
  return <Outlet />
}

// ─── Ruta exclusiva de desarrollador ──────────────────────────────────────────
function RutaDesarrollador() {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (perfil.rol !== 'desarrollador') return <Navigate to="/" replace />
  return <Outlet />
}


// ─── Ruta exclusiva de vendedores ─────────────────────────────────────────────
// ─── Ruta "Mis ventas": vendedores y supervisor (cada uno ve solo lo suyo) ─────
function RutaVentasPropias() {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (!['vendedor', 'vendedor_sin_comision', 'supervisor'].includes(perfil.rol)) return <Navigate to="/" replace />
  return <Outlet />
}

function RutaSoloVendedor() {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))

  if (!initialized) return <PantallaCarga />
  if (!perfil && hasUser && cargandoPerfil) return <PantallaCarga />
  if (!perfil) return <Navigate to="/login" replace />
  if (perfil.rol !== 'vendedor' && perfil.rol !== 'vendedor_sin_comision') return <Navigate to="/" replace />
  return <Outlet />
}

// ─── App raíz ─────────────────────────────────────────────────────────────────
let authInitializationPromise = null

function AppRoutes() {
  const initialize = useAuthStore((s) => s.initialize)

  // StrictMode desmonta/remonta efectos en desarrollo. Reutilizar la misma
  // inicialización evita listeners concurrentes y locks de Supabase huérfanos.
  useEffect(() => {
    if (!authInitializationPromise) {
      authInitializationPromise = Promise.resolve(initialize())
    }
    return () => {
      // No desuscribir durante el remount de StrictMode; el singleton vive con
      // la aplicación y se limpia solo al recargar la página.
    }
  }, [initialize])

  const perfil = useAuthStore(s => s.perfil)

  // Aplicar modo accesible desde localStorage al montar y al cambiar de cuenta
  useEffect(() => {
    // Si no hay perfil, podemos dejar el estado actual o limpiar
    if (!perfil?.cuenta_id) return

    const key = `modo-accesible-${perfil.cuenta_id}`
    const isEnabled = localStorage.getItem(key) === '1'
    
    document.documentElement.classList.toggle('modo-accesible', isEnabled)
  }, [perfil?.cuenta_id])

  // Precargar las pantallas principales una vez que hay un operador dentro
  useEffect(() => {
    if (perfil?.id) precargarPantallas(perfil.rol)
  }, [perfil?.id, perfil?.rol])

  // Limpiar zoom legacy
  useEffect(() => {
    localStorage.removeItem('app-zoom')
    document.documentElement.style.removeProperty('zoom')
    document.documentElement.style.removeProperty('--app-zoom')
  }, [])

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
            <Route path="/despachos"      element={<DespachosView />} />
            <Route path="/inventario"     element={<InventarioView />} />
            <Route path="/cotizaciones"   element={<CotizacionesView />} />
            <Route path="/venta-rapida"   element={<VentaRapidaView />} />
            <Route path="/comisiones"    element={<ComisionesView />} />
            
            <Route element={<RutaSoloVendedor />}>
              <Route path="/tutorial"      element={<TutorialView />} />
            </Route>

            {/* Mis ventas: el servidor devuelve solo las ventas del operador de la sesión */}
            <Route element={<RutaVentasPropias />}>
              <Route path="/mis-ventas"    element={<MisVentasView />} />
            </Route>

            {/* Transportistas: todos los roles (logística incluida: crea choferes y camiones) */}
            <Route path="/transportistas" element={<TransportistasView />} />

            {/* Reportes y Personal: solo administracion, jefe y desarrollador */}
            <Route element={<RutaSoloAdmin />}>
              <Route path="/personal"      element={<PersonalView />} />
              <Route path="/proveedores"   element={<ProveedoresView />} />
            </Route>

            {/* Reportes: logística solo ve la pestaña Transportistas */}
            <Route element={<RutaReportes />}>
              <Route path="/reportes"      element={<ReportesView />} />
            </Route>

            {/* Configuración: administración, jefe y desarrollador (el supervisor no entra) */}
            <Route element={<RutaRoles roles={['administracion', 'jefe', 'desarrollador']} />}>
              <Route path="/configuracion" element={<ConfiguracionView />} />
            </Route>

            {/* Usuarios y Reporte Vendedores: jefe y desarrollador (el supervisor no entra) */}
            <Route element={<RutaRoles roles={['jefe', 'desarrollador']} />}>
              <Route path="/usuarios"             element={<UsuariosView />} />
              <Route path="/reporte-vendedores"   element={<ReporteVendedoresView />} />
            </Route>

            {/* Orden de compra: supervisor, jefe y desarrollador */}
            <Route element={<RutaSupervisor />}>
              <Route path="/orden-compra"         element={<OrdenCompraView />} />
            </Route>

            {/* Rutas exclusivas de desarrollador */}
            <Route element={<RutaDesarrollador />}>
              <Route path="/logs"          element={<LogsView />} />
              <Route path="/tester"        element={<TesterView />} />
              <Route path="/tester-flow"   element={<TesterFlowView />} />
            </Route>

            {/* Rutas para supervisor, admin, jefe y desarrollador */}
            <Route element={<RutaSupervisorOAdmin />}>
              <Route path="/auditoria"     element={<AuditoriaView />} />
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
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: indexedDbPersister,
          maxAge: 1000 * 60 * 60 * 24,            // 24h — coincide con gcTime
          buster: CACHE_BUSTER,                   // git hash → invalida en cada deploy
          dehydrateOptions: {
            shouldDehydrateQuery: mayPersistQuery,
          },
        }}>
        <BrowserRouter unstable_useTransitions={false}>
          <ToastProvider>
            <OfflineBanner>
              <AppRoutes />
            </OfflineBanner>
            <AvisoVersionNueva />
          </ToastProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  )
}
