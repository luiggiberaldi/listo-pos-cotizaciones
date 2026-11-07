// api/handlers/ventasDia.js
// GET /api/reportes/ventas-dia?fecha=YYYY-MM-DD
// Hoja "Ventas del día" que Logística le deja a Administración (los sábados). Solo Logística
// (y desarrollador, para soporte). La cuenta sale de la sesión; solo se acepta la fecha.
import { validateOperator } from '../lib/auth.js'
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { ROLES_VENTAS_DIA, validarFechaVentasDia, construirVentasDia, numerosFaltantes } from '../../src/utils/ventasDia.js'

const PAGINA = 1000
const LOTE = 50

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

async function leerEnTandas(env, headers, tabla, campo, valores, params, signal) {
  const unicos = [...new Set(valores)]
  const tandas = []
  for (let i = 0; i < unicos.length; i += LOTE) tandas.push(unicos.slice(i, i + LOTE))
  const lotes = await Promise.all(tandas.map(v =>
    leerTodo(env, headers, tabla, new URLSearchParams([...new URLSearchParams(params), [campo, `in.(${v.join(',')})`]]), signal)))
  return lotes.flat()
}

export async function handleVentasDia(request, env) {
  if (request.method !== 'GET') return jsonError('Método no permitido', 405, request)
  const validation = await validateOperator(request, env)
  if (validation.error) return validation.error
  const { user, operador, headers } = validation
  if (!ROLES_VENTAS_DIA.includes(operador.rol)) return jsonError('Este reporte es solo para Logística', 403, request)

  const url = new URL(request.url)
  if ([...url.searchParams.keys()].some(k => k !== 'fecha')) return jsonError('Filtro no permitido', 400, request)
  const rango = validarFechaVentasDia(url.searchParams.get('fecha'))
  if (rango.error) return jsonError(rango.error, 400, request)

  try {
    const cuenta = `eq.${user.id}`
    const params = new URLSearchParams({
      select: 'id,numero,cliente_id,estado,creado_en,total_usd,forma_pago,referencia_pago',
      cuenta_id: cuenta,
    })
    params.append('creado_en', `gte.${rango.desdeTs}`)
    params.append('creado_en', `lt.${rango.hastaTs}`)
    const despachos = await leerTodo(env, headers, 'notas_despacho', params, request.signal)

    const idsClientes = despachos.map(d => d.cliente_id).filter(isValidUuid)
    const faltan = numerosFaltantes(despachos).filter(Number.isInteger)
    const [clientes, otrosNumeros] = await Promise.all([
      leerEnTandas(env, headers, 'clientes', 'id', idsClientes, { select: 'id,nombre', cuenta_id: cuenta }, request.signal),
      leerEnTandas(env, headers, 'notas_despacho', 'numero', faltan, { select: 'id,numero,estado,creado_en', cuenta_id: cuenta }, request.signal),
    ])

    const reporte = construirVentasDia({ fecha: rango.fecha, despachos, clientes, otrosNumeros })
    const res = json({ ...reporte, preparadoPor: operador.nombre || '', generadoEn: new Date().toISOString() }, 200, request)
    res.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return res
  } catch (e) {
    if (e?.name === 'AbortError') return jsonError('Consulta cancelada', 499, request)
    console.error('[VENTAS_DIA]', e)
    return jsonError('No se pudo armar el reporte', 500, request)
  }
}
