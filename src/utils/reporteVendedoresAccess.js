// Rules for the seller report. Supervisors do not see company/no-commission sellers.
export function shouldIncludeReporteVendedor(viewerRole, seller) {
  if (!seller || seller.activo !== true) return false
  if (['desarrollador', 'administracion', 'logistica', 'jefe', 'supervisor'].includes(seller.rol)) return false
  if (viewerRole === 'supervisor' && seller.rol === 'vendedor_sin_comision') return false
  return true
}
