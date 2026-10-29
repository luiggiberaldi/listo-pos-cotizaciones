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

  return {
    // Si el nombre ya empieza con el código (p. ej. "CAM-01 NPR"), no repetirlo.
    vehiculo: vehiculo.codigo && String(vehiculo.nombre || '').startsWith(vehiculo.codigo)
      ? vehiculo.nombre
      : [vehiculo.codigo, vehiculo.nombre].filter(Boolean).join(' '),
    placa_chuto: vehiculo.placa || '',
    // Batea de la ficha solo si es el mismo camión y no repite la placa principal.
    placa_batea: esSuHabitual && bateaFicha && bateaFicha.toUpperCase() !== placaVeh ? bateaFicha : '',
    color_batea: vehiculo.color_batea || (esSuHabitual ? transportista?.color_batea || '' : ''),
  }
}
