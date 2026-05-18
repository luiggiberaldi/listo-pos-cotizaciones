import { round2 } from './dinero'

/**
 * Calcula la comisión estimada sobre un array de items de cotización.
 * Respeta: categoría cabilla, extras por categoría y otros.
 * Agrupa el detalle por categoría (no por ítem) para uso limpio en UI.
 *
 * @param {Array}  items  - [{categoria, total_linea_usd}]
 * @param {Object} config - Objeto de configuracion_negocio
 */
export function getComisionPctForItem(item, config = {}) {
  const pctCabilla = Number(config.comision_pct_cabilla || 0)
  const pctOtros   = Number(config.comision_pct_otros   || 0)
  const catCabilla = (config.comision_categoria_cabilla || 'Cabilla').toLowerCase().trim()

  const nombre = (item.nombreSnap || item.nombre_snap || item.nombre || '').toLowerCase()
  const origen = item.origen || item.producto?.origen || 'inventario'
  
  if (origen === 'externo' && nombre.includes('corte')) {
    return 0
  }

  let extras = []
  try {
    extras = typeof config._comision_extras === 'string'
      ? JSON.parse(config._comision_extras)
      : (config._comision_extras || [])
    if (!Array.isArray(extras)) extras = []
  } catch { extras = [] }

  let cat = (item.categoria || item.producto?.categoria || 'otros').toLowerCase().trim()
  
  if ((cat === 'otros' || !cat) && nombre.includes(catCabilla)) {
    cat = catCabilla
  }

  if (cat === catCabilla) return pctCabilla
  const extra = extras.find(e => (e.cat || '').toLowerCase().trim() === cat)
  return extra ? Number(extra.pct) : pctOtros
}

/**
 * Calcula la estimación de comisión de un conjunto de ítems.
 * @param {Array} items 
 * @param {Object} config 
 * @returns {{
 *   monto:   number,        // Total comisión estimada
 *   pct:     number|null,   // % único si todos iguales, null si mixto
 *   mixto:   boolean,       // true si hay más de un % en los items
 *   detalle: Array          // [{cat, pct, monto, comision}] — 1 línea por categoría
 * }}
 */
export function calcComisionEstimada(items = [], config = {}) {
  const pctCabilla = Number(config.comision_pct_cabilla || 0)
  const pctOtros   = Number(config.comision_pct_otros   || 0)
  const catCabilla = (config.comision_categoria_cabilla || 'Cabilla').toLowerCase().trim()

  // Parsear extras de forma segura
  let extras = []
  try {
    extras = typeof config._comision_extras === 'string'
      ? JSON.parse(config._comision_extras)
      : (config._comision_extras || [])
    if (!Array.isArray(extras)) extras = []
  } catch { extras = [] }

  // Acumulador por categoría → evita 50 líneas para 50 productos de "Otros"
  const acum = {}

  for (const item of items) {
    let cat = (item.categoria || 'otros').toLowerCase().trim()
    const nombre = (item.nombreSnap || item.nombre_snap || item.nombre || '').toLowerCase()
    
    if ((cat === 'otros' || !cat) && nombre.includes(catCabilla)) {
      cat = catCabilla
    }
    
    const monto = Number(item.total_linea_usd) || Number(item.total) || (Number(item.cantidad) * Number(item.precioUnitUsd || item.precio_unit_usd)) || 0
    if (monto <= 0) continue

    const origen = item.origen || item.producto?.origen || 'inventario'

    let pct
    if (origen === 'externo' && nombre.includes('corte')) {
      pct = 0
      cat = 'externo_corte'
    } else if (cat === catCabilla) {
      pct = pctCabilla
    } else {
      const extra = extras.find(e => (e.cat || '').toLowerCase().trim() === cat)
      if (extra) {
        pct = Number(extra.pct)
      } else {
        pct = pctOtros
        cat = 'otros'
      }
    }

    if (!acum[cat]) acum[cat] = { cat, pct, monto: 0, comision: 0 }
    acum[cat].monto    += monto
    acum[cat].comision += monto * pct / 100
  }

  // Redondear al final (no por ítem → evita error de centavo acumulado)
  const detalle = Object.values(acum)
    .filter(d => d.pct > 0)
    .map(d => ({
      ...d,
      monto:    round2(d.monto),
      comision: round2(d.comision),
    }))

  const totalComision = round2(detalle.reduce((s, d) => s + d.comision, 0))
  const pctsUnicos    = [...new Set(detalle.map(d => d.pct))]

  return {
    monto:  totalComision,
    pct:    pctsUnicos.length === 1 ? pctsUnicos[0] : (pctsUnicos.length === 0 ? 0 : null),
    mixto:  pctsUnicos.length > 1,
    detalle, // máx N líneas donde N = número de categorías distintas con comisión > 0
  }
}
