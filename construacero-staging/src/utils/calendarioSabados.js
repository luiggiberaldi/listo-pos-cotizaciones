// src/utils/calendarioSabados.js
// OP-2026-036 — Lógica pura y guardarraíles del Calendario Mensual de Sábados
// para el vendedor designado (compartida entre pantalla y servidor).

export const NOMBRES_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export const NOMBRES_MESES_CORTO = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

const pad2 = n => String(n).padStart(2, '0')

/**
 * Fecha actual en Venezuela (UTC-04:00 fijo todo el año) en formato YYYY-MM-DD.
 * Funciona igual en el navegador, en Node y en Cloudflare Workers (que corren en UTC),
 * evitando que a las 8:00 p. m. de Venezuela el sistema salte al día siguiente.
 */
export function getFechaCaracasISO(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : Number(now)
  const caracas = new Date(ms - 4 * 3600 * 1000)
  const y = caracas.getUTCFullYear()
  const m = pad2(caracas.getUTCMonth() + 1)
  const d = pad2(caracas.getUTCDate())
  return `${y}-${m}-${d}`
}

/**
 * Comprueba que una cadena tenga formato YYYY-MM-DD y sea una fecha real del calendario
 * (rechaza por ejemplo '2026-02-30' o '2026-13-01').
 */
export function esFechaISOValida(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  const [y, m, d] = fecha.split('-').map(Number)
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

/**
 * Guardarraíl 1: comprueba que una fecha ISO válida caiga exactamente en sábado (día 6).
 */
export function esFechaSabado(fecha) {
  if (!esFechaISOValida(fecha)) return false
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay() === 6
}

/**
 * Formatea una fecha YYYY-MM-DD en texto legible en español sin depender del huso del servidor.
 * - corto=true:  "Sáb 28 nov"
 * - corto=false: "Sábado 28 de noviembre de 2026"
 */
export function formatearSabadoLegible(fecha, { corto = false } = {}) {
  if (!esFechaISOValida(fecha)) return String(fecha || '')
  const [y, m, d] = fecha.split('-').map(Number)
  if (corto) {
    return `Sáb ${pad2(d)} ${NOMBRES_MESES_CORTO[m - 1]}`
  }
  return `Sábado ${d} de ${NOMBRES_MESES[m - 1].toLowerCase()} de ${y}`
}

/**
 * Devuelve el primer y último día del mes en formato YYYY-MM-DD y su título legible.
 * @param {number} anio Ej. 2026
 * @param {number} mes  1..12 (1 = enero, 11 = noviembre)
 */
export function obtenerRangoMesISO(anio, mes) {
  const y = Number(anio)
  const m = Number(mes)
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error('Año o mes inválido')
  }
  const ultimoDia = new Date(Date.UTC(y, m, 0, 12, 0, 0)).getUTCDate()
  return {
    anio: y,
    mes: m,
    desde: `${y}-${pad2(m)}-01`,
    hasta: `${y}-${pad2(m)}-${pad2(ultimoDia)}`,
    etiqueta: `${NOMBRES_MESES[m - 1]} ${y}`,
  }
}

/**
 * Desplaza (anio, mes) sumando o restando meses (ej. dic 2026 + 1 → ene 2027).
 */
export function desplazarMes(anio, mes, deltaMeses) {
  const total = Number(anio) * 12 + (Number(mes) - 1) + Number(deltaMeses || 0)
  const nuevoAnio = Math.floor(total / 12)
  const nuevoMes = (total % 12) + 1
  return { anio: nuevoAnio, mes: nuevoMes }
}

/**
 * Calcula cuál es el sábado de esta semana (hoy si es sábado, o el próximo sábado)
 * a partir de una fecha ISO local (YYYY-MM-DD).
 */
export function obtenerSabadoDeLaSemana(hoyISO = getFechaCaracasISO()) {
  if (!esFechaISOValida(hoyISO)) return hoyISO
  const [y, m, d] = hoyISO.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const dow = dt.getUTCDay() // 0=dom ... 6=sáb
  const diasFaltantes = dow === 6 ? 0 : (6 - dow + 7) % 7
  dt.setUTCDate(dt.getUTCDate() + diasFaltantes)
  const sy = dt.getUTCFullYear()
  const sm = pad2(dt.getUTCMonth() + 1)
  const sd = pad2(dt.getUTCDate())
  return `${sy}-${sm}-${sd}`
}

