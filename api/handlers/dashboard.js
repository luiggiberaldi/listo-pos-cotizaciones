// Inicio: el servidor decide el alcance y devuelve únicamente el DTO permitido.
import { validateOperator } from '../lib/auth.js'
import { json, jsonError } from '../lib/utils.js'
import { readAllRows, splitIds, getDashboardPeriod, addPeriod, money } from '../lib/dashboardData.js'
import { getDashboardAccess, SELLER_ROLES } from '../../src/utils/dashboardAccess.js'
import { isDonationPayment, isLoanPayment } from '../../src/utils/comisionUtils.js'
import { enrichCommissions } from './comisiones.js'

const noStore = response => {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Vary', 'Authorization, X-Operator-Session, X-Operator-Id, Origin')
  return response
}

function paramsFor(table, cuentaId, select) {
  return new URLSearchParams({ select, [table === 'comisiones' ? 'cuentaid' : 'cuenta_id']: `eq.${cuentaId}` })
}

async function readFinancialData(env, headers, user, operador, access, period, signal) {
  let sellers = []
  if (access.team) {
    const params = paramsFor('usuarios', user.id, 'id,nombre,color,rol,activo,es_externo')
    params.set('rol', `in.(${SELLER_ROLES.join(',')})`)
    params.set('activo', 'eq.true')
    sellers = await readAllRows(env, headers, 'usuarios', params, { signal })
  }
  const sellerIds = new Set(sellers.map(seller => seller.id))
  const own = access.scope === 'propio'
  const team = access.scope === 'equipo'
  const selected = own ? [operador.id] : team ? [...sellerIds] : null
  const salesParams = paramsFor('notas_despacho', user.id,
    'id,numero,cuenta_id,vendedor_id,total_usd,creado_en,estado,flete_usd,corte_usd,forma_pago,forma_pago_cliente')
  salesParams.set('estado', 'in.(despachada,entregada)')
  addPeriod(salesParams, period)

  // Se preservan comisiones históricas y la excepción existente de vendedor externo.
  // 'Sin comisión' describe la configuración actual, no borra ganancias anteriores.
  const commissionParams = paramsFor('comisiones', user.id,
    'id,despachoid,vendedorid,cotizacionid,cuentaid,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,estado,creadoen,actualizadoen,despacho:notas_despacho!inner(creado_en,estado,cuenta_id)')
  commissionParams.set('despacho.cuenta_id', `eq.${user.id}`)
  commissionParams.set('despacho.estado', 'in.(despachada,entregada)')
  addPeriod(commissionParams, period, 'despacho.creado_en')

  // Un supervisor solo consulta vendedores, no las operaciones del jefe/administración.
  const chunks = selected ? splitIds(selected) : [null]
  // Los bloques de ventas y comisiones son lecturas independientes: se piden en paralelo
  // (el resto de la función solo depende de estas filas, no entre sí).
  let sales = []
  let commissions = []
  await Promise.all([
    Promise.all(chunks.map(ids => {
      const params = new URLSearchParams(salesParams)
      if (ids) params.set('vendedor_id', `in.(${ids.join(',')})`)
      return readAllRows(env, headers, 'notas_despacho', params, { signal })
    })).then(results => { sales = results.flat() }),
    Promise.all(chunks.map(ids => {
      const params = new URLSearchParams(commissionParams)
      if (ids) params.set('vendedorid', `in.(${ids.join(',')})`)
      return readAllRows(env, headers, 'comisiones', params, { signal })
    })).then(results => { commissions = results.flat() }),
  ])
  sales = sales.filter(sale => {
    if (sale.cuenta_id !== user.id) throw new Error('Respuesta fuera de la cuenta autorizada')
    if (own && sale.vendedor_id !== operador.id) throw new Error('Respuesta fuera del alcance del operador')
    if (team && !sellerIds.has(sale.vendedor_id)) throw new Error('Respuesta fuera del equipo autorizado')
    const payment = sale.forma_pago_cliente || sale.forma_pago
    return !isDonationPayment(payment) && !isLoanPayment(payment)
  })
  const result = {
    ventas: { totalUsd: money(sales.reduce((sum, sale) => sum + Number(sale.total_usd || 0), 0)), despachos: sales.length },
    ultimasVentas: [...sales].sort((a, b) => b.creado_en.localeCompare(a.creado_en)).slice(0, 8)
      .map(sale => ({ id: sale.id, numero: sale.numero, fecha: sale.creado_en, totalUsd: money(sale.total_usd), estado: sale.estado })),
  }

  for (const row of commissions) {
    if (row.cuentaid !== user.id || (own && row.vendedorid !== operador.id) || (team && !sellerIds.has(row.vendedorid))) {
      throw new Error('Comisiones fuera del alcance del operador')
    }
  }
  // Misma política de CxC, donaciones, préstamos y productos que el módulo Comisiones.
  // Los registros modernos ya vienen netos; solo los legacy necesitan enriquecimiento.
  const legacy = commissions.filter(row => row.estado !== 'generada')
  commissions = [
    ...commissions.filter(row => row.estado === 'generada').map(row => ({
      vendedorid: row.vendedorid, despachoid: row.despachoid, totalcomision: Number(row.totalcomision || 0),
    })),
    ...(legacy.length ? await enrichCommissions(env, headers, legacy, user.id, { strict: true }) : []),
  ]
  commissions = commissions.filter(row => Number(row.totalcomision) > 0)
  result.comisiones = {
    totalUsd: money(commissions.reduce((sum, row) => sum + Number(row.totalcomision), 0)),
    despachos: new Set(commissions.map(row => row.despachoid)).size,
    sinComisionConfigurada: Boolean(access.noCommission && !operador.es_externo),
  }

  if (access.team) {
    const rows = new Map(sellers.map(seller => [seller.id, {
      id: seller.id, nombre: seller.nombre, color: /^#[0-9a-f]{6}$/i.test(seller.color) ? seller.color : '#1B365D',
      rol: seller.rol, activo: seller.activo, externo: Boolean(seller.es_externo),
      ventasUsd: 0, despachos: 0, comisionesUsd: 0,
    }]))
    for (const sale of sales) {
      const row = rows.get(sale.vendedor_id)
      if (row) { row.ventasUsd += Number(sale.total_usd || 0); row.despachos++ }
    }
    for (const commission of commissions) {
      const row = rows.get(commission.vendedorid)
      if (row) row.comisionesUsd += Number(commission.totalcomision || 0)
    }
    result.equipo = [...rows.values()].map(row => ({ ...row, ventasUsd: money(row.ventasUsd), comisionesUsd: money(row.comisionesUsd) }))
      .sort((a, b) => b.ventasUsd - a.ventasUsd || a.nombre.localeCompare(b.nombre, 'es'))
  }
  return result
}

