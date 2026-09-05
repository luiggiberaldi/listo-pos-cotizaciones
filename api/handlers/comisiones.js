// api/handlers/comisiones.js
import { json, jsonError } from '../lib/utils.js'
import { validateOperator, verifyAuth } from '../lib/auth.js'
import {
  adjustLegacyCommissionForExcludedProducts,
  countUniqueDispatches,
  getCommissionablePaymentSplit,
  isDonationPayment,
  isLoanPayment,
} from '../../src/utils/comisionUtils.js'

const PRIVILEGED_ROLES = new Set(['supervisor', 'administracion', 'desarrollador', 'jefe'])
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000'

function getCommissionPolicy(despacho = {}) {
  const paymentSource = despacho?.forma_pago_cliente != null && despacho.forma_pago_cliente !== ''
    ? despacho.forma_pago_cliente
    : despacho?.forma_pago
  const split = getCommissionablePaymentSplit({
    totalUsd: despacho?.total_usd ?? despacho?.totalUsd ?? despacho?.totalusd,
    formaPagoCliente: paymentSource,
  })
  const excludedByPayment = isDonationPayment(paymentSource) || isLoanPayment(paymentSource)
  const products = Array.isArray(despacho?.productos) ? despacho.productos : []
  const excludedByProducts = products.length > 0 && products.every(product => {
    const name = String(product?.nombre_snap || product?.nombre || '').trim().toLowerCase()
    return product?.es_prestamo || product?.esPrestamo || name.startsWith('corte')
  })

  return {
    ...split,
    paymentFraction: split.fraction,
    fraction: excludedByPayment || excludedByProducts ? 0 : split.fraction,
    excludedByPayment,
    excludedByProducts,
  }
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function safeParam(value) {
  if (!value || value === 'null' || value === 'undefined' || value.trim() === '') return null
  return value.trim()
}

function serviceHeaders(env, includeContentType = false) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
  }
}

function addCommissionFilters(query, params, user, operador) {
  const vendedorId = safeParam(params.get('vendedorId'))
  const desde = safeParam(params.get('desde'))
  const hasta = safeParam(params.get('hasta'))
  const despachoId = safeParam(params.get('despachoId') || params.get('despachoid'))
  const isPrivileged = PRIVILEGED_ROLES.has(operador.rol)
  const selectedSeller = isPrivileged ? vendedorId : operador.id

  query += `&cuentaid=eq.${user.id}`
  if (selectedSeller) {
    query += selectedSeller === EMPTY_UUID
      ? '&vendedorid=is.null'
      : `&vendedorid=eq.${selectedSeller}`
  }
  if (desde) query += `&despacho.creado_en=gte.${desde}T00:00:00-04:00`
  if (hasta) query += `&despacho.creado_en=lte.${hasta}T23:59:59-04:00`
  if (despachoId) query += `&despachoid=eq.${despachoId}`
  return query
}

function baseCommissionQuery(env) {
  return `${env.SUPABASE_URL}/rest/v1/comisiones?select=id,despachoid,vendedorid,cotizacionid,cuentaid,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,estado,creadoen,actualizadoen,despacho:notas_despacho!inner(creado_en),split:calculo_evidencia->>split_cliente_ajeno,designado_ev:calculo_evidencia->>split_designado_id&order=creadoen.desc`
}

