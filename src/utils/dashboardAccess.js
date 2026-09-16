// Una matriz explícita compartida por la vista y el servidor. Sin herencia implícita.
const policies = {
  jefe: { scope: 'empresa', sales: true, profit: true, commissions: true, team: true, quote: true },
  supervisor: { scope: 'equipo', sales: true, commissions: true, team: true, quote: true },
  vendedor: { scope: 'propio', sales: true, commissions: true, quote: true },
  vendedor_sin_comision: { scope: 'propio', sales: true, noCommission: true, quote: true },
  administracion: { scope: 'administracion', operations: true, receivables: true, inventory: true },
  logistica: { scope: 'logistica', deliveries: true },
  desarrollador: { scope: 'tecnico' },
}

const denied = Object.freeze({ scope: 'denegado' })
for (const policy of Object.values(policies)) Object.freeze(policy)
Object.freeze(policies)

export const SELLER_ROLES = Object.freeze(['vendedor', 'vendedor_sin_comision'])

export function getDashboardAccess(rol) {
  return Object.hasOwn(policies, rol) ? policies[rol] : denied
}

export function canOpenDashboard(perfil) {
  return Boolean(perfil?.id && perfil.activo !== false && getDashboardAccess(perfil.rol).scope !== 'denegado')
}

export function dashboardIdentityMatches(data, { accountId, operatorId, rol, sessionId }) {
  return Boolean(data?.schemaVersion === 1 && accountId && operatorId && sessionId
    && data.identity?.accountId === accountId
    && data.identity?.operatorId === operatorId
    && data.identity?.rol === rol
    && data.identity?.sessionId === sessionId
    && data.scope === getDashboardAccess(rol).scope)
}

// Las métricas financieras no se conservan en el dispositivo compartido.
export function mayPersistQuery(query) {
  const privateKeys = new Set([
    'dashboard_metrics', 'dashboard_metricas', 'dashboard-inicio', 'comisiones',
    'cuentas-cobrar', 'cuentas_por_cobrar', 'cotizaciones', 'despachos',
    'reporte-ventas', 'reporte-despachos', 'reporte-vendedores', 'clientes', 'usuarios',
  ])
  return query.state.status === 'success'
    && query.meta?.sensitive !== true
    && !privateKeys.has(query.queryKey?.[0])
    && !String(query.queryKey?.[0] || '').startsWith('reporte')
}
