// src/utils/flotaReporte.js
// Ayudantes puros del reporte de flota y choferes locales (Fase 4 del plan):
// totales, marca de viajes estimados (≈) y exportación a Excel (CSV).

// Marca de dato estimado (raíl R5): viajes cuyo camión viene de la carga
// histórica y no de una elección real.
export const MARCA_ESTIMADO = '≈'

export function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Reparto del flete de un chofer local (reporte de transportistas):
 *  - chofer  = comisión guardada en cada viaje (fuera de Carabobo);
 *  - empresa = total de fletes − parte del chofer (incluye los fletes dentro de
 *    Carabobo, donde el chofer cobra por nómina y no por flete).
 */
export function repartoFlete(t = {}) {
  const total = num(t.flete_total_usd)
  const chofer = num(t.neto_total_usd)
  return { total, chofer, empresa: Math.round((total - chofer) * 100) / 100 }
}

/** Texto de viajes con la marca ≈ cuando parte de ellos son estimados. */
export function textoViajes(fila, marca = MARCA_ESTIMADO) {
  const total = num(fila?.total_viajes)
  const estimados = num(fila?.viajes_estimados)
  return estimados > 0 ? `${total} (${marca}${estimados})` : String(total)
}

export function totalesVehiculos(filas = []) {
  return filas.reduce((acc, f) => ({
    viajes: acc.viajes + num(f.total_viajes),
    flete: acc.flete + num(f.total_flete_usd),
    mercancia: acc.mercancia + num(f.total_mercancia_usd),
    estimados: acc.estimados + num(f.viajes_estimados),
  }), { viajes: 0, flete: 0, mercancia: 0, estimados: 0 })
}

export function totalesChoferes(filas = []) {
  return filas.reduce((acc, f) => ({
    viajes: acc.viajes + num(f.total_viajes),
    enCarabobo: acc.enCarabobo + num(f.viajes_en_carabobo),
    fueraCarabobo: acc.fueraCarabobo + num(f.viajes_fuera_carabobo),
    flete: acc.flete + num(f.total_flete_usd),
    mercancia: acc.mercancia + num(f.total_mercancia_usd),
    comisionGenerada: acc.comisionGenerada + num(f.comision_generada_usd),
    comisionPagada: acc.comisionPagada + num(f.comision_pagada_usd),
    comisionPendiente: acc.comisionPendiente + num(f.comision_pendiente_usd),
  }), { viajes: 0, enCarabobo: 0, fueraCarabobo: 0, flete: 0, mercancia: 0, comisionGenerada: 0, comisionPagada: 0, comisionPendiente: 0 })
}

/** "Juan: 14 viajes / Pedro: 3 viajes" */
export function textoDesgloseChoferes(desglose = []) {
  return (desglose || []).map(d => `${d.chofer_nombre}: ${num(d.viajes)} viaje${num(d.viajes) === 1 ? '' : 's'}`).join(' / ')
}

/** "CAM-01: 14 viajes ($700.00) | S/P: 4 viajes ($220.00)" */
export function textoDesgloseVehiculos(desglose = []) {
  return (desglose || [])
    .map(d => `${d.vehiculo_nombre}${d.placa && d.placa !== 'S/P' ? ` (${d.placa})` : ''}: ${num(d.viajes)} viaje${num(d.viajes) === 1 ? '' : 's'} ($${num(d.flete_usd).toFixed(2)})`)
    .join(' | ')
}

function celda(v) {
  const s = String(v ?? '')
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function decimal(v) {
  // Excel en español espera coma decimal.
  return num(v).toFixed(2).replace('.', ',')
}

/**
 * Arma un CSV (separador ';', apto para Excel en español) con los dos cuadros.
 * Los viajes estimados llevan la marca ≈ y una nota al pie.
 */
export function construirCsvFlota({ porVehiculo = [], porChofer = [], desde = '', hasta = '' }) {
  const lineas = []
  lineas.push(['Reporte de flota y choferes locales', `Desde ${desde || 'inicio'}`, `Hasta ${hasta || 'hoy'}`].map(celda).join(';'))
  lineas.push('')
  lineas.push('Cuadro 1 - Productividad por vehiculo')
  lineas.push(['Codigo', 'Vehiculo', 'Placa', 'Activo', 'Viajes', 'Viajes estimados (≈)', 'Fletes USD', 'Mercancia USD', 'Flete promedio por viaje USD', 'Choferes'].join(';'))
  for (const f of porVehiculo) {
    lineas.push([
      f.codigo, f.nombre, f.placa, f.activo === false ? 'No' : 'Si',
      num(f.total_viajes), num(f.viajes_estimados),
      decimal(f.total_flete_usd), decimal(f.total_mercancia_usd), decimal(f.promedio_flete_viaje_usd),
      textoDesgloseChoferes(f.desglose_choferes),
    ].map(celda).join(';'))
  }
  lineas.push('')
  lineas.push('Cuadro 2 - Productividad y liquidacion por chofer local')
  lineas.push(['Chofer', 'Activo', 'Vehiculo habitual', 'Viajes', 'En Carabobo', 'Fuera de Carabobo', 'Viajes estimados (≈)', 'Fletes USD', 'Mercancia USD', 'Comision generada USD', 'Comision pagada USD', 'Comision pendiente USD', 'Vehiculos usados'].join(';'))
  for (const c of porChofer) {
    lineas.push([
      c.chofer_nombre, c.activo === false ? 'No' : 'Si',
      c.vehiculo_habitual_nombre ? `${c.vehiculo_habitual_nombre} (${c.vehiculo_habitual_placa || ''})` : 'Rotativo',
      num(c.total_viajes), num(c.viajes_en_carabobo), num(c.viajes_fuera_carabobo), num(c.viajes_estimados),
      decimal(c.total_flete_usd), decimal(c.total_mercancia_usd),
      decimal(c.comision_generada_usd), decimal(c.comision_pagada_usd), decimal(c.comision_pendiente_usd),
      textoDesgloseVehiculos(c.desglose_vehiculos),
    ].map(celda).join(';'))
  }
  lineas.push('')
  lineas.push(celda('≈ = viajes viejos cuyo camion se estimo con la ficha del chofer (no es un dato registrado en el viaje).'))
  // BOM para que Excel reconozca los acentos (UTF-8).
  return '\uFEFF' + lineas.join('\r\n')
}

export function descargarCsv(nombreArchivo, contenido) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
