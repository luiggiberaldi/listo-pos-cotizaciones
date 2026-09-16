// Lecturas completas, explícitas y acotadas al tenant para el inicio.
export async function readAllRows(env, headers, table, params, { signal, maxRows = 200000 } = {}) {
  const rows = []
  const pageSize = 500
  for (let offset = 0; offset <= maxRows; ) {
    const query = new URLSearchParams(params)
    query.set('order', 'id.asc')
    query.set('limit', String(pageSize))
    query.set('offset', String(offset))
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { ...headers, Prefer: 'count=exact' }, signal,
    })
    if (!response.ok) throw new Error(`No se pudo consultar ${table} (HTTP ${response.status})`)
    const batch = await response.json()
    if (!Array.isArray(batch)) throw new Error(`Respuesta inválida de ${table}`)
    const range = response.headers?.get('content-range')
    const totalText = range?.split('/')[1]
    const total = totalText && totalText !== '*' ? Number(totalText) : null
    if (total !== null && (!Number.isSafeInteger(total) || total < 0)) {
      throw new Error(`Conteo inválido de ${table}`)
    }
    rows.push(...batch)
    if (rows.length > maxRows || (total !== null && total > maxRows)) {
      throw new Error('El período supera el límite de lectura. Selecciona un período más corto.')
    }
    offset += batch.length
    if (total !== null && offset >= total) return rows
    if (!batch.length) {
      if (total !== null && offset < total) throw new Error(`Lectura incompleta de ${table}`)
      return rows
    }
    // Incluso una página corta puede ser el límite configurado en PostgREST.
    // Sin count=exact no se asume que la primera página es todo el historial.
  }
  throw new Error('No se pudo completar la lectura del período')
}

export function splitIds(ids, size = 50) {
  const unique = [...new Set(ids.filter(Boolean))]
  return Array.from({ length: Math.ceil(unique.length / size) }, (_, i) => unique.slice(i * size, (i + 1) * size))
}

export function getDashboardPeriod(id = 'mes', now = new Date()) {
  if (!['mes', 'anterior', 'historico'].includes(id)) throw new Error('Período inválido')
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const parts = Object.fromEntries(date.map(part => [part.type, part.value]))
  const year = Number(parts.year)
  const month = Number(parts.month)
  const start = (y, m) => `${y}-${String(m).padStart(2, '0')}-01T00:00:00-04:00`
  const next = month === 12 ? start(year + 1, 1) : start(year, month + 1)
  const previous = month === 1 ? start(year - 1, 12) : start(year, month - 1)
  const base = { id, timeZone: 'America/Caracas' }
  if (id === 'historico') return { ...base, label: 'Todo el historial', desde: null, hasta: now.toISOString() }
  if (id === 'anterior') return { ...base, label: 'Mes anterior', desde: previous, hasta: start(year, month) }
  return { ...base, label: 'Este mes', desde: start(year, month), hasta: next }
}

export function addPeriod(params, period, field = 'creado_en') {
  if (period.desde) params.append(field, `gte.${period.desde}`)
  if (period.hasta) params.append(field, `lt.${period.hasta}`)
  return params
}

export function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

// No se inventan costos históricos ni se confunde facturación con beneficio.
export function estimateGrossProfit(sales, items, products) {
  const byDispatch = new Map()
  for (const item of items) {
    if (!byDispatch.has(item.despacho_id)) byDispatch.set(item.despacho_id, [])
    byDispatch.get(item.despacho_id).push(item)
  }
  const costs = new Map(products.map(product => [product.id, product.costo_usd]))
  let eligibleSales = 0
  let totalCost = 0
  let missingDispatches = 0
  for (const sale of sales) {
    const lines = byDispatch.get(sale.id) ?? []
    let complete = lines.length > 0
    let cost = 0
    for (const line of lines) {
      const value = costs.get(line.producto_id)
      const quantity = Number(line.cantidad)
      if (line.es_prestamo || value == null || value === '' || !Number.isFinite(Number(value))
        || Number(value) < 0 || !Number.isFinite(quantity) || quantity < 0) {
        complete = false
      } else {
        cost += Number(value) * quantity
      }
    }
    if (!complete) {
      missingDispatches++
      continue
    }
    // total_usd ya incluye el descuento aplicado: NO restarlo dos veces.
    eligibleSales += Math.max(0, Number(sale.total_usd || 0) - Number(sale.flete_usd || 0) - Number(sale.corte_usd || 0))
    totalCost += cost
  }
  return {
    brutaEstimadaUsd: missingDispatches ? null : money(eligibleSales - totalCost),
    ventasConCostoUsd: money(eligibleSales),
    costoProductosUsd: money(totalCost),
    despachosSinCosto: missingDispatches,
    despachosConCosto: sales.length - missingDispatches,
    base: 'costos_actuales',
    descripcion: 'Ventas sin flete ni corte menos costos actuales de productos. No es utilidad neta ni costo histórico; no descuenta comisiones, gastos ni impuestos.',
  }
}