async function readOperations(env, headers, user, access, signal, now) {
  const isAdministration = access.scope === 'administracion'
  const isLogistics = access.scope === 'logistica'
  const today = getDashboardPeriod('hoy', now)
  const params = paramsFor('notas_despacho', user.id, 'id,numero,estado,creado_en,entregada_en,cliente_id')
  params.set('estado', access.deliveries ? 'in.(despachada,entregada)' : 'eq.pendiente')
  if (isAdministration || isLogistics) {
    params.set('creado_en', `gte.${today.desde}`)
    params.append('creado_en', `lt.${today.hasta}`)
  }
  const dispatches = await readAllRows(env, headers, 'notas_despacho', params, { signal })
  const pending = dispatches.filter(row => row.estado === (access.deliveries ? 'despachada' : 'pendiente'))
  const result = { operaciones: { pendientes: pending.length } }
  if (access.deliveries) {
    const localDate = value => new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/Caracas' })
    result.operaciones.entregadasHoy = dispatches.filter(row => row.estado === 'entregada' && row.entregada_en && localDate(row.entregada_en) === localDate(now)).length
  }
  const latest = [...pending].sort((a, b) => a.creado_en.localeCompare(b.creado_en)).slice(0, 6)
  const clients = []
  for (const ids of splitIds(latest.map(row => row.cliente_id))) {
    const query = paramsFor('clientes', user.id, 'id,nombre,ciudad,estado')
    query.set('id', `in.(${ids.join(',')})`)
    clients.push(...await readAllRows(env, headers, 'clientes', query, { signal }))
  }
  const names = new Map(clients.map(row => [row.id, row]))
  result.operaciones.despachos = latest.map(row => ({
    id: row.id, numero: row.numero, fecha: row.creado_en,
    cliente: names.get(row.cliente_id)?.nombre ?? 'Cliente no disponible',
    ubicacion: access.deliveries ? [names.get(row.cliente_id)?.ciudad, names.get(row.cliente_id)?.estado].filter(Boolean).join(', ') : undefined,
  }))
  if (isAdministration) {
    const codQuery = paramsFor('cuentas_por_cobrar', user.id, 'id,cliente_id,despacho_id,monto_usd,saldo_usd')
    codQuery.set('tipo', 'eq.cargo')
    codQuery.set('metodo_pago', 'eq.cod')
    codQuery.set('saldo_usd', 'gt.0')
    const dueQuery = paramsFor('cuentas_por_cobrar', user.id, 'id,cliente_id,despacho_id,monto_usd,saldo_usd,fecha_vencimiento')
    dueQuery.set('tipo', 'eq.cargo')
    dueQuery.set('metodo_pago', 'eq.cxc')
    dueQuery.set('saldo_usd', 'gt.0')
    dueQuery.set('fecha_vencimiento', `gte.${today.desde.slice(0, 10)}`)
    const dueUntil = new Date(today.hasta)
    dueUntil.setUTCDate(dueUntil.getUTCDate() + 6)
    dueQuery.append('fecha_vencimiento', `lt.${dueUntil.toISOString().slice(0, 10)}`)
    const [codRows, dueRows] = await Promise.all([
      readAllRows(env, headers, 'cuentas_por_cobrar', codQuery, { signal }),
      readAllRows(env, headers, 'cuentas_por_cobrar', dueQuery, { signal }),
    ])
    result.operaciones.codPendientes = {
      cantidad: codRows.length,
      totalUsd: money(codRows.reduce((sum, row) => sum + Number(row.saldo_usd || 0), 0)),
    }
    result.operaciones.deudasPorVencer = {
      cantidad: dueRows.length,
      totalUsd: money(dueRows.reduce((sum, row) => sum + Number(row.saldo_usd || 0), 0)),
    }
  } else if (access.receivables) {
    const query = paramsFor('clientes', user.id, 'id,saldo_pendiente')
    query.set('activo', 'eq.true')
    query.set('saldo_pendiente', 'gt.0')
    const rows = await readAllRows(env, headers, 'clientes', query, { signal })
    result.operaciones.cuentasPorCobrar = { totalUsd: money(rows.reduce((sum, row) => sum + Number(row.saldo_pendiente || 0), 0)), clientes: rows.length }
  }
  if (access.inventory) {
    const query = paramsFor('productos', user.id, 'id,stock_actual,stock_minimo')
    query.set('activo', 'eq.true')
    query.set('stock_minimo', 'gt.0')
    const rows = await readAllRows(env, headers, 'productos', query, { signal })
    result.operaciones.stockBajo = rows.filter(row => Number(row.stock_actual) <= Number(row.stock_minimo)).length
  }
  return result
}

