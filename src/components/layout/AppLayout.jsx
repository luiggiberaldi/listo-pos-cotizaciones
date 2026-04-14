// src/components/layout/AppLayout.jsx
// Layout principal: sidebar fijo en desktop, drawer en móvil
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Users, FileText, Package, Truck,
  UserCog, ClipboardList,
  LayoutDashboard, Settings, LogOut,
  Menu, X,
} from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../auth/LoginAvatar'

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
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col
        transition-transform duration-300 ease-out
        ${menuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:z-auto
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

        {/* Navegación */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">

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
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <Outlet />
      </main>

    </div>
  )
}
