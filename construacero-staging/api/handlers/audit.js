// api/handlers/audit.js
// Auditoría 2.0 (OP-2026-109 / OP-2026-110):
//  - GET /api/admin/audit               → Bitácora del negocio (Capa 3), filtrada por rol
//  - GET /api/admin/audit/stats         → Resumen rápido (1 consulta SQL via obtener_resumen_auditoria)
//  - GET /api/admin/audit/cambios       → Cambios antes/después (Capa 1), sin dinero/precios para supervisor
//  - GET /api/admin/audit/historia      → Línea de tiempo unificada por registro (Capa 1 + Capa 3)
//  - GET /api/admin/audit/peticiones    → Portero: accesos denegados y errores (solo jefe/admin/dev)
//  - GET /api/admin/audit/verificar-cadena → Verificación SHA-256 de la cadena anti-alteración
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { verifyAuth, getOperatorRole } from '../lib/auth.js'

const ROLES_LECTURA = ['desarrollador', 'supervisor', 'jefe', 'administracion']
const ROLES_FINANZAS = ['desarrollador', 'jefe', 'administracion']

// Categorías y acciones con precios/dinero ocultas para el supervisor (decisión del dueño, 24-nov-2026)
const CATEGORIAS_OCULTAS_SUPERVISOR = new Set(['FINANZAS', 'COMISIONES', 'PROVEEDOR', 'CONFIG'])
const ACCIONES_OCULTAS_SUPERVISOR = new Set([
  'EDITAR_PAGO_DESPACHO', 'APLICAR_DESCUENTO', 'DEVOLUCION_PARCIAL',
  'EDICION_PROFUNDA_CXC', 'ANULAR_ABONO_POR_DEVOLUCION', 'REGISTRAR_ABONO',
  'ABONO_RECHAZADO', 'REVERTIR_ABONO', 'REVERTIR_CARGO_CXC', 'RECALCULO_SALDO_FALLIDO',
  'COD_CONCILIADO_CON_EVIDENCIA', 'FACTURAR_PRESTAMO', 'DESIGNAR_VENDEDOR_DIA',
  'QUITAR_DESIGNACION_DIA', 'GUARDAR_CONFIG', 'BATCH_PRICE_UPDATE', 'BATCH_PRICE_RESTORE',
  'PAGAR_TRANSPORTISTA', 'REVERTIR_PAGO_TRANSPORTISTA', 'ACTUALIZAR_TRANSACCION_CXP',
  'RESPALDO_RESTAURADO',
])
const CLAVES_DINERO_RE = /(precio|costo|monto|total|saldo|flete|comision|tasa|descuento|abono|credito|tarifa|markup)/i

function limpiarMetaParaSupervisor(meta) {
  if (!meta || typeof meta !== 'object') return meta
  if (Array.isArray(meta)) return meta.map(limpiarMetaParaSupervisor)
  const limpio = {}
  for (const [k, v] of Object.entries(meta)) {
    if (CLAVES_DINERO_RE.test(k)) continue
    limpio[k] = typeof v === 'object' && v !== null ? limpiarMetaParaSupervisor(v) : v
  }
  return limpio
}

function esRegistroOcultoSupervisor(r) {
  const cat = String(r?.categoria || '').toUpperCase()
  const acc = String(r?.accion || '').toUpperCase()
  return CATEGORIAS_OCULTAS_SUPERVISOR.has(cat) || ACCIONES_OCULTAS_SUPERVISOR.has(acc)
}

function svcHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function autenticarAudit(request, env, { soloFinanzas = false } = {}) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return { error: jsonError('No autenticado', 401, request) }
  const rol = await getOperatorRole(user.operator_id, env)
  const permitidos = soloFinanzas ? ROLES_FINANZAS : ROLES_LECTURA
  if (!rol || !permitidos.includes(rol)) {
    return { error: jsonError('No tienes permiso para ver esta sección de auditoría', 403, request) }
  }
  return { user, rol, esSupervisor: rol === 'supervisor', cuentaId: user.id || null }
}

