// src/components/layout/AppLayout.jsx
// Layout principal: sidebar fijo en desktop, drawer en móvil
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Users, FileText, Package, Truck,
  UserCog, ClipboardList,
  LayoutDashboard, Settings, LogOut,
  Menu, X, DollarSign, RefreshCw,
} from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../auth/LoginAvatar'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { useRealtimeSync } from '../../hooks/useRealtimeSync'

// ─── Definición de rutas de navegación ────────────────────────────────────────
const NAV_TODOS = [
  { path: '/',               label: 'Inicio',         icono: LayoutDashboard },
  { path: '/clientes',       label: 'Clientes',       icono: Users },
  { path: '/cotizaciones',   label: 'Cotizaciones',   icono: FileText },
  { path: '/inventario',     label: 'Inventario',     icono: Package },
  { path: '/transportistas', label: 'Transportistas', icono: Truck },
]

const NAV_SUPERVISOR = [
  { path: '/usuarios',      label: 'Usuarios',      icono: UserCog },
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
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${estilos[rol] ?? 'bg-slate-100 text-slate-600'}`}>
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
        ? { background: 'linear-gradient(135deg, #0EA5E9, #5EEAD4)' }
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
        <div className="w-10" />
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
            className="h-[55px] md:h-[55px] w-auto object-contain" />
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

        {/* Tasa de cambio */}
        <div className="border-t border-slate-100 px-4 py-3">
          <button
            onClick={() => setShowTasaConfig(!showTasaConfig)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-500" />
              <span className="text-xs font-bold text-slate-500">BCV</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black text-emerald-600">
                {tasaEfectiva > 0
                  ? new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaEfectiva)
                  : '—'}
              </span>
              <span className="text-[10px] text-slate-400">Bs/$</span>
              {!modoAuto && <span className="text-[9px] bg-primary-light text-primary px-1 rounded font-bold">MAN</span>}
            </div>
          </button>

          {showTasaConfig && (
            <div className="mt-2 bg-white rounded-xl border border-slate-200 p-3 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-400 uppercase">Modo</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold">
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
                    <p className="text-xs text-slate-500">{tasaBcv.fuente || 'Cargando...'}</p>
                    {tasaBcv.ultimaActualizacion && (
                      <p className="text-[10px] text-slate-400">
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
                    <p className="text-[10px] text-slate-400">
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
