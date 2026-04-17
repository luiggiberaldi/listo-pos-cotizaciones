// src/components/layout/AppLayout.jsx
// Layout principal: sidebar fijo en desktop, drawer en móvil
import { useState, useRef, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Users, FileText, Package, Truck,
  UserCog, ClipboardList,
  LayoutDashboard, Settings, LogOut,
  Menu, X, DollarSign, RefreshCw, PackageCheck, Bell, BellOff,
  AlertTriangle, Send, CheckCircle, Ban,
} from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../auth/LoginAvatar'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { useRealtimeSync } from '../../hooks/useRealtimeSync'
import { useAdminAlerts } from '../../hooks/useAdminAlerts'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { showToast } from '../ui/Toast'
import { NOTIF_TYPES } from '../../services/notificationService'

// ─── Iconos por tipo de notificación ────────────────────────────────────────
const NOTIF_ICON_MAP = {
  [NOTIF_TYPES.STOCK_BAJO]:          { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50' },
  [NOTIF_TYPES.COTIZACION_ENVIADA]:  { icon: Send,          color: 'text-sky-500',   bg: 'bg-sky-50' },
  [NOTIF_TYPES.COTIZACION_ACEPTADA]: { icon: CheckCircle,   color: 'text-emerald-500', bg: 'bg-emerald-50' },
  [NOTIF_TYPES.COTIZACION_CREADA]:   { icon: FileText,      color: 'text-indigo-500', bg: 'bg-indigo-50' },
  [NOTIF_TYPES.DESPACHO_CREADO]:     { icon: Truck,         color: 'text-indigo-500', bg: 'bg-indigo-50' },
  [NOTIF_TYPES.COTIZACION_ANULADA]:  { icon: Ban,           color: 'text-red-500',   bg: 'bg-red-50' },
}
const DEFAULT_NOTIF_ICON = { icon: Bell, color: 'text-slate-400', bg: 'bg-slate-50' }

function NotifIcon({ type }) {
  const { icon: Icon, color, bg } = NOTIF_ICON_MAP[type] || DEFAULT_NOTIF_ICON
  return (
    <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
      <Icon size={16} className={color} />
    </div>
  )
}

// ─── Definición de rutas de navegación ────────────────────────────────────────
const NAV_TODOS = [
  { path: '/',               label: 'Inicio',         icono: LayoutDashboard },
  { path: '/clientes',       label: 'Clientes',       icono: Users },
  { path: '/cotizaciones',   label: 'Cotizaciones',   icono: FileText },
  { path: '/despachos',      label: 'Despachos',      icono: PackageCheck },
  { path: '/inventario',     label: 'Inventario',     icono: Package },
  { path: '/transportistas', label: 'Transportistas', icono: Truck },
]

const NAV_SUPERVISOR = [
  { path: '/auditoria',     label: 'Auditoría',     icono: ClipboardList },
  { path: '/configuracion', label: 'Configuración', icono: Settings },
]

// ─── Badge de rol ──────────────────────────────────────────────────────────────
function BadgeRol({ rol }) {
  const estilos = {
    supervisor: 'bg-sky-100 text-sky-700',
    vendedor:   'bg-emerald-100 text-emerald-700',
  }
  const textos = { supervisor: 'Supervisor', vendedor: 'Vendedor' }
  return (
    <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${estilos[rol] ?? 'bg-slate-100 text-slate-600'}`}>
      {textos[rol] ?? rol}
    </span>
  )
}

// ─── Item de navegación ────────────────────────────────────────────────────────
function NavItem({ path, label, Icono, onClick }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      onClick={onClick}
      className={({ isActive }) => `
        flex items-center gap-3 px-4 py-2.5 rounded-xl
        text-sm font-bold transition-all
        ${isActive
          ? 'text-white shadow-md shadow-sky-500/20'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }
      `}
      style={({ isActive }) => isActive
        ? { background: 'linear-gradient(135deg, #1A3A8C, #D4A017)' }
        : {}
      }
    >
      <Icono size={18} />
      <span>{label}</span>
    </NavLink>
  )
}

// ─── Layout principal ──────────────────────────────────────────────────────────
export default function AppLayout() {
  const { perfil, logout } = useAuthStore()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const { tasaBcv, tasaEfectiva, modoAuto, setModoAuto, tasaManual, setTasaManual, cargando: tasaCargando, refrescar } = useTasaCambio()

  // Realtime: escucha cambios en tablas y refresca cache automáticamente
  useRealtimeSync()

  // Notificaciones
  const { unreadCount, notifications, markAllRead, clearAll } = useAdminAlerts()
  const [showNotifs, setShowNotifs] = useState(false)
  const notifsRef = useRef(null)

  // Push notifications
  const { supported: pushSupported, subscribed: pushSubscribed, loading: pushLoading, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications()

  async function togglePush() {
    if (pushSubscribed) {
      await pushUnsubscribe()
      showToast('Notificaciones push desactivadas', 'info')
    } else {
      const result = await pushSubscribe()
      if (result.ok) showToast('Notificaciones push activadas', 'success')
      else showToast(result.error || 'No se pudo activar', 'error')
    }
  }

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (notifsRef.current && !notifsRef.current.contains(e.target)) {
        setShowNotifs(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const [showTasaConfig, setShowTasaConfig] = useState(false)
  const [tasaInput, setTasaInput] = useState(tasaManual)
  const [tasaConfirmada, setTasaConfirmada] = useState(!!tasaManual)

  function confirmarTasaManual() {
    if (parseFloat(tasaInput) > 0) {
      setTasaManual(tasaInput)
      setTasaConfirmada(true)
    }
  }

  const esSupervisor = perfil?.rol === 'supervisor'

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  function cerrarMenu() { setMenuOpen(false) }

  return (
    <div className="flex min-h-screen bg-slate-50">

      {/* ── Barra superior móvil ─────────────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-slate-200 px-4 h-14 flex items-center justify-between">
        <button
          onClick={() => setMenuOpen(true)}
          className="p-2 -ml-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
        >
          <Menu size={22} />
        </button>
        <img src="/logo.png" alt="Listo POS" className="h-8 w-auto object-contain" />
        {/* Campana móvil */}
        <div className="relative" ref={null}>
          <button
            onClick={() => { setShowNotifs(v => !v); if (unreadCount > 0) markAllRead() }}
            className="relative p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-rose-500 text-white text-xs font-black rounded-full flex items-center justify-center px-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Backdrop overlay (móvil) ─────────────────────────────────────── */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity"
          onClick={cerrarMenu}
        />
      )}

      {/* ── Sidebar / Drawer ─────────────────────────────────────────────── */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col shrink-0
        transition-transform duration-300 ease-out
        ${menuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:z-auto md:h-screen md:sticky md:top-0
      `}>

        {/* Botón cerrar — solo móvil */}
        <div className="md:hidden flex justify-end p-3 pb-0">
          <button
            onClick={cerrarMenu}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Logo */}
        <div className="p-5 border-b border-slate-100 flex justify-center">
          <img src="/logo.png" alt="Listo POS Cotizaciones"
            className="h-[150px] w-auto object-contain" />
        </div>

        {/* Navegación — ocupa el espacio restante, scroll si hace falta */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1">

          {/* Rutas accesibles para todos */}
          {NAV_TODOS.map(({ path, label, icono: Icono }) => (
            <NavItem key={path} path={path} label={label} Icono={Icono} onClick={cerrarMenu} />
          ))}

          {/* Rutas solo para supervisor */}
          {esSupervisor && (
            <>
              <div className="pt-4 pb-1 px-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Administración
                </p>
              </div>
              {NAV_SUPERVISOR.map(({ path, label, icono: Icono }) => (
                <NavItem key={path} path={path} label={label} Icono={Icono} onClick={cerrarMenu} />
              ))}
            </>
          )}
        </nav>

        {/* Campana de notificaciones — sidebar desktop */}
        <div className="border-t border-slate-100 px-4 py-3 relative" ref={notifsRef}>
          <button
            onClick={() => { setShowNotifs(v => !v); if (unreadCount > 0) markAllRead() }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-slate-500" />
              <span className="text-sm font-bold text-slate-600">Alertas</span>
            </div>
            {unreadCount > 0 && (
              <span className="min-w-[20px] h-[20px] bg-rose-500 text-white text-xs font-black rounded-full flex items-center justify-center px-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Botón Push Notifications */}
          {pushSupported && (
            <button
              onClick={togglePush}
              disabled={pushLoading}
              className={`mt-1.5 w-full flex items-center justify-between px-3 py-2 rounded-xl border transition-colors ${
                pushSubscribed
                  ? 'bg-sky-50 border-sky-200 hover:bg-sky-100'
                  : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                {pushSubscribed
                  ? <Bell size={16} className="text-sky-500" />
                  : <BellOff size={16} className="text-slate-400" />
                }
                <span className={`text-sm font-bold ${pushSubscribed ? 'text-sky-600' : 'text-slate-500'}`}>
                  {pushLoading ? 'Procesando…' : pushSubscribed ? 'Push activado' : 'Activar push'}
                </span>
              </div>
              {pushSubscribed && <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />}
            </button>
          )}

          {showNotifs && (
            <div className="absolute bottom-full left-2 right-2 mb-2 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden max-w-sm">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <p className="text-xs font-black text-slate-600 uppercase tracking-wider">Alertas</p>
                {notifications.length > 0 && (
                  <button onClick={() => { clearAll(); setShowNotifs(false) }}
                    className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-colors px-2 py-1 rounded-lg hover:bg-rose-50">
                    Limpiar todo
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto custom-scrollbar divide-y divide-slate-50">
                {notifications.length === 0 ? (
                  <div className="text-center py-8 px-4">
                    <Bell size={24} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">Sin alertas recientes</p>
                  </div>
                ) : (
                  notifications.slice(0, 20).map(n => {
                    const isStockBajo = n.type === NOTIF_TYPES.STOCK_BAJO
                    return (
                      <div key={n.id}
                        onClick={isStockBajo ? () => { navigate('/inventario?filtro=stock_bajo'); setShowNotifs(false) } : undefined}
                        className={`px-4 py-3 transition-colors ${isStockBajo ? 'cursor-pointer hover:bg-amber-50/50' : 'hover:bg-slate-50/50'}`}
                      >
                        <div className="flex gap-2.5 items-start">
                          <NotifIcon type={n.type} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-slate-700 leading-tight">{n.title}</p>
                            {n.body && !isStockBajo && (
                              <p className="text-xs text-slate-500 mt-0.5 leading-snug">{n.body}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1">
                              {new Date(n.ts).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tasa de cambio */}
        <div className="border-t border-slate-100 px-4 py-3">
          <button
            onClick={() => setShowTasaConfig(!showTasaConfig)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <DollarSign size={16} className="text-emerald-500" />
              <span className="text-sm font-bold text-slate-600">BCV</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-black text-emerald-600">
                {tasaEfectiva > 0
                  ? new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaEfectiva)
                  : '—'}
              </span>
              <span className="text-xs text-slate-500">Bs/$</span>
              {!modoAuto && <span className="text-xs bg-primary-light text-primary px-1.5 rounded font-bold">MAN</span>}
            </div>
          </button>

          {showTasaConfig && (
            <div className="mt-2 bg-white rounded-xl border border-slate-200 p-3 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Modo</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">
                    {modoAuto ? <span className="text-emerald-600">Auto</span> : <span className="text-primary">Manual</span>}
                  </span>
                  <button
                    onClick={() => setModoAuto(!modoAuto)}
                    style={{ minHeight: 0 }}
                    className={`relative w-9 h-5 rounded-full transition-colors ${modoAuto ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform shadow-sm ${modoAuto ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>

              {modoAuto ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">{tasaBcv.fuente || 'Cargando...'}</p>
                    {tasaBcv.ultimaActualizacion && (
                      <p className="text-xs text-slate-500">
                        {new Date(tasaBcv.ultimaActualizacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  <button onClick={refrescar} disabled={tasaCargando}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-emerald-600 transition-colors">
                    <RefreshCw size={13} className={tasaCargando ? 'animate-spin' : ''} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-1.5 items-center">
                    <input type="number" min="0.01" step="0.01"
                      value={tasaInput}
                      onChange={e => { setTasaInput(e.target.value); setTasaConfirmada(false) }}
                      placeholder="Tasa manual Bs/$"
                      className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-bold text-primary focus:outline-none focus:ring-1 focus:ring-primary-focus"
                      onKeyDown={e => e.key === 'Enter' && confirmarTasaManual()}
                    />
                    <button
                      onClick={confirmarTasaManual}
                      disabled={!tasaInput || parseFloat(tasaInput) <= 0 || tasaConfirmada}
                      className={`shrink-0 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                        tasaConfirmada
                          ? 'bg-emerald-100 text-emerald-600'
                          : 'bg-primary text-white hover:bg-primary-hover disabled:opacity-40'
                      }`}>
                      {tasaConfirmada ? '✓' : 'OK'}
                    </button>
                  </div>
                  {tasaBcv.precio > 0 && (
                    <p className="text-xs text-slate-500">
                      Referencia BCV: {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaBcv.precio)} Bs/$
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Usuario + botón de cierre de sesión */}
        <div className="border-t border-slate-100 p-4">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 active:scale-[0.98] transition-all group"
          >
            <LoginAvatar user={perfil} size="sm" />
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-black text-slate-800 truncate leading-tight">
                {perfil?.nombre ?? 'Usuario'}
              </p>
              <BadgeRol rol={perfil?.rol} />
            </div>
            <div className="shrink-0 w-8 h-8 rounded-xl bg-slate-100 group-hover:bg-red-100 flex items-center justify-center transition-colors">
              <LogOut size={15} className="text-slate-400 group-hover:text-red-500 transition-colors" />
            </div>
          </button>
        </div>

      </aside>

      {/* ── Área de contenido ───────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0 min-w-0">
        <div className="mx-auto max-w-screen-2xl">
          <Outlet />
        </div>
      </main>

    </div>
  )
}
