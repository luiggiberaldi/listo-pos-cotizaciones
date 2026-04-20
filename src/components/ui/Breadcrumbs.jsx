// src/components/ui/Breadcrumbs.jsx
// Breadcrumbs contextuales para navegación predecible
import { useLocation, Link } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

const ROUTE_LABELS = {
  '/': 'Inicio',
  '/clientes': 'Clientes',
  '/cotizaciones': 'Cotizaciones',
  '/despachos': 'Despachos',
  '/inventario': 'Inventario',
  '/transportistas': 'Transportistas',
  '/comisiones': 'Comisiones',
  '/reportes': 'Reportes',
  '/auditoria': 'Auditoría',
  '/configuracion': 'Configuración',
  '/cotizaciones/rapida': 'Cotización Rápida',
}

export default function Breadcrumbs({ extra }) {
  const location = useLocation()
  const { pathname } = location

  // No mostrar en dashboard
  if (pathname === '/') return null

  // Construir crumbs
  const segments = pathname.split('/').filter(Boolean)
  const crumbs = [{ path: '/', label: 'Inicio' }]

  let accumulated = ''
  for (const seg of segments) {
    accumulated += '/' + seg
    const label = ROUTE_LABELS[accumulated] || seg
    crumbs.push({ path: accumulated, label })
  }

  // Si hay un extra (ej: "COT-00045"), agregarlo
  if (extra) {
    crumbs.push({ path: null, label: extra })
  }

  return (
    <nav className="flex items-center gap-1 text-xs text-slate-500 px-1 py-2 overflow-x-auto" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={i} className="flex items-center gap-1 shrink-0">
            {i > 0 && <ChevronRight size={12} className="text-slate-300" />}
            {isLast || !crumb.path ? (
              <span className="font-semibold text-slate-700 flex items-center gap-1">
                {i === 0 && <Home size={12} />}
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.path}
                className="hover:text-primary transition-colors flex items-center gap-1"
              >
                {i === 0 && <Home size={12} />}
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
