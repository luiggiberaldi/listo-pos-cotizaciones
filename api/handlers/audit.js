// api/handlers/audit.js
import { json, jsonError, corsHeaders, isValidUuid } from '../lib/utils.js'
import { verifyAuth, getOperatorRole } from '../lib/auth.js'
import { groqFetch } from '../lib/groq.js'

// GET /api/admin/audit — listar auditoría paginada (solo desarrollador)
export async function handleGetAudit(request, env, url) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const rol = await getOperatorRole(user.operator_id, env)
  if (!rol || !['desarrollador', 'supervisor', 'jefe'].includes(rol)) return jsonError('Solo desarrolladores o jefe', 403, request)

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '50')))
  const offset = (page - 1) * limit

  let filter = ''
  const categoria = url.searchParams.get('categoria')
  if (categoria) filter += `&categoria=eq.${encodeURIComponent(categoria)}`
  const usuario = url.searchParams.get('usuario_id')
  if (usuario && isValidUuid(usuario)) filter += `&usuario_id=eq.${usuario}`
  const accion = url.searchParams.get('accion')
  if (accion) filter += `&accion=eq.${encodeURIComponent(accion)}`
  const desde = url.searchParams.get('desde')
  if (desde) filter += `&ts=gte.${encodeURIComponent(desde)}`
  const hasta = url.searchParams.get('hasta')
  if (hasta) filter += `&ts=lte.${encodeURIComponent(hasta)}`

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    Prefer: 'count=exact',
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/auditoria?select=*&order=ts.desc&offset=${offset}&limit=${limit}${filter}`,
    { headers: h }
  )
  if (!res.ok) return jsonError('Error leyendo auditoría', 500, request)

  const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0')
  const registros = await res.json()

  return json({ registros, total, page, limit, pages: Math.ceil(total / limit) }, 200, request)
}

// GET /api/admin/audit/stats — estadísticas de auditoría
export async function handleGetAuditStats(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const rol = await getOperatorRole(user.operator_id, env)
  if (!rol || !['desarrollador', 'supervisor', 'jefe'].includes(rol)) return jsonError('Solo desarrolladores o jefe', 403, request)

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  }

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

  const total = parseInt(totalRes.headers.get('content-range')?.split('/')[1] || '0')
  const accionesHoy = parseInt(hoyRes.headers.get('content-range')?.split('/')[1] || '0')
  const accionesSemana = parseInt(semanaRes.headers.get('content-range')?.split('/')[1] || '0')
  const loginsFallidos = parseInt(loginFailRes.headers.get('content-range')?.split('/')[1] || '0')

  const recent = recentRes.ok ? await recentRes.json() : []

  // Top categorías
  const catCount = {}
  for (const r of recent) catCount[r.categoria || 'OTRO'] = (catCount[r.categoria || 'OTRO'] || 0) + 1
  const topCategorias = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cat, count]) => ({ categoria: cat, count }))

  // Top usuarios
  const userCount = {}
  for (const r of recent) {
    const key = r.usuario_nombre || 'Desconocido'
    if (!userCount[key]) userCount[key] = { nombre: key, rol: r.usuario_rol, count: 0 }
    userCount[key].count++
  }
  const topUsuarios = Object.values(userCount).sort((a, b) => b.count - a.count).slice(0, 8)

  // Top acciones
  const accionCount = {}
  for (const r of recent) accionCount[r.accion || 'OTRO'] = (accionCount[r.accion || 'OTRO'] || 0) + 1
  const topAcciones = Object.entries(accionCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([accion, count]) => ({ accion, count }))

  return json({ total, accionesHoy, accionesSemana, loginsFallidos, topCategorias, topUsuarios, topAcciones }, 200, request)
}

// POST /api/admin/audit/analyze — análisis AI de auditoría con Groq
export async function handleAnalyzeAudit(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const rol = await getOperatorRole(user.operator_id, env)
  if (!rol || !['desarrollador', 'supervisor', 'jefe'].includes(rol)) return jsonError('Solo desarrolladores o jefe', 403, request)

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  }

  // Obtener últimos 200 registros de auditoría
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/auditoria?select=ts,categoria,accion,descripcion,usuario_nombre,usuario_rol,entidad_tipo,meta&order=ts.desc&limit=200`,
    { headers: h }
  )
  if (!res.ok) return jsonError('Error leyendo auditoría', 500, request)
  const registros = await res.json()

  if (!registros.length) {
    return json({ resultado: 'No hay registros de auditoría suficientes para análisis.', registros_count: 0 }, 200, request)
  }

  const resumen = registros.map(r =>
    `[${r.ts}] ${r.categoria}/${r.accion} | ${r.usuario_nombre} (${r.usuario_rol}) | ${r.descripcion || '-'}${r.meta ? ` | meta: ${JSON.stringify(r.meta)}` : ''}`
  ).join('\n')

  const systemPrompt = `Eres un auditor de sistemas POS especializado en análisis de seguridad y operaciones. Analiza el registro de auditoría y genera un informe completo:

## RESUMEN EJECUTIVO
- Resumen de actividad general del período
- Métricas clave (acciones por día, usuarios más activos)

## PATRONES DE USO
- Horarios de mayor actividad
- Flujos de trabajo más comunes
- Distribución de acciones por rol

## ALERTAS DE SEGURIDAD
- Intentos de login fallidos (frecuencia, patrones)
- Accesos fuera de horario habitual
- Acciones inusuales o sospechosas
- Cambios de configuración o permisos

## RECOMENDACIONES DE MEJORA
- Sugerencias para optimizar el flujo de trabajo
- Mejoras de seguridad recomendadas
- Funcionalidades que podrían simplificarse
- Posibles automatizaciones

Responde en español, de forma clara y accionable. Usa formato markdown con headers ##.`

  try {
    const resultado = await groqFetch(env, 'A', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Aquí están los ${registros.length} registros de auditoría más recientes del sistema POS "Listo Cotizaciones" (Construacero Carabobo):\n\n${resumen}` },
    ], { maxTokens: 4000 })

    return json({ resultado, registros_count: registros.length, modelo: 'llama-3.3-70b-versatile' }, 200, request)
  } catch (e) {
    return jsonError(`Error en análisis AI: ${e.message}`, 500, request)
  }
}
