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
 * Nombre visible de un camión: "código nombre", sin repetir el código cuando el
 * nombre ya lo trae (p. ej. código "CAM-01" y nombre "CAM-01 NPR Blanco").
 */
export function nombreVehiculo(vehiculo) {
  if (!vehiculo) return ''
  const codigo = String(vehiculo.codigo || '').trim()
  const nombre = String(vehiculo.nombre || '').trim()
  if (codigo && nombre.toUpperCase().startsWith(codigo.toUpperCase())) return nombre
  return [codigo, nombre].filter(Boolean).join(' ')
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
  const modelo = String(vehiculo.modelo || '').trim()

  return {
    // Con modelo: "CAM-01 Mack Granite 2020"; sin modelo: el nombre del camión.
    vehiculo: modelo ? [vehiculo.codigo, modelo].filter(Boolean).join(' ') : nombreVehiculo(vehiculo),
    placa_chuto: vehiculo.placa || '',
    placa_batea: String(vehiculo.placa_batea || '').trim() || bateaRespaldo,
    color_batea: vehiculo.color_batea || (esSuHabitual ? transportista?.color_batea || '' : ''),
  }
}
