// src/utils/ventasDia.js
// Reporte "Ventas del día" (hoja que Logística entrega a Administración los sábados).
// Arma, a partir de los despachos creados en un día, una fila por nota con cada forma de pago en su
// columna, los subtotales, el resumen (cobrado / por cobrar / total) y las notas que faltan en la
// numeración. Lo usan el servidor (api/handlers/ventasDia.js), la pantalla y el PDF; no consulta la base.
// Los montos de los despachos están en dólares; los bolívares se calculan con la tasa que se elija.

export const ROLES_VENTAS_DIA = ['logistica', 'desarrollador']
export const MAX_FALTANTES_CONSULTA = 200

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const n = v => Number(v) || 0
const r2 = v => Math.round(v * 100) / 100

export function sumarDiasFecha(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// Día de Venezuela (UTC-4) → rango para consultar.
export function validarFechaVentasDia(fecha) {
  if (!FECHA_RE.test(fecha || '') || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) return { error: 'Fecha inválida' }
  return { fecha, desdeTs: `${fecha}T00:00:00-04:00`, hastaTs: `${sumarDiasFecha(fecha, 1)}T00:00:00-04:00` }
}

// Fecha (YYYY-MM-DD) de Venezuela para un timestamp.
export function fechaVenezuela(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() - 4 * 3600000).toISOString().slice(0, 10)
}

// Columnas de la hoja, en el orden en que se muestran. `bs: true` = se muestra en bolívares.
export const COLUMNAS_PAGO = [
  { id: 'efectivoUsd', label: 'Efectivo $', corto: 'Efectivo $', bs: false, cobrado: true },
  { id: 'efectivoBs', label: 'Efectivo Bs', corto: 'Efectivo Bs', bs: true, cobrado: true },
  { id: 'pagoMovil', label: 'Pago móvil / Transf. Bs', corto: 'P. móvil Bs', bs: true, cobrado: true },
  { id: 'punto', label: 'Punto de venta Bs', corto: 'Punto Bs', bs: true, cobrado: true },
  { id: 'zelle', label: 'Zelle $', corto: 'Zelle $', bs: false, cobrado: true },
  { id: 'usdt', label: 'USDT', corto: 'USDT', bs: false, cobrado: true },
  { id: 'porCobrar', label: 'Por cobrar $', corto: 'Por cobrar $', bs: false, cobrado: false },
  { id: 'cobroDestino', label: 'Cobro al entregar $', corto: 'Al entregar $', bs: false, cobrado: false },
  { id: 'otros', label: 'Otros $', corto: 'Otros $', bs: false, cobrado: false },
]

const sinAcentos = s => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

export function columnaDeMetodo(metodo) {
  const m = sinAcentos(metodo)
  if (!m) return 'otros'
  if (m === 'efectivo $' || m === 'efectivo' || m === 'efectivo usd') return 'efectivoUsd'
  if (m === 'efectivo bs') return 'efectivoBs'
  if (m.includes('movil') || m.includes('transf')) return 'pagoMovil'
  if (m.includes('punto')) return 'punto'
  if (m.includes('zelle')) return 'zelle'
  if (m.includes('usdt')) return 'usdt'
  if (m.includes('por cobrar') || m.includes('credito')) return 'porCobrar'
  if (m.includes('cobro a destino') || m.includes('destino')) return 'cobroDestino'
  return 'otros'
}

export function leerPagos(formaPago) {
  let fps = formaPago
  if (typeof fps === 'string') {
    try { fps = JSON.parse(fps) } catch { return fps.trim() ? [{ metodo: fps.trim(), monto: null }] : [] }
  }
  if (!Array.isArray(fps)) return []
  return fps.filter(p => p && typeof p === 'object')
}

const vacios = () => Object.fromEntries(COLUMNAS_PAGO.map(c => [c.id, 0]))

/**
 * @param despachos  despachos creados ese día (todos los estados) {id,numero,cliente_id,estado,creado_en,total_usd,forma_pago,referencia_pago}
 * @param clientes   {id,nombre}
 * @param otrosNumeros despachos con números que faltan en la secuencia del día {numero,estado,creado_en}
 */
