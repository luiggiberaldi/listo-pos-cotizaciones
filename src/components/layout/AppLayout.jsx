// src/components/layout/AppLayout.jsx
// Layout principal: sidebar fijo + área de contenido
// Navegación adaptada al rol (supervisor ve más opciones que vendedor)
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Users, FileText, Package, Truck,
  UserCog, ClipboardList, LogOut,
  ChevronRight, LayoutDashboard,
} from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'

// ─── Definición de rutas de navegación ────────────────────────────────────────
const NAV_TODOS = [
  { path: '/',               label: 'Inicio',         icono: LayoutDashboard },
  { path: '/clientes',       label: 'Clientes',       icono: Users },
  { path: '/cotizaciones',   label: 'Cotizaciones',   icono: FileText },
  { path: '/inventario',     label: 'Inventario',     icono: Package },
  { path: '/transportistas', label: 'Transportistas', icono: Truck },
]

const NAV_SUPERVISOR = [
  { path: '/usuarios',  label: 'Usuarios',   icono: UserCog },
  { path: '/auditoria', label: 'Auditoría',  icono: ClipboardList },
]

// ─── Badge de rol ──────────────────────────────────────────────────────────────
function BadgeRol({ rol }) {
  const estilos = {
    supervisor: 'bg-amber-100 text-amber-700',
    vendedor:   'bg-sky-100 text-sky-700',
  }
  const textos = { supervisor: 'Supervisor', vendedor: 'Vendedor' }
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${estilos[rol] ?? 'bg-slate-100 text-slate-600'}`}>
      {textos[rol] ?? rol}
    </span>
  )
}

// ─── Item de navegación ────────────────────────────────────────────────────────
function NavItem({ path, label, Icono }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      className={({ isActive }) => `
        flex items-center gap-3 px-4 py-3 rounded-xl
        text-base font-medium transition-colors
        ${isActive
          ? 'bg-amber-500 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }
      `}
    >
      <Icono size={20} />
      <span>{label}</span>
    </NavLink>
  )
}

// ─── Layout principal ──────────────────────────────────────────────────────────
export default function AppLayout() {
  const { perfil, logout } = useAuthStore()
  const navigate = useNavigate()

  const esSupervisor = perfil?.rol === 'supervisor'

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-slate-50">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col">

        {/* Logo */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-black text-sm">LP</span>
            </div>
            <div>
              <p className="font-bold text-slate-800 text-sm leading-tight">Listo POS</p>
              <p className="text-xs text-slate-400 leading-tight">Cotizaciones</p>
            </div>
          </div>
        </div>

        {/* Navegación */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">

          {/* Rutas accesibles para todos */}
          {NAV_TODOS.map(({ path, label, icono: Icono }) => (
            <NavItem key={path} path={path} label={label} Icono={Icono} />
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
                <NavItem key={path} path={path} label={label} Icono={Icono} />
              ))}
            </>
          )}
        </nav>

        {/* Info del usuario + logout */}
        <div className="border-t border-slate-100 p-4 space-y-3">

          {/* Perfil */}
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 bg-slate-200 rounded-full flex items-center justify-center shrink-0">
              <span className="text-slate-600 font-bold text-sm">
                {perfil?.nombre?.[0]?.toUpperCase() ?? '?'}
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-800 text-sm truncate">
                {perfil?.nombre ?? 'Usuario'}
              </p>
              <BadgeRol rol={perfil?.rol} />
            </div>
          </div>

          {/* Botón cerrar sesión */}
          <button
            onClick={handleLogout}
            className="
              w-full flex items-center justify-center gap-2
              py-3 px-4 rounded-xl
              bg-slate-100 hover:bg-red-50
              text-slate-600 hover:text-red-600
              font-semibold text-base
              transition-colors
              focus:outline-none focus:ring-2 focus:ring-red-200
            "
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>

      </aside>

      {/* ── Área de contenido ───────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

    </div>
  )
}
