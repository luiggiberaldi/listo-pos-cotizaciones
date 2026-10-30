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
/**
 * Arma un CSV (separador ';', apto para Excel en español) con:
 *  - resumen del período (y del anterior, si se pasa);
 *  - Cuadro 1 detallado por camión (migración 286);
 *  - Cuadro 2 por chofer local (reparto chofer / empresa, sin pagado);
 *  - viajes de choferes locales sin camión registrado;
 *  - detalle viaje por viaje (si se pasa).
 * Los viajes estimados llevan la marca ≈ y una nota al pie.
 */
export function construirCsvFlota({
  porVehiculo = [], porChofer = [], desde = '', hasta = '',
  sinCamion = null, detalle = [], detalleSinCamion = [], anterior = null,
}) {
  const lineas = []
  const fila = (valores) => lineas.push(valores.map(celda).join(';'))
  const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-VE', { timeZone: 'America/Caracas' }) : '')
  const tot = totalesVehiculos(porVehiculo)
  const totEmpresa = porVehiculo.reduce((acc, v) => acc + num(v.empresa_usd), 0)
  const totChoferes = porVehiculo.reduce((acc, v) => acc + num(v.comision_choferes_usd), 0)
  const dias = diasDelPeriodo(desde, hasta)

  fila(['Reporte de flota y choferes locales', `Desde ${desde || 'inicio'}`, `Hasta ${hasta || 'hoy'}`])
  lineas.push('')
  lineas.push('Resumen del periodo')
  fila(['Concepto', 'Este periodo', ...(anterior ? ['Periodo anterior', 'Variacion'] : [])])
  const totAnt = anterior ? totalesVehiculos(anterior) : null
  const empresaAnt = anterior ? anterior.reduce((acc, v) => acc + num(v.empresa_usd), 0) : 0
  fila(['Viajes de la flota', tot.viajes, ...(anterior ? [totAnt.viajes, variacion(tot.viajes, totAnt.viajes).texto] : [])])
  fila(['Fletes cobrados USD', decimal(tot.flete), ...(anterior ? [decimal(totAnt.flete), variacion(tot.flete, totAnt.flete).texto] : [])])
  fila(['Para los choferes USD', decimal(totChoferes)])
  fila(['Para la empresa USD', decimal(totEmpresa), ...(anterior ? [decimal(empresaAnt), variacion(totEmpresa, empresaAnt).texto] : [])])
  fila(['Viajes sin camion registrado', num(sinCamion?.viajes), 'Fletes USD', decimal(sinCamion?.flete_usd)])

  lineas.push('')
  lineas.push('Cuadro 1 - Productividad por vehiculo')
  fila(['Vehiculo', 'Modelo', 'Placa chuto', 'Placa batea', 'Activo', 'Viajes', '% del total',
    dias ? `Dias trabajados (de ${dias})` : 'Dias trabajados', 'Viajes estimados (≈)',
    'Fletes USD', 'Para choferes USD', 'Para la empresa USD', 'Mercancia USD', 'Flete promedio por viaje USD',
    'En Carabobo', 'Fuera de Carabobo', 'Destinos frecuentes', 'Ultimo viaje', 'Chofer del ultimo viaje', 'Choferes'])
  for (const f of porVehiculo) {
    fila([
      f.nombre, f.modelo || '', f.placa, f.placa_batea || '', f.activo === false ? 'No' : 'Si',
      num(f.total_viajes), porcentaje(f.total_viajes, tot.viajes), num(f.dias_trabajados), num(f.viajes_estimados),
      decimal(f.total_flete_usd), decimal(f.comision_choferes_usd), decimal(f.empresa_usd),
      decimal(f.total_mercancia_usd), decimal(f.promedio_flete_viaje_usd),
      num(f.viajes_en_carabobo), num(f.viajes_fuera_carabobo), textoDestinos(f.destinos_top),
      fecha(f.ultimo_viaje_en), f.ultimo_chofer_nombre || '', textoDesgloseChoferes(f.desglose_choferes),
    ])
  }
  fila(['Total', '', '', '', '', '', tot.viajes, 100, '', tot.estimados, decimal(tot.flete), decimal(totChoferes), decimal(totEmpresa), decimal(tot.mercancia)])

  lineas.push('')
  lineas.push('Cuadro 2 - Productividad por chofer local')
  fila(['Chofer', 'Activo', 'Vehiculo habitual', 'Viajes', 'En Carabobo', 'Fuera de Carabobo', 'Viajes estimados (≈)',
    'Fletes USD', 'Mercancia USD', 'Para el chofer USD', 'Para la empresa USD', 'Vehiculos usados'])
  for (const c of porChofer) {
    fila([
      c.chofer_nombre, c.activo === false ? 'No' : 'Si',
      c.vehiculo_habitual_nombre ? `${c.vehiculo_habitual_nombre} (${c.vehiculo_habitual_placa || ''})` : 'Rotativo',
      num(c.total_viajes), num(c.viajes_en_carabobo), num(c.viajes_fuera_carabobo), num(c.viajes_estimados),
      decimal(c.total_flete_usd), decimal(c.total_mercancia_usd),
      decimal(c.comision_generada_usd), decimal(num(c.total_flete_usd) - num(c.comision_generada_usd)),
      textoDesgloseVehiculos(c.desglose_vehiculos),
    ])
  }

  const filaViaje = (v) => fila([
    fecha(v.fecha), `DES-${String(v.numero).padStart(5, '0')}${v.vehiculo_origen === 'backfill' ? ' ≈' : ''}`,
    v.cliente_nombre || '', [v.ciudad, v.estado_destino].filter(Boolean).join(', '), v.chofer_nombre || '',
    v.vehiculo_nombre || 'Sin camion', decimal(v.flete_usd), decimal(v.chofer_usd), decimal(v.empresa_usd), decimal(v.mercancia_usd),
  ])
  const encabezadoViajes = ['Fecha', 'Despacho', 'Cliente', 'Destino', 'Chofer', 'Camion', 'Flete USD', 'Chofer USD', 'Empresa USD', 'Mercancia USD']
  if (detalle.length > 0) {
    lineas.push('')
    lineas.push('Detalle viaje por viaje (camiones de la empresa)')
    fila(encabezadoViajes)
    detalle.forEach(filaViaje)
  }
  if (detalleSinCamion.length > 0) {
    lineas.push('')
    lineas.push('Viajes de choferes locales sin camion registrado')
    fila(encabezadoViajes)
    detalleSinCamion.forEach(filaViaje)
  }

  lineas.push('')
  lineas.push(celda('≈ = viajes viejos cuyo camion se estimo con la ficha del chofer (no es un dato registrado en el viaje).'))
  lineas.push(celda('Para la empresa = fletes menos la comision del chofer (los fletes dentro de Carabobo quedan para la empresa; ahi el chofer cobra por nomina).'))
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

// ── Ayudantes del reporte detallado por camión (migración 286) ───────────────

function aFecha(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function aIso(fecha) {
  return fecha.toISOString().slice(0, 10)
}

/** Días calendario del rango (ambos incluidos); null si no hay rango completo. */
export function diasDelPeriodo(desde, hasta) {
  if (!desde || !hasta) return null
  return Math.round((aFecha(hasta) - aFecha(desde)) / 86400000) + 1
}

/** Período inmediatamente anterior con la misma cantidad de días. */
export function periodoAnterior(desde, hasta) {
  const dias = diasDelPeriodo(desde, hasta)
  if (!dias) return null
  const fin = aFecha(desde)
  fin.setUTCDate(fin.getUTCDate() - 1)
  const inicio = new Date(fin)
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1))
  return { desde: aIso(inicio), hasta: aIso(fin) }
}

/** Variación contra el período anterior: { signo: 'sube'|'baja'|'igual'|'nuevo', texto }. */
export function variacion(actual, anterior) {
  const a = num(actual)
  const b = num(anterior)
  if (a === b) return { signo: 'igual', texto: '= igual' }
  if (b === 0) return { signo: 'nuevo', texto: '▲ nuevo' }
  const pct = Math.round(((a - b) / b) * 100)
  return pct >= 0 ? { signo: 'sube', texto: `▲ ${pct}%` } : { signo: 'baja', texto: `▼ ${Math.abs(pct)}%` }
}

/** Porcentaje entero de parte sobre total (0 si total es 0). */
export function porcentaje(parte, total) {
  const t = num(total)
  return t > 0 ? Math.round((num(parte) / t) * 100) : 0
}

/** "Valencia, Carabobo (5) · Maracay, Aragua (2)" */
export function textoDestinos(destinos = []) {
  return (destinos || []).map(d => `${d.destino} (${num(d.viajes)})`).join(' · ')
}