// GET /api/admin/audit — listar auditoría paginada (filtrada por rol)
export async function handleGetAudit(request, env, url) {
  const auth = await autenticarAudit(request, env)
  if (auth.error) return auth.error

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const offset = (page - 1) * limit

  let filter = ''
  if (auth.cuentaId && isValidUuid(auth.cuentaId)) filter += `&cuenta_id=eq.${auth.cuentaId}`
  const categoria = url.searchParams.get('categoria')
  if (categoria) {
    const catUp = categoria.toUpperCase()
    if (auth.esSupervisor && CATEGORIAS_OCULTAS_SUPERVISOR.has(catUp)) {
      return json({ registros: [], total: 0, page, limit, pages: 0 }, 200, request)
    }
    filter += `&categoria=eq.${encodeURIComponent(catUp)}`
  }
  if (auth.esSupervisor) {
    filter += `&categoria=not.in.(${[...CATEGORIAS_OCULTAS_SUPERVISOR].join(',')})`
    filter += `&accion=not.in.(${[...ACCIONES_OCULTAS_SUPERVISOR].join(',')})`
  }
  const usuario = url.searchParams.get('usuario_id')
  if (usuario && isValidUuid(usuario)) filter += `&usuario_id=eq.${usuario}`
  const accion = url.searchParams.get('accion')
  if (accion) filter += `&accion=eq.${encodeURIComponent(accion)}`
  const desde = url.searchParams.get('desde')
  if (desde) filter += `&ts=gte.${encodeURIComponent(desde)}`
  const hasta = url.searchParams.get('hasta')
  if (hasta) filter += `&ts=lte.${encodeURIComponent(hasta)}`

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/auditoria?select=*&order=ts.desc&offset=${offset}&limit=${limit}${filter}`,
    { headers: svcHeaders(env, { Prefer: 'count=exact' }) }
  )
  if (!res.ok) return jsonError('Error leyendo auditoría', 500, request)

  const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10) || 0
  let registros = await res.json()
  if (auth.esSupervisor && Array.isArray(registros)) {
    registros = registros
      .filter((r) => !esRegistroOcultoSupervisor(r))
      .map((r) => ({ ...r, meta: limpiarMetaParaSupervisor(r.meta) }))
  }

  return json({ registros, total, page, limit, pages: Math.ceil(total / limit) }, 200, request)
}

// GET /api/admin/audit/stats — resumen rápido en 1 sola consulta (con fallback seguro)
export async function handleGetAuditStats(request, env) {
  const auth = await autenticarAudit(request, env)
  if (auth.error) return auth.error

  try {
    const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/obtener_resumen_auditoria`, {
      method: 'POST',
      headers: svcHeaders(env),
      body: JSON.stringify({
        p_cuenta_id: auth.cuentaId,
        p_ocultar_dinero: auth.esSupervisor,
      }),
    })
    if (rpcRes.ok) {
      const data = await rpcRes.json()
      if (data && typeof data === 'object' && 'total' in data) {
        return json(data, 200, request)
      }
    }
  } catch { /* fallback abajo si la RPC aún no existe */ }

  // Fallback compatible previo a migración 322/332
  const h = svcHeaders(env)
  const hoy = new Date().toISOString().split('T')[0]
  const hace7d = new Date(Date.now() - 7 * 86400000).toISOString()
  const hace30d = new Date(Date.now() - 30 * 86400000).toISOString()
  const [totalRes, hoyRes, semanaRes, loginFailRes, recentRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/auditoria?select=id&limit=1`, { headers: { ...h, Prefer: 'count=exact' } }),
    fetch(`${env.SUPABASE_URL}/rest/v1/auditoria?select=id&ts=gte.${hoy}T00:00:00&limit=1`, { headers: { ...h, Prefer: 'count=exact' } }),
    fetch(`${env.SUPABASE_URL}/rest/v1/auditoria?select=id&ts=gte.${hace7d}&limit=1`, { headers: { ...h, Prefer: 'count=exact' } }),
    fetch(`${env.SUPABASE_URL}/rest/v1/auditoria?select=id&accion=eq.LOGIN_FALLIDO&ts=gte.${hace7d}&limit=1`, { headers: { ...h, Prefer: 'count=exact' } }),
    fetch(`${env.SUPABASE_URL}/rest/v1/auditoria?select=categoria,accion,usuario_nombre,usuario_rol&ts=gte.${hace30d}&order=ts.desc&limit=500`, { headers: h }),
  ])

  const total = parseInt(totalRes.headers.get('content-range')?.split('/')[1] || '0', 10) || 0
  const accionesHoy = parseInt(hoyRes.headers.get('content-range')?.split('/')[1] || '0', 10) || 0
  const accionesSemana = parseInt(semanaRes.headers.get('content-range')?.split('/')[1] || '0', 10) || 0
  const loginsFallidos = parseInt(loginFailRes.headers.get('content-range')?.split('/')[1] || '0', 10) || 0
  let recent = recentRes.ok ? await recentRes.json() : []
  if (auth.esSupervisor) recent = recent.filter((r) => !esRegistroOcultoSupervisor(r))

  const catCount = {}, userCount = {}, accionCount = {}
  for (const r of recent) {
    catCount[r.categoria || 'OTRO'] = (catCount[r.categoria || 'OTRO'] || 0) + 1
    const key = r.usuario_nombre || 'Desconocido'
    if (!userCount[key]) userCount[key] = { nombre: key, rol: r.usuario_rol, count: 0 }
    userCount[key].count++
    accionCount[r.accion || 'OTRO'] = (accionCount[r.accion || 'OTRO'] || 0) + 1
  }
  return json({
    total, accionesHoy, accionesSemana, loginsFallidos,
    cambiosFueraApp7d: 0, peticionesAlerta7d: 0, alertasRecientes: [],
    topCategorias: Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([categoria, count]) => ({ categoria, count })),
    topUsuarios: Object.values(userCount).sort((a, b) => b.count - a.count).slice(0, 8),
    topAcciones: Object.entries(accionCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([accion, count]) => ({ accion, count })),
  }, 200, request)
}

// GET /api/admin/audit/cambios — Capa 1: antes/después (sin precios/dinero para supervisor)
export async function handleGetAuditCambios(request, env, url) {
  const auth = await autenticarAudit(request, env)
  if (auth.error) return auth.error

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const offset = (page - 1) * limit

  let filter = ''
  if (auth.cuentaId && isValidUuid(auth.cuentaId)) filter += `&or=(cuenta_id.eq.${auth.cuentaId},cuenta_id.is.null)`
  if (auth.esSupervisor) filter += '&es_sensible_dinero=eq.false'
  const tabla = url.searchParams.get('tabla')
  if (tabla) filter += `&tabla=eq.${encodeURIComponent(tabla)}`
  const registroId = url.searchParams.get('registro_id')
  if (registroId) filter += `&registro_id=eq.${encodeURIComponent(registroId)}`
  const origen = url.searchParams.get('origen')
  if (origen && ['app', 'cron', 'sistema', 'manual'].includes(origen)) filter += `&origen=eq.${origen}`
  const operacionId = url.searchParams.get('operacion_id')
  if (operacionId) filter += `&operacion_id=eq.${encodeURIComponent(operacionId)}`
  const desde = url.searchParams.get('desde')
  if (desde) filter += `&ts=gte.${encodeURIComponent(desde)}`

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/auditoria_cambios?select=id,ts,tabla,registro_id,tipo,cambios,operador_id,operador_nombre,operador_rol,origen,operacion_id,es_sensible_dinero&order=ts.desc&offset=${offset}&limit=${limit}${filter}`,
    { headers: svcHeaders(env, { Prefer: 'count=exact' }) }
  )
  if (!res.ok) return jsonError('Error leyendo cambios de auditoría', 500, request)

  const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10) || 0
  const cambios = await res.json()
  return json({ cambios, total, page, limit, pages: Math.ceil(total / limit) }, 200, request)
}