async function fetchByIds(env, headers, table, ids, select) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (!uniqueIds.length) return {}

  const CHUNK_SIZE = 50
  const chunks = []
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(i, i + CHUNK_SIZE))
  }

  const results = await Promise.all(
    chunks.map(async chunk => {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=in.(${chunk.join(',')})&select=${select}`, { headers })
      if (!response.ok) return []
      const rows = await response.json().catch(() => [])
      return Array.isArray(rows) ? rows : []
    })
  )

  const allRows = results.flat()
  return Object.fromEntries(allRows.map(row => [row.id, row]))
}

async function fetchCommissionConfig(env, headers, cuentaId) {
  if (!cuentaId) return {}
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${cuentaId}&select=*&limit=1`, { headers })
  if (!response.ok) return {}
  const rows = await response.json()
  return rows[0] || {}
}

async function enrichCommissions(env, headers, rows, cuentaId) {
  const despachos = await fetchByIds(
    env,
    headers,
    'notas_despacho',
    rows.map(row => row.despachoid),
    'id,numero,total_usd,creado_en,tasa_snapshot,forma_pago,forma_pago_cliente,cliente_id,cliente:clientes!notas_despacho_cliente_id_fkey(id,nombre,tipo_cliente),productos:notas_despacho_items(nombre_snap,codigo_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,origen,es_prestamo,producto_id,producto:productos(categoria))',
  )
  const cotizaciones = await fetchByIds(
    env,
    headers,
    'cotizaciones',
    rows.map(row => row.cotizacionid),
    'id,numero,tasa_bcv_snapshot,cliente_id,cliente:clientes(id,nombre)',
  )
  const vendedores = await fetchByIds(
    env,
    headers,
    'usuarios',
    rows.map(row => row.vendedorid),
    'id,nombre,color,markup_pct,rol,es_externo,codigo',
  )
  const config = await fetchCommissionConfig(env, headers, cuentaId)

  // v3: designaciones del día — mapa fecha → designado_id para derivar el tipo de fila
  const fechasDespachos = [...new Set(rows
    .filter(row => row.split === true || row.split === 'true')
    .map(row => (despachos[row.despachoid]?.creado_en || '').slice(0, 10))
    .filter(Boolean))]
  const designacionPorFecha = {}
  if (fechasDespachos.length) {
    try {
      const desigRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/comision_designacion_diaria?cuenta_id=eq.${cuentaId}&fecha=in.(${fechasDespachos.map(f => `"${f}"`).join(',')})&select=fecha,designado_id`,
        { headers },
      )
      if (desigRes.ok) {
        for (const d of await desigRes.json()) designacionPorFecha[d.fecha] = d.designado_id
      }
    } catch { /* si falla, las filas split caen a 'cliente_ajeno_dueno' */ }
  }

  return rows.map(row => {
    const despacho = despachos[row.despachoid]
    const cotizacion = cotizaciones[row.cotizacionid]
    // v3: tipo de fila — 'venta' normal, o split 'designado' (0.5% al designado del día)
    // / 'cliente_ajeno_dueno' (1.5% al dueño del cliente)
    const esSplit = row.split === true || row.split === 'true'
    let tipo = 'venta'
    if (esSplit) {
      const fechaDespacho = (despacho?.creado_en || '').slice(0, 10)
      const designadoDelDia = row.designado_ev || designacionPorFecha[fechaDespacho] || null
      tipo = (designadoDelDia && row.vendedorid === designadoDelDia) ? 'designado' : 'cliente_ajeno_dueno'
    }
    const policy = getCommissionPolicy(despacho)
    const storedAlreadyNet = String(row.estado || '').toLowerCase() === 'generada'
    const storedTotal = Number(row.totalcomision || 0)
    // 238 stores totalcomision already net of CxC. Older rows need the
    // defensive read-time fraction until they are reconciled separately.
    const effectiveFactor = storedAlreadyNet ? 1 : policy.fraction
    const effectiveTotal = round2(storedTotal * effectiveFactor)
    const storedCabilla = Number(row.comisioncabilla || 0)
    const storedOtros = Number(row.comisionotros || 0)
    const baseCabilla = round2(storedCabilla * effectiveFactor)
    const baseOtros = round2(storedOtros * effectiveFactor)
    const productAdjustment = storedAlreadyNet
      ? { cabilla: baseCabilla, otros: baseOtros, total: effectiveTotal, applied: false }
      : adjustLegacyCommissionForExcludedProducts({
        products: despacho?.productos || [],
        comisioncabilla: baseCabilla,
        comisionotros: baseOtros,
        perfil: vendedores[row.vendedorid],
        config,
      })
    const effectiveCabilla = round2(productAdjustment.cabilla)
    const effectiveOtros = round2(productAdjustment.otros)
    const effectiveTotalWithProducts = round2(effectiveCabilla + effectiveOtros)
    const cxcExcluded = storedAlreadyNet ? 0 : round2(storedTotal * (1 - policy.paymentFraction))
    const otherExcluded = storedAlreadyNet
      ? 0
      : round2(storedTotal - effectiveTotalWithProducts - cxcExcluded)
    return {
      id: row.id,
      despachoid: row.despachoid,
      vendedorid: row.vendedorid,
      tipo,
      cotizacionid: row.cotizacionid,
      cuentaid: row.cuentaid,
      totalcomision: effectiveTotalWithProducts,
      comisioncabilla: effectiveCabilla,
      comisionotros: effectiveOtros,
      totalcomision_bruta: storedAlreadyNet ? null : round2(storedTotal),
      comision_cxc_excluida: cxcExcluded,
      comision_otras_exclusiones: otherExcluded,
      fraccion_no_cxc: policy.paymentFraction,
      fraccion_comision_aplicada: effectiveFactor,
      fraccion_productos_aplicada: storedAlreadyNet || !productAdjustment.applied || storedTotal <= 0
        ? 1
        : round2(effectiveTotalWithProducts / Math.max(effectiveTotal, 0.0001)),
      productos_exclusion_aplicada: !storedAlreadyNet && productAdjustment.applied,
      comision_no_cxc_aplicada: true,
      fuente_calculo: storedAlreadyNet
        ? 'stored_net_238'
        : productAdjustment.applied
          ? 'legacy_read_prorated_products'
          : 'legacy_read_prorated',
      sourceLegacy: !storedAlreadyNet,
      excluida_por_pago: policy.excludedByPayment,
      excluida_por_productos: policy.excludedByProducts,
      politica_comision: 'fecha_despacho_no_cxc',
      pctcabilla: Number(row.pctcabilla || 0),
      pctotros: Number(row.pctotros || 0),
      estado: 'generada',
      creadoen: row.creadoen,
      actualizadoen: row.actualizadoen,
      vendedor: vendedores[row.vendedorid] || { id: row.vendedorid || null, nombre: 'Sin vendedor asignado', color: '#94a3b8' },
      despacho: despacho ? {
        id: despacho.id,
        numero: despacho.numero,
        totalusd: despacho.total_usd,
        creado_en: despacho.creado_en,
        tasa_snapshot: despacho.tasa_snapshot,
        fraccion_no_cxc: policy.paymentFraction,
        fraccion_comision_aplicada: effectiveFactor,
        fraccion_productos_aplicada: storedAlreadyNet || !productAdjustment.applied || storedTotal <= 0
          ? 1
          : round2(effectiveTotalWithProducts / Math.max(effectiveTotal, 0.0001)),
        productos_exclusion_aplicada: !storedAlreadyNet && productAdjustment.applied,
        totalcomision_bruta: storedAlreadyNet ? null : round2(storedTotal),
        comision_cxc_excluida: cxcExcluded,
        comision_otras_exclusiones: otherExcluded,
        comision_no_cxc_aplicada: true,
        fuente_calculo: storedAlreadyNet
          ? 'stored_net_238'
          : productAdjustment.applied
            ? 'legacy_read_prorated_products'
            : 'legacy_read_prorated',
        sourceLegacy: !storedAlreadyNet,
        excluida_por_pago: policy.excludedByPayment,
        excluida_por_productos: policy.excludedByProducts,
        politica_comision: 'fecha_despacho_no_cxc',
        forma_pago: despacho.forma_pago,
        forma_pago_cliente: despacho.forma_pago_cliente,
        cliente_nombre: despacho.cliente?.nombre || null,
        cliente_tipo_cliente: despacho.cliente?.tipo_cliente || null,
        productos: despacho.productos || [],
      } : null,
      cotizacion: cotizacion ? {
        id: cotizacion.id,
        numero: cotizacion.numero,
        tasa_bcv_snapshot: cotizacion.tasa_bcv_snapshot,
        cliente_nombre: cotizacion.cliente?.nombre || null,
      } : null,
    }
  })
}

function toEvent(row) {
  return {
    id: row.id,
    despachoid: row.despachoid,
    sourceLegacy: row.sourceLegacy === true,
    monto: row.totalcomision,
    tipo: 'generada',
    creado_en: row.creadoen,
    comisiones: {
      id: row.id,
      totalcomision: row.totalcomision,
      comisioncabilla: row.comisioncabilla,
      comisionotros: row.comisionotros,
      totalcomision_bruta: row.totalcomision_bruta,
      comision_cxc_excluida: row.comision_cxc_excluida,
      comision_otras_exclusiones: row.comision_otras_exclusiones,
      fraccion_no_cxc: row.fraccion_no_cxc,
      fraccion_comision_aplicada: row.fraccion_comision_aplicada,
      fraccion_productos_aplicada: row.fraccion_productos_aplicada,
      productos_exclusion_aplicada: row.productos_exclusion_aplicada === true,
      comision_no_cxc_aplicada: true,
      sourceLegacy: row.sourceLegacy === true,
      excluida_por_pago: row.excluida_por_pago,
      excluida_por_productos: row.excluida_por_productos,
      politica_comision: row.politica_comision,
      fuente_calculo: row.fuente_calculo,
      pctcabilla: row.pctcabilla,
      pctotros: row.pctotros,
      estado: 'generada',
      cotizacionid: row.cotizacionid,
      despacho: row.despacho,
      cotizacion: row.cotizacion,
    },
    vendedor: row.vendedor,
  }
}

export async function handleGetComisionesConfig(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request)
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&limit=1`, {
    headers: serviceHeaders(env),
  })
  if (!response.ok) return jsonError('Error al leer config comisiones', response.status, request)
  const rows = await response.json()
  return json(rows[0] || {}, 200, request)
}

export async function handleGetComisiones(request, env) {
  const validation = await validateOperator(request, env)
  if (validation.error) return validation.error
  const { user, operador } = validation
  const headers = serviceHeaders(env)
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.max(1, Math.min(1000, parseInt(url.searchParams.get('pageSize') || '100', 10)))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = addCommissionFilters(baseCommissionQuery(env), url.searchParams, user, operador)
  const response = await fetch(query, {
    headers: { ...headers, Range: `${from}-${to}`, Prefer: 'count=exact' },
  })
  if (!response.ok) {
    return jsonError(`Error al obtener comisiones: ${await response.text()}`, 500, request)
  }

  const rows = await response.json()
  const enriched = await enrichCommissions(env, headers, rows, user.id)
  const includeExcluded = url.searchParams.get('incluirExcluidas') === 'true'
  const visible = includeExcluded ? enriched : enriched.filter(row => row.totalcomision > 0)
  const total = visible.length
  const data = url.searchParams.get('vista') === 'eventos'
    ? visible.map(toEvent)
    : visible

  return json({
    data,
    total,
    totalDespachos: countUniqueDispatches(visible),
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }, 200, request)
}

export async function handleGetComisionesResumen(request, env) {
  const validation = await validateOperator(request, env)
  if (validation.error) return validation.error
  const { user, operador } = validation
  const url = new URL(request.url)
  const headers = serviceHeaders(env)

  let query = `${env.SUPABASE_URL}/rest/v1/comisiones?select=id,despachoid,vendedorid,cotizacionid,cuentaid,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,estado,creadoen,actualizadoen,despacho:notas_despacho!inner(creado_en)&order=creadoen.desc`
  query = addCommissionFilters(query, url.searchParams, user, operador)

  try {
    const response = await fetch(query, { headers })
    if (!response.ok) return jsonError(`Error al obtener resumen de comisiones: ${await response.text()}`, 500, request)
    const rows = await response.json()
    const enriched = await enrichCommissions(env, headers, rows, user.id)
    const visible = enriched.filter(row => row.totalcomision > 0)
    const totalAcumulado = visible.reduce((sum, row) => sum + Number(row.totalcomision || 0), 0)
    const totalDespachos = countUniqueDispatches(visible)
    return json({
      totalAcumulado: round2(totalAcumulado),
      total: totalDespachos,
      totalRegistros: totalDespachos,
      totalFilas: visible.length,
    }, 200, request)
  } catch (error) {
    return jsonError(`Error en agregación: ${error.message}`, 500, request)
  }
}
