// api/handlers/misVentas.js
// GET /api/reportes/mis-ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Detalle de lo que vendió el operador que inició sesión: el servidor decide de quién son los datos
// (clientes cuyo vendedor asignado es el operador de la sesión, sin importar quién hizo la venta); no se acepta ningún vendedor, rol ni cuenta desde el navegador.
import { validateOperator } from '../lib/auth.js'
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { ROLES_MIS_VENTAS, validarRangoMisVentas, construirReporteMisVentas } from '../../src/utils/misVentas.js'

const PAGINA = 1000
const LOTE_IDS = 50

async function leerTodo(env, headers, tabla, params, signal) {
  const filas = []
  for (let offset = 0; ; offset += PAGINA) {
    const q = new URLSearchParams(params)
    q.set('order', 'id.asc')
    q.set('limit', String(PAGINA))
    q.set('offset', String(offset))
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tabla}?${q}`, { headers, signal })
    if (!res.ok) throw new Error(`No se pudo consultar ${tabla} (HTTP ${res.status})`)
    const lote = await res.json()
    if (!Array.isArray(lote)) throw new Error(`Respuesta inválida de ${tabla}`)
    filas.push(...lote)
    if (lote.length < PAGINA) return filas
  }
}

async function leerPorIds(env, headers, tabla, campo, ids, params, signal) {
  const unicos = [...new Set(ids.filter(isValidUuid))]
  const filas = []
  for (let i = 0; i < unicos.length; i += LOTE_IDS) {
    filas.push(...await leerTodo(env, headers, tabla, new URLSearchParams([...new URLSearchParams(params), [campo, `in.(${unicos.slice(i, i + LOTE_IDS).join(',')})`]]), signal))
  }
  return filas
}

const sinCache = response => {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}

export async function handleMisVentas(request, env) {
  if (request.method !== 'GET') return jsonError('Método no permitido', 405, request)
  const validation = await validateOperator(request, env)
  if (validation.error) return validation.error
  const { user, operador, headers } = validation
  if (!ROLES_MIS_VENTAS.includes(operador.rol)) return jsonError('Este reporte es solo para vendedores', 403, request)

  const url = new URL(request.url)
  // Solo se aceptan las fechas: nada que permita pedir ventas de otro vendedor o de otra cuenta.
  if ([...url.searchParams.keys()].some(k => k !== 'desde' && k !== 'hasta')) return jsonError('Filtro no permitido', 400, request)
  const rango = validarRangoMisVentas(url.searchParams.get('desde'), url.searchParams.get('hasta'))
  if (rango.error) return jsonError(rango.error, 400, request)

  try {
    const cuenta = `eq.${user.id}`
    // Las ventas "de un vendedor" son las de SUS clientes: si otro usuario le vende a un cliente suyo, también cuenta.
    const misClientes = await leerTodo(env, headers, 'clientes',
      { select: 'id,nombre,rif_cedula', cuenta_id: cuenta, vendedor_id: `eq.${operador.id}` }, request.signal)
    const despachosParams = new URLSearchParams({
      select: 'id,numero,cotizacion_id,cliente_id,estado,creado_en,total_usd,flete_usd,descuento_total_usd,forma_pago,tiene_devoluciones',
      cuenta_id: cuenta,
      estado: 'in.(despachada,entregada)',
    })
    despachosParams.append('creado_en', `gte.${rango.desdeTs}`)
    despachosParams.append('creado_en', `lt.${rango.hastaTs}`)
    const despachos = await leerPorIds(env, headers, 'notas_despacho', 'cliente_id', misClientes.map(c => c.id), despachosParams, request.signal)

    const conComision = operador.rol !== 'vendedor_sin_comision'
    const ids = despachos.map(d => d.id)
    const clientes = misClientes
    const [items, cotizaciones, comisiones] = await Promise.all([
      leerPorIds(env, headers, 'notas_despacho_items', 'despacho_id', ids,
        { select: 'despacho_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden', cuenta_id: cuenta }, request.signal),
      leerPorIds(env, headers, 'cotizaciones', 'id', despachos.map(d => d.cotizacion_id),
        { select: 'id,numero', cuenta_id: cuenta }, request.signal),
      conComision
        ? leerPorIds(env, headers, 'comisiones', 'despachoid', ids,
          { select: 'despachoid,totalcomision', cuentaid: cuenta, vendedorid: `eq.${operador.id}` }, request.signal)
        : [],
    ])

    const reporte = construirReporteMisVentas({ despachos, items, clientes, cotizaciones, comisiones, conComision })
    return sinCache(json({
      vendedor: { nombre: operador.nombre, rol: operador.rol },
      periodo: { desde: rango.desde, hasta: rango.hasta },
      generadoEn: new Date().toISOString(),
      ...reporte,
    }, 200, request))
  } catch (e) {
    console.error('[MIS_VENTAS] falló:', e?.message)
    return jsonError('No se pudo generar el reporte', 500, request)
  }
}
