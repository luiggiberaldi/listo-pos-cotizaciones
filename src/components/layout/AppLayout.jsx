// src/components/layout/AppLayout.jsx
// Layout principal: sidebar fijo en desktop, drawer en móvil
import { useState, useRef, useEffect, memo } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Users, FileText, Package, Truck,
  UserCog, ClipboardList,
  LayoutDashboard, Settings, ArrowRightLeft,
  Menu, X, DollarSign, RefreshCw, PackageCheck, Bell, BellOff,
  AlertTriangle, Send, CheckCircle, Ban,
  PanelLeftClose, PanelLeftOpen, BarChart3, FlaskConical,
  Clock, CalendarClock,
} from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../auth/LoginAvatar'
import BcvWidget from './BcvWidget'
import BottomNav from './BottomNav'
import Breadcrumbs from '../ui/Breadcrumbs'
import QuickQuoteFAB from '../cotizaciones/QuickQuoteFAB'
import { useRealtimeSync } from '../../hooks/useRealtimeSync'
import { useAdminAlerts } from '../../hooks/useAdminAlerts'
import { useRecordatoriosCotizaciones } from '../../hooks/useRecordatoriosCotizaciones'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { showToast } from '../ui/Toast'
import { NOTIF_TYPES } from '../../services/notificationService'

// ─── Iconos por tipo de notificación ────────────────────────────────────────
const NOTIF_ICON_MAP = {
  [NOTIF_TYPES.STOCK_BAJO]:                 { icon: AlertTriangle, color: 'text-amber-500',   bg: 'bg-amber-50' },
  [NOTIF_TYPES.COTIZACION_ENVIADA]:         { icon: Send,          color: 'text-sky-500',     bg: 'bg-sky-50' },
  [NOTIF_TYPES.COTIZACION_ACEPTADA]:        { icon: CheckCircle,   color: 'text-emerald-500', bg: 'bg-emerald-50' },
  [NOTIF_TYPES.COTIZACION_CREADA]:          { icon: FileText,      color: 'text-indigo-500',  bg: 'bg-indigo-50' },
  [NOTIF_TYPES.DESPACHO_CREADO]:            { icon: Truck,         color: 'text-indigo-500',  bg: 'bg-indigo-50' },
  [NOTIF_TYPES.COTIZACION_ANULADA]:         { icon: Ban,           color: 'text-red-500',     bg: 'bg-red-50' },
  [NOTIF_TYPES.COTIZACION_SIN_RESPUESTA]:   { icon: Clock,         color: 'text-orange-500',  bg: 'bg-orange-50' },
  [NOTIF_TYPES.COTIZACION_POR_VENCER]:      { icon: CalendarClock, color: 'text-rose-500',    bg: 'bg-rose-50' },
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
  { path: '/comisiones',     label: 'Comisiones',     icono: DollarSign },
]

const NAV_SUPERVISOR = [
  { path: '/reportes',      label: 'Reportes',      icono: BarChart3 },
  { path: '/configuracion', label: 'Configuración', icono: Settings },
]