// GET /api/admin/audit/historia?tabla=...&id=... — Línea de tiempo unificada por registro
export async function handleGetAuditHistoria(request, env, url) {
  const auth = await autenticarAudit(request, env)
  if (auth.error) return auth.error

  const tabla = url.searchParams.get('tabla') || ''
  const id = url.searchParams.get('id') || ''
  if (!id) return jsonError('Falta el identificador del registro (id)', 400, request)

  const h = svcHeaders(env)
  const filtroCambios = `registro_id=eq.${encodeURIComponent(id)}`
    + (tabla ? `&tabla=eq.${encodeURIComponent(tabla)}` : '')
    + (auth.esSupervisor ? '&es_sensible_dinero=eq.false' : '')
  const filtroBitacora = `entidad_id=eq.${encodeURIComponent(id)}`
    + (auth.esSupervisor ? `&categoria=not.in.(${[...CATEGORIAS_OCULTAS_SUPERVISOR].join(',')})` : '')

  const [cambiosRes, bitacoraRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/auditoria_cambios?select=id,ts,tabla,registro_id,tipo,cambios,operador_nombre,operador_rol,origen,operacion_id,es_sensible_dinero&${filtroCambios}&order=ts.desc&limit=100`, { headers: h }),
    fetch(`${env.SUPABASE_URL}/rest/v1/auditoria?select=id,ts,categoria,accion,descripcion,usuario_nombre,usuario_rol,meta&${filtroBitacora}&order=ts.desc&limit=100`, { headers: h }),
  ])

  const cambios = cambiosRes.ok ? await cambiosRes.json() : []
  let bitacora = bitacoraRes.ok ? await bitacoraRes.json() : []
  if (auth.esSupervisor) {
    bitacora = bitacora
      .filter((r) => !esRegistroOcultoSupervisor(r))
      .map((r) => ({ ...r, meta: limpiarMetaParaSupervisor(r.meta) }))
  }

  const lineaTiempo = [
    ...cambios.map((c) => ({ fuente: 'cambio', ts: c.ts, ...c })),
    ...bitacora.map((b) => ({ fuente: 'bitacora', ts: b.ts, ...b })),
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts))

  return json({ tabla, id, total: lineaTiempo.length, lineaTiempo }, 200, request)
}

// GET /api/admin/audit/peticiones — Capa 2: Portero (solo jefe, administración, desarrollador)
export async function handleGetAuditPeticiones(request, env, url) {
  const auth = await autenticarAudit(request, env, { soloFinanzas: true })
  if (auth.error) return auth.error

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const offset = (page - 1) * limit

  let filter = ''
  if (auth.cuentaId && isValidUuid(auth.cuentaId)) filter += `&or=(cuenta_id.eq.${auth.cuentaId},cuenta_id.is.null)`
  const resultado = url.searchParams.get('resultado')
  if (resultado && ['ok', 'denegado', 'error'].includes(resultado)) filter += `&resultado=eq.${resultado}`

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/auditoria_peticiones?select=*&order=ts.desc&offset=${offset}&limit=${limit}${filter}`,
    { headers: svcHeaders(env, { Prefer: 'count=exact' }) }
  )
  if (!res.ok) return jsonError('Error leyendo peticiones de auditoría', 500, request)

  const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10) || 0
  const peticiones = await res.json()
  return json({ peticiones, total, page, limit, pages: Math.ceil(total / limit) }, 200, request)
}

// GET /api/admin/audit/verificar-cadena — Fase 5: verifica sellos SHA-256
export async function handleVerificarCadenaAuditoria(request, env) {
  const auth = await autenticarAudit(request, env, { soloFinanzas: true })
  if (auth.error) return auth.error

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/verificar_cadena_auditoria`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify({ p_limite: 1000 }),
  })
  if (!res.ok) return jsonError('Error verificando cadena de sellos', 500, request)
  const resultado = await res.json()
  return json(resultado, 200, request)
}

// POST /api/admin/audit/analyze — análisis AI de auditoría deshabilitado
export async function handleAnalyzeAudit(request, env) {
  return jsonError('El análisis AI de auditoría ha sido deshabilitado permanentemente.', 403, request)
}
