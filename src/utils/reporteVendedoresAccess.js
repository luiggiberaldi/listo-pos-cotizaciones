// Rules for the seller report. Supervisors do not see company/no-commission sellers.
//
// OP-2026-032: un supervisor que vende (tiene clientes propios) aparece cuando
// tiene actividad en el período: ventas o comisión. Así el total de comisiones
// cuadra con Reportes → Comisiones (antes su comisión desaparecía del reporte).
function tieneActividad(seller) {
  return Number(seller?.totalUsd || 0) > 0
    || Number(seller?.numDespachos || 0) > 0
    || Number(seller?.comisionTotal || 0) > 0
}

export function shouldIncludeReporteVendedor(viewerRole, seller) {
  if (!seller || seller.activo !== true) return false
  if (seller.rol === 'supervisor') return tieneActividad(seller)
  if (['desarrollador', 'administracion', 'logistica', 'jefe'].includes(seller.rol)) return false
  if (viewerRole === 'supervisor' && seller.rol === 'vendedor_sin_comision') return false
  return true
}