// ─── Badge de rol ──────────────────────────────────────────────────────────────
function BadgeRol({ rol }) {
  const estilos = {
    supervisor: 'bg-sky-500/20 text-sky-300 border border-sky-500/30',
    vendedor:   'bg-teal-500/20 text-teal-300 border border-teal-500/30',
  }
  const textos = { supervisor: 'Supervisor', vendedor: 'Vendedor' }
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${estilos[rol] ?? 'bg-white/10 text-white/50'}`}>
      {textos[rol] ?? rol}
    </span>
  )
}

// ─── Item de navegación ────────────────────────────────────────────────────────
const NavItem = memo(function NavItem({ path, label, Icono, onClick, collapsed }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={({ isActive }) => `
        flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${collapsed ? 'px-2' : 'px-3'} py-2 md:py-1.5 xl:py-2.5 rounded-xl
        text-sm font-bold transition-all duration-200
        ${isActive
          ? 'text-white shadow-lg'
          : 'text-white/75 hover:text-white hover:bg-white/10'
        }
      `}
      style={({ isActive }) => isActive
        ? { background: 'linear-gradient(135deg, rgba(27,54,93,0.9), rgba(184,134,11,0.7))', boxShadow: '0 4px 15px rgba(184,134,11,0.2)', border: '1px solid rgba(184,134,11,0.25)' }
        : {}
      }
    >
      <Icono size={18} />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  )
})

// ─── Layout principal ──────────────────────────────────────────────────────────
export default function AppLayout() {
  const { perfil, switchOut } = useAuthStore()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Realtime: escucha cambios en tablas y refresca cache automáticamente
  useRealtimeSync()

  // Recordatorios de vencimiento deshabilitados (cotizaciones y despachos no vencen)
  // useRecordatoriosCotizaciones()

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

  const esSupervisor = perfil?.rol === 'supervisor'

  // Página actual para título en topbar
  const location = useLocation()
  const allNavItems = [...NAV_TODOS, ...NAV_SUPERVISOR]
  const currentPage = allNavItems.find(item =>
    item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
  )

  async function handleSwitchOut() {
    await switchOut()
    navigate('/login', { replace: true })
  }

  function cerrarMenu() { setMenuOpen(false) }

  return (
    <div className="flex min-h-screen pt-14" style={{ background: '#f1f5f9' }}>

      {/* ── Barra superior (móvil + desktop) ────────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 z-40 px-4 h-14 flex items-center justify-between gap-4"
        style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>

        {/* Hamburger — solo móvil */}
        <button
          onClick={() => setMenuOpen(true)}
          className="md:hidden p-3 rounded-xl transition-colors text-white/60 hover:text-white hover:bg-white/10"
          aria-label="Abrir menú"
        >
          <Menu size={22} />
        </button>

        {/* Logo — solo móvil */}
        <img src="/logo.png" alt="Construacero Carabobo" className="md:hidden h-8 w-auto object-contain" style={{ filter: 'brightness(1.1)' }} />

        {/* Título de página — solo desktop */}
        {currentPage && (
          <div className="hidden md:flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.8), rgba(184,134,11,0.5))', border: '1px solid rgba(184,134,11,0.2)' }}>
              <currentPage.icono size={16} className="text-white/80" />
            </div>
            <span className="text-sm font-black tracking-wide text-white/90">{currentPage.label}</span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Widget BCV — supervisor puede configurar, vendedor solo ve la tasa */}
        <BcvWidget soloLectura={!esSupervisor} />

        {/* Campana con dropdown — siempre visible */}
        <div className="relative" ref={notifsRef}>
          <button
            onClick={() => { setShowNotifs(v => !v); if (unreadCount > 0) markAllRead() }}
            className="relative p-3 rounded-xl transition-all"
            style={{
              color:      unreadCount > 0 ? '#fbbf24' : 'rgba(255,255,255,0.55)',
              background: unreadCount > 0 ? 'rgba(251,191,36,0.1)' : 'transparent',
              border:     unreadCount > 0 ? '1px solid rgba(251,191,36,0.2)' : '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = unreadCount > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.background = unreadCount > 0 ? 'rgba(251,191,36,0.1)' : 'transparent' }}
            title="Alertas"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-rose-500 text-white text-xs font-black rounded-full flex items-center justify-center px-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown de alertas */}
          {showNotifs && (
            <div className="absolute top-full right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-80 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
              style={{ background: '#0f1f3c', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

              {/* Header del dropdown */}
              <div className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center gap-2">
                  <Bell size={13} className="text-white/40" />
                  <p className="text-xs font-black uppercase tracking-wider text-white/60">Alertas</p>
                  {unreadCount > 0 && (
                    <span className="text-[10px] font-black bg-rose-500/20 text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </div>
                {notifications.length > 0 && (
                  <button onClick={() => { clearAll(); setShowNotifs(false) }}
                    className="text-[10px] font-bold text-white/30 hover:text-rose-400 transition-colors px-2 py-1 rounded-lg hover:bg-rose-500/10">
                    Limpiar todo
                  </button>
                )}
              </div>

              {/* Lista de notificaciones */}
              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="text-center py-10 px-4">
                    <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Bell size={20} className="text-white/20" />
                    </div>
                    <p className="text-sm font-bold text-white/30">Sin alertas recientes</p>
                    <p className="text-xs text-white/20 mt-1">Las notificaciones aparecerán aquí</p>
                  </div>
                ) : (
                  notifications.slice(0, 20).map((n, idx) => {
                    const isStockBajo = n.type === NOTIF_TYPES.STOCK_BAJO
                    return (
                      <div key={n.id}
                        onClick={isStockBajo ? () => { navigate('/inventario?filtro=stock_bajo'); setShowNotifs(false) } : undefined}
                        className={`px-4 py-3 transition-colors ${isStockBajo ? 'cursor-pointer hover:bg-amber-500/5' : ''}`}
                        style={{ borderBottom: idx < notifications.slice(0,20).length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                      >
                        <div className="flex gap-3 items-start">
                          <NotifIcon type={n.type} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-white/80 leading-tight">{n.title}</p>
                            {n.body && !isStockBajo && (
                              <p className="text-xs text-white/40 mt-0.5 leading-snug">{n.body}</p>
                            )}
                            <p className="text-[10px] text-white/25 mt-1">
                              {new Date(n.ts).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Push toggle al pie */}
              {pushSupported && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <button
                    onClick={togglePush}
                    disabled={pushLoading}
                    className="w-full flex items-center justify-between px-4 py-3 transition-all group"
                    style={{
                      background: pushSubscribed ? 'rgba(59,130,246,0.08)' : 'transparent',
                      color: pushSubscribed ? '#60a5fa' : 'rgba(255,255,255,0.4)',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = pushSubscribed ? 'rgba(59,130,246,0.14)' : 'rgba(255,255,255,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = pushSubscribed ? 'rgba(59,130,246,0.08)' : 'transparent'}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: pushSubscribed ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.06)' }}>
                        {pushSubscribed ? <Bell size={13} className="text-sky-400" /> : <BellOff size={13} className="text-white/30" />}
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-bold leading-tight">
                          {pushLoading ? 'Procesando…' : pushSubscribed ? 'Push activado' : 'Activar notificaciones push'}
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          {pushSubscribed ? 'Toca para desactivar' : 'Recibe alertas en tu dispositivo'}
                        </p>
                      </div>
                    </div>
                    {pushSubscribed && <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Backdrop overlay (móvil) ─────────────────────────────────────── */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm transition-opacity"
          onClick={cerrarMenu}
        />
      )}

      {/* ── Sidebar / Drawer ─────────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col shrink-0
          transition-all duration-300 ease-out
          ${menuOpen ? 'translate-x-0' : '-translate-x-full'}
          ${sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'}
          w-64 md:translate-x-0 md:static md:z-auto md:h-[calc(100vh-3.5rem)] md:sticky md:top-14
          overflow-visible
        `}
        style={{
          background: 'linear-gradient(180deg, #0a1628 0%, #0d1f3c 60%, #0a1a0f 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
        }}
      >
        <div className="flex flex-col h-full overflow-hidden">
        {/* Malla de puntos decorativa */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.03]">
          <svg width="100%" height="100%"><defs><pattern id="sdot" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="white"/></pattern></defs><rect width="100%" height="100%" fill="url(#sdot)"/></svg>
        </div>
        {/* Orbe decorativo */}
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none -mb-16 -ml-16 opacity-20"
          style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(30px)' }} />

        {/* Botón cerrar — solo móvil */}
        <div className="md:hidden flex justify-end p-3 pb-0 relative z-10">
          <button onClick={cerrarMenu} className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Logo + botón colapsar */}
        <div className="relative z-10 px-4 py-3 md:py-3 xl:py-4 flex flex-col items-center shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>

          <img src="/logo.png" alt="Construacero Carabobo"
            className={`object-contain transition-all duration-300 select-none pointer-events-none ${
              sidebarCollapsed ? 'h-[40px] w-[40px]' : 'h-[70px] md:h-[90px] xl:h-[130px]'
            }`}
            style={{ filter: 'brightness(1.05) drop-shadow(0 0 12px rgba(184,134,11,0.2))' }}
            draggable={false}
          />
          {!sidebarCollapsed && (
            <div className="mt-1.5 md:mt-2 hidden md:flex items-center gap-2 w-full justify-center">
              <div className="h-px flex-1 opacity-20" style={{ background: 'linear-gradient(to right, transparent, #B8860B)' }} />
              <span className="text-[9px] font-bold tracking-[0.25em] uppercase whitespace-nowrap" style={{ color: 'rgba(184,134,11,0.7)' }}>
                Sistema de Gestión
              </span>
              <div className="h-px flex-1 opacity-20" style={{ background: 'linear-gradient(to left, transparent, #B8860B)' }} />
            </div>
          )}

          {/* Botón colapsar — movido fuera del overflow-hidden */}
        </div>

        {/* Navegación */}
        <nav className="relative z-10 flex-1 min-h-0 overflow-y-auto sidebar-scrollbar p-3 space-y-0.5">
          {NAV_TODOS.map(({ path, label, icono: Icono }) => (
            <NavItem key={path} path={path} label={label} Icono={Icono} onClick={cerrarMenu} collapsed={sidebarCollapsed} />
          ))}
          {esSupervisor && (
            <>
              {!sidebarCollapsed && (
                <div className="pt-4 pb-1.5 px-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(184,134,11,0.7)' }}>
                    Administración
                  </p>
                </div>
              )}
              {sidebarCollapsed && <div className="pt-3 mt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />}
              {NAV_SUPERVISOR.map(({ path, label, icono: Icono }) => (
                <NavItem key={path} path={path} label={label} Icono={Icono} onClick={cerrarMenu} collapsed={sidebarCollapsed} />
              ))}
            </>
          )}
        </nav>

        {/* Usuario — toca para cambiar operador */}
        <div className="relative z-10 p-3 pb-20 md:pb-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={handleSwitchOut}
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} p-3 rounded-2xl transition-all active:scale-[0.98] group`}
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}
            title={sidebarCollapsed ? 'Cambiar operador' : undefined}
          >
            <LoginAvatar user={perfil} size="sm" />
            {!sidebarCollapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-black text-white/90 truncate leading-tight">
                    {perfil?.nombre ?? 'Usuario'}
                  </p>
                  <BadgeRol rol={perfil?.rol} />
                </div>
                <ArrowRightLeft size={14} className="shrink-0 text-white/25 group-hover:text-white/50 transition-colors" />
              </>
            )}
          </button>
        </div>
        </div>

        {/* Botón colapsar — solo desktop, fuera del overflow-hidden */}
        <button
          onClick={() => setSidebarCollapsed(c => !c)}
          className="hidden md:flex absolute -right-3 top-28 w-6 h-6 rounded-full items-center justify-center transition-all hover:scale-110 z-50"
          style={{ background: '#0d1f3c', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.5)' }}
          title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>

      </aside>

      {/* ── Área de contenido ───────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto min-w-0 pb-20 md:pb-0">
        <div className="mx-auto max-w-screen-2xl">
          <div className="px-4 pt-1 md:px-6">
            <Breadcrumbs />
          </div>
          <Outlet />
        </div>
      </main>

      {/* ── Bottom Navigation — solo móvil ──────────────────────────────── */}
      <BottomNav esSupervisor={esSupervisor} />

      {/* ── FAB Cotización Rápida — solo móvil ─────────────────────────── */}
      <QuickQuoteFAB />

    </div>
  )
}