/**
 * Devuelve todos los sábados (4 o 5) del mes indicado, clasificados respecto a hoyISO:
 * - estado: 'pasado' | 'hoy' | 'proximo' | 'futuro'
 * - editable: false para sábados pasados (guardarraíl contra edición accidental), true para hoy y futuros
 */
export function obtenerSabadosDelMes(anio, mes, hoyISO = getFechaCaracasISO()) {
  const { hasta } = obtenerRangoMesISO(anio, mes)
  const ultimoDia = Number(hasta.slice(8, 10))
  const sabadoProximoGlobal = obtenerSabadoDeLaSemana(hoyISO)
  const sabados = []

  for (let d = 1; d <= ultimoDia; d++) {
    const fecha = `${anio}-${pad2(mes)}-${pad2(d)}`
    if (!esFechaSabado(fecha)) continue

    let estado = 'futuro'
    if (fecha < hoyISO) {
      estado = 'pasado'
    } else if (fecha === hoyISO) {
      estado = 'hoy'
    } else if (fecha === sabadoProximoGlobal) {
      estado = 'proximo'
    }

    sabados.push({
      fecha,
      dia: d,
      etiquetaCorta: formatearSabadoLegible(fecha, { corto: true }),
      etiquetaLarga: formatearSabadoLegible(fecha, { corto: false }),
      estado,
      editable: fecha >= hoyISO,
    })
  }

  return sabados
}

/**
 * Calcula la lista de cambios pendientes entre lo guardado en base de datos y la selección
 * en borrador del calendario para los sábados editables del mes.
 */
export function calcularCambiosCalendario(
  sabados = [],
  designacionesActuales = {},
  borradores = {},
  vendedoresPorId = {},
) {
  const cambios = []
  for (const s of sabados) {
    if (!s?.editable) continue
    const actualRow = designacionesActuales[s.fecha]
    const actualId = actualRow?.designado_id || ''
    const nuevoId = Object.prototype.hasOwnProperty.call(borradores, s.fecha)
      ? (borradores[s.fecha] || '')
      : actualId

    if (nuevoId === actualId) continue

    const anteriorNombre =
      actualRow?.designado?.nombre ||
      vendedoresPorId[actualId]?.nombre ||
      ''
    const nuevoNombre = vendedoresPorId[nuevoId]?.nombre || ''

    let tipo = 'asignar'
    if (actualId && !nuevoId) tipo = 'quitar'
    else if (actualId && nuevoId) tipo = 'cambiar'

    cambios.push({
      fecha: s.fecha,
      etiquetaCorta: s.etiquetaCorta,
      etiquetaLarga: s.etiquetaLarga,
      tipo,
      anteriorId: actualId || null,
      anteriorNombre,
      nuevoId: nuevoId || null,
      nuevoNombre,
      esHoy: s.estado === 'hoy',
    })
  }
  return cambios
}

/**
 * Cuenta cuántos sábados del mes tiene asignados cada vendedor (según el estado en pantalla)
 * para ayudar al jefe a repartir los sábados de forma pareja.
 */
export function contarTurnosPorVendedor(
  sabados = [],
  designacionesActuales = {},
  borradores = {},
  vendedoresPorId = {},
) {
  const conteo = new Map()
  for (const s of sabados) {
    const actualRow = designacionesActuales[s.fecha]
    const actualId = actualRow?.designado_id || ''
    const id = s.editable && Object.prototype.hasOwnProperty.call(borradores, s.fecha)
      ? (borradores[s.fecha] || '')
      : actualId
    if (!id) continue
    const nombre =
      vendedoresPorId[id]?.nombre ||
      actualRow?.designado?.nombre ||
      id
    const prev = conteo.get(id) || { id, nombre, cantidad: 0 }
    prev.cantidad += 1
    conteo.set(id, prev)
  }
  return Array.from(conteo.values()).sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre))
}

