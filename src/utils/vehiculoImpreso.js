// src/utils/vehiculoImpreso.js
// Datos del camión que se imprimen en guías, órdenes y notas de despacho
// (plan de flota, arreglo 11): el papel debe mostrar el camión REAL del viaje
// (notas_despacho.vehiculo_id), no el de la ficha del chofer.
//
// - Viaje con camión de la flota → nombre y placa de ese camión. La placa y el
//   color de batea de la ficha solo se conservan si ese camión es el habitual
//   del chofer (si no, serían de otro camión).
// - Viaje sin camión de la flota (externos o históricos) → datos de la ficha,
//   como hasta ahora.
/**
 * Nombre visible de un camión: su modelo (campo `nombre`). El código (CAM-01…) es interno:
 * lo pone el servidor y no se muestra en pantallas ni PDF. Sin nombre, la placa.
 */
export function nombreVehiculo(vehiculo) {
  if (!vehiculo) return ''
  return String(vehiculo.nombre || '').trim() || String(vehiculo.placa || vehiculo.placa_batea || '').trim()
}

/**
 * Placas visibles de un camión. El chuto es opcional (migración 287): un camión
 * con solo batea se muestra "batea 08C GBC", nunca un chuto vacío.
 */
export function placasVehiculo(vehiculo) {
  if (!vehiculo) return ''
  const chuto = String(vehiculo.placa || '').trim()
  const batea = String(vehiculo.placa_batea || '').trim()
  return [chuto, batea && batea !== chuto ? `batea ${batea}` : ''].filter(Boolean).join(' · ')
}

export function datosVehiculoImpreso(despacho) {
  const transportista = despacho?.transportista || null
  const vehiculo = despacho?.vehiculo_viaje || null

  if (!vehiculo) {
    return {
      vehiculo: transportista?.vehiculo || '',
      placa_chuto: transportista?.placa_chuto || '',
      placa_batea: transportista?.placa_batea || '',
      color_batea: transportista?.color_batea || '',
    }
  }

  const esSuHabitual = !!transportista?.vehiculo_habitual_id
    && transportista.vehiculo_habitual_id === vehiculo.id
  const placaVeh = String(vehiculo.placa || '').trim().toUpperCase()
  const bateaFicha = String(transportista?.placa_batea || '').trim()

  // La batea del camión (migración 285) manda; la de la ficha del chofer solo
  // como respaldo para camiones sin batea cargada y si es su camión habitual.
  const bateaRespaldo = esSuHabitual && bateaFicha && bateaFicha.toUpperCase() !== placaVeh ? bateaFicha : ''

  return {
    // Un solo dato: el modelo del camión (campo `nombre`), igual que en pantallas y reportes.
    vehiculo: nombreVehiculo(vehiculo),
    placa_chuto: vehiculo.placa || '',
    placa_batea: String(vehiculo.placa_batea || '').trim() || bateaRespaldo,
    color_batea: vehiculo.color_batea || (esSuHabitual ? transportista?.color_batea || '' : ''),
  }
}