export async function handleDashboard(request, env) {
  if (request.method !== 'GET') return noStore(jsonError('Método no permitido', 405, request))
  const validation = await validateOperator(request, env)
  if (validation.error) return noStore(validation.error)
  const { user, operador, headers } = validation
  const access = getDashboardAccess(operador.rol)
  if (access.scope === 'denegado' || !user.operator_session_id || operador.cuenta_id !== user.id) {
    return noStore(jsonError('No tienes acceso al inicio de este perfil', 403, request))
  }
  const url = new URL(request.url)
  // No aceptar parámetros de rol, tenant ni vendedor para ampliar el alcance.
  if ([...url.searchParams.keys()].some(key => key !== 'periodo')) {
    return noStore(jsonError('Filtro no permitido en el inicio', 400, request))
  }
  let period
  const now = new Date()
  try { period = getDashboardPeriod(url.searchParams.get('periodo') || 'mes', now) }
  catch { return noStore(jsonError('Período inválido', 400, request)) }
  try {
    const body = {
      schemaVersion: 1,
      identity: { accountId: user.id, operatorId: operador.id, rol: operador.rol, sessionId: user.operator_session_id },
      scope: access.scope, period, actualizadoEn: now.toISOString(),
    }
    if (access.sales) Object.assign(body, await readFinancialData(env, headers, user, operador, access, period, request.signal))
    if (access.operations || access.deliveries) Object.assign(body, await readOperations(env, headers, user, access, request.signal, now))
    return noStore(json(body, 200, request))
  } catch {
    // No devolver un total parcial ni detalles internos de PostgREST.
    return noStore(jsonError('No se pudo completar el resumen. No se mostrarán cifras parciales; vuelve a intentarlo.', 503, request))
  }
}