/**
 * Detecta si hoy es jueves, viernes o sábado y el sábado de esta semana aún no tiene
 * vendedor designado guardado en la base de datos.
 */
export function detectarAlertaSabadoSemana(designacionesActuales = {}, hoyISO = getFechaCaracasISO()) {
  if (!esFechaISOValida(hoyISO)) return { alerta: false }
  const [y, m, d] = hoyISO.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const dow = dt.getUTCDay() // 0=dom ... 4=jue, 5=vie, 6=sáb
  const diasFaltantes = dow === 6 ? 0 : (6 - dow + 7) % 7
  const fechaSabado = obtenerSabadoDeLaSemana(hoyISO)
  const tieneDesignado = Boolean(designacionesActuales[fechaSabado]?.designado_id)

  // Avisamos desde el jueves (faltan 2 días), viernes (1 día) o el mismo sábado (0 días)
  if (diasFaltantes <= 2 && !tieneDesignado) {
    const etiquetaLarga = formatearSabadoLegible(fechaSabado)
    const mensaje = diasFaltantes === 0
      ? `Hoy (${etiquetaLarga.toLowerCase()}) todavía no tiene vendedor designado.`
      : `Este próximo ${etiquetaLarga.toLowerCase()} todavía no tiene vendedor designado.`
    return {
      alerta: true,
      esHoySabado: diasFaltantes === 0,
      diasFaltantes,
      fecha: fechaSabado,
      anio: Number(fechaSabado.slice(0, 4)),
      mes: Number(fechaSabado.slice(5, 7)),
      etiquetaLarga,
      mensaje,
    }
  }

  return {
    alerta: false,
    esHoySabado: diasFaltantes === 0,
    diasFaltantes,
    fecha: fechaSabado,
  }
}

/**
 * Guardarraíl del servidor y cliente para validar un lote de cambios de sábados:
 * - No vacío, máximo 12 sábados por lote
 * - Sin fechas repetidas
 * - Todas las fechas deben ser sábados reales (YYYY-MM-DD)
 * - Ninguna fecha puede ser un sábado pasado (< hoyISO)
 * - Ninguna fecha puede superar el límite de meses hacia el futuro (por defecto 6 meses)
 */
export function validarLoteDesignaciones(
  cambios,
  { hoyISO = getFechaCaracasISO(), maxMesesFuturo = 6 } = {},
) {
  if (!Array.isArray(cambios) || cambios.length === 0) {
    return { ok: false, error: 'No hay cambios de sábados para guardar' }
  }
  if (cambios.length > 12) {
    return { ok: false, error: 'Solo se pueden guardar hasta 12 sábados a la vez' }
  }

  const [hy, hm] = hoyISO.split('-').map(Number)
  const limiteMes = desplazarMes(hy, hm, maxMesesFuturo)
  const { hasta: fechaMaxPermitida } = obtenerRangoMesISO(limiteMes.anio, limiteMes.mes)

  const vistas = new Set()
  const normalizados = []

  for (const item of cambios) {
    const fecha = String(item?.fecha || '').trim()
    if (!esFechaISOValida(fecha)) {
      return { ok: false, error: `Fecha inválida: ${fecha || '(vacía)'}` }
    }
    if (!esFechaSabado(fecha)) {
      return { ok: false, error: `La fecha ${fecha} no es un sábado` }
    }
    if (fecha < hoyISO) {
      return { ok: false, error: `No se puede modificar un sábado pasado (${fecha})` }
    }
    if (fecha > fechaMaxPermitida) {
      return { ok: false, error: `La fecha ${fecha} supera el límite de programación futura` }
    }
    if (vistas.has(fecha)) {
      return { ok: false, error: `Fecha repetida en el mismo envío: ${fecha}` }
    }
    vistas.add(fecha)

    const rawId = item?.designado_id
    const designadoId = rawId === null || rawId === undefined || String(rawId).trim() === ''
      ? null
      : String(rawId).trim()

    if (designadoId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(designadoId)) {
      return { ok: false, error: `designado_id inválido para el sábado ${fecha}` }
    }

    normalizados.push({ fecha, designado_id: designadoId })
  }

  return { ok: true, cambios: normalizados }
}