export function construirVentasDia({ fecha, despachos = [], clientes = [], otrosNumeros = [] }) {
  const clientePorId = new Map(clientes.map(c => [c.id, c]))
  const activos = despachos.filter(d => d.estado !== 'anulada')
  const anuladas = despachos.filter(d => d.estado === 'anulada')
  const ordenados = [...activos].sort((a, b) => n(a.numero) - n(b.numero))

  const totales = vacios()
  let totalVendido = 0

  const filas = ordenados.map((d, i) => {
    const montos = vacios()
    // Bolívares reales cuando el pago los trae (monto_bs); si algún pago de la columna no los trae,
    // esa columna se calcula con la tasa del día.
    const bsReales = vacios()
    const bsIncompleto = new Set()
    const referencias = []
    const etiquetasOtros = []
    const pagos = leerPagos(d.forma_pago)
    for (const p of pagos) {
      const col = columnaDeMetodo(p.metodo)
      // Un pago sin monto (dato viejo con solo el nombre del método) se toma como el total.
      const monto = p.monto === null || p.monto === undefined ? n(d.total_usd) : n(p.monto)
      montos[col] += monto
      if (Number(p.monto_bs) > 0) bsReales[col] += Number(p.monto_bs)
      else if (monto) bsIncompleto.add(col)
      if (col === 'otros' && p.metodo) etiquetasOtros.push(p.metodo)
      if (p.referencia) referencias.push(String(p.referencia).trim())
    }
    if (d.referencia_pago && !referencias.includes(String(d.referencia_pago).trim())) referencias.push(String(d.referencia_pago).trim())

    for (const k of Object.keys(montos)) { montos[k] = r2(montos[k]); totales[k] += montos[k] }
    const sumaPagos = r2(Object.values(montos).reduce((s, v) => s + v, 0))
    const total = r2(n(d.total_usd))
    totalVendido += total

    const avisos = []
    if (sumaPagos === 0) avisos.push('Sin pago registrado')
    else if (Math.abs(sumaPagos - total) > 0.01) avisos.push(`Los pagos (${sumaPagos.toFixed(2)} $) no cuadran con el total`)
    if (d.estado === 'pendiente') avisos.push('Pendiente de aprobar')

    return {
      item: i + 1,
      id: d.id,
      numero: d.numero,
      cliente: clientePorId.get(d.cliente_id)?.nombre || 'Cliente no disponible',
      estado: d.estado,
      montos,
      montosBs: Object.fromEntries(COLUMNAS_PAGO.filter(c => c.bs && montos[c.id] && !bsIncompleto.has(c.id) && bsReales[c.id] > 0).map(c => [c.id, r2(bsReales[c.id])])),
      totalUsd: total,
      referencias: [...new Set(referencias.filter(Boolean))],
      otrosDetalle: [...new Set(etiquetasOtros)],
      avisos,
    }
  })

  for (const k of Object.keys(totales)) totales[k] = r2(totales[k])
  const cobradoUsd = r2(COLUMNAS_PAGO.filter(c => c.cobrado).reduce((s, c) => s + totales[c.id], 0))
  const porCobrarUsd = r2(totales.porCobrar + totales.cobroDestino)

  return {
    fecha,
    filas,
    columnasUsadas: COLUMNAS_PAGO.filter(c => totales[c.id] !== 0 || filas.some(f => f.montos[c.id] !== 0)).map(c => c.id),
    totales,
    resumen: {
      notas: filas.length,
      cobradoUsd,
      porCobrarUsd,
      otrosUsd: totales.otros,
      totalVendidoUsd: r2(totalVendido),
      efectivoUsdEsperado: totales.efectivoUsd,
      efectivoBsEsperadoUsd: totales.efectivoBs,
    },
    faltantes: notasFaltantes({ fecha, despachos, otrosNumeros }),
  }
}

// Números que faltan entre la primera y la última nota del día, con el motivo.
export function numerosFaltantes(despachos = []) {
  const nums = despachos.map(d => n(d.numero)).filter(x => x > 0)
  if (!nums.length) return []
  const presentes = new Set(despachos.filter(d => d.estado !== 'anulada').map(d => n(d.numero)))
  const min = Math.min(...nums), max = Math.max(...nums)
  const faltan = []
  for (let x = min; x <= max && faltan.length < MAX_FALTANTES_CONSULTA; x++) if (!presentes.has(x)) faltan.push(x)
  return faltan
}

export function notasFaltantes({ fecha, despachos = [], otrosNumeros = [] }) {
  const delDia = new Map(despachos.map(d => [n(d.numero), d]))
  const otros = new Map(otrosNumeros.map(d => [n(d.numero), d]))
  return numerosFaltantes(despachos).map(numero => {
    const d = delDia.get(numero) || otros.get(numero)
    if (!d) return { numero, motivo: 'No existe en el sistema' }
    if (d.estado === 'anulada') return { numero, motivo: 'Anulada' }
    const f = fechaVenezuela(d.creado_en)
    if (f && f !== fecha) {
      const [y, m, dd] = f.split('-')
      return { numero, motivo: `Es de otro día (${dd}/${m}/${y})` }
    }
    return { numero, motivo: 'Revisar' }
  })
}

// Montos de una columna para mostrar: en Bs si la columna es de bolívares.
export function montoMostrado(columnaId, usd, tasa) {
  const col = COLUMNAS_PAGO.find(c => c.id === columnaId)
  if (col?.bs) return n(tasa) > 0 ? r2(n(usd) * n(tasa)) : null
  return r2(n(usd))
}

// Lo que se muestra en una celda: Bs reales si la fila los tiene; si no, dólares × tasa.
export function montoFila(fila, columnaId, tasa) {
  const real = fila.montosBs?.[columnaId]
  if (real !== undefined) return real
  return montoMostrado(columnaId, fila.montos[columnaId], tasa)
}

// Subtotal de una columna tal como se muestra (suma de las celdas).
export function subtotalMostrado(reporte, columnaId, tasa) {
  const col = COLUMNAS_PAGO.find(c => c.id === columnaId)
  if (!col?.bs) return r2(n(reporte.totales[columnaId]))
  let suma = 0
  for (const f of reporte.filas) {
    if (!f.montos[columnaId]) continue
    const v = montoFila(f, columnaId, tasa)
    if (v === null) return null
    suma += v
  }
  return r2(suma)
}

export function cuadreEfectivo(esperado, contado) {
  if (contado === '' || contado === null || contado === undefined || Number.isNaN(Number(contado))) return null
  const dif = r2(n(contado) - n(esperado))
  return { esperado: r2(n(esperado)), contado: r2(n(contado)), diferencia: dif, estado: dif === 0 ? 'cuadra' : dif > 0 ? 'sobra' : 'falta' }
}
