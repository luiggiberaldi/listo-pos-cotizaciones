// api/handlers/logs.js
import { json, jsonError, corsHeaders } from '../lib/utils.js'
import { verifyAuth, verifySupervisor } from '../lib/auth.js'
import { groqFetch } from '../lib/groq.js'
import { logToSystem } from '../lib/audit.js'

// POST /api/logs — recibir log del frontend (cualquier usuario autenticado)
export async function handleLogFromClient(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)

  let body
  try { body = await request.json() } catch { return jsonError('JSON inválido', 400, request) }

  const { nivel = 'error', origen = 'frontend', categoria, mensaje, stack, meta } = body
  if (!mensaje) return jsonError('mensaje requerido', 400, request)

  await logToSystem(env, {
    nivel: ['error', 'warn', 'info'].includes(nivel) ? nivel : 'error',
    origen: ['frontend', 'worker', 'supabase'].includes(origen) ? origen : 'frontend',
    categoria: categoria || 'GENERAL',
    mensaje: String(mensaje).slice(0, 2000),
    stack: stack ? String(stack).slice(0, 5000) : null,
    endpoint: request.headers.get('Referer') || null,
    usuario_id: user.operator_id || user.id,
    usuario_nombre: user.app_metadata?.operator_nombre || user.email,
    meta: meta || {},
  })

  return json({ ok: true }, 200, request)
}

// GET /api/admin/logs — listar logs paginados (supervisor)
export async function handleGetLogs(request, env, url) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const isSup = await verifySupervisor(user.operator_id, env)
  if (!isSup) return jsonError('Solo supervisores', 403, request)

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '50')))
  const offset = (page - 1) * limit

  let filter = ''
  const nivel = url.searchParams.get('nivel')
  if (nivel && ['error', 'warn', 'info'].includes(nivel)) filter += `&nivel=eq.${nivel}`
  const origen = url.searchParams.get('origen')
  if (origen && ['frontend', 'worker', 'supabase'].includes(origen)) filter += `&origen=eq.${origen}`
  const categoria = url.searchParams.get('categoria')
  if (categoria) filter += `&categoria=eq.${encodeURIComponent(categoria)}`
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
    `${env.SUPABASE_URL}/rest/v1/system_logs?select=*&order=ts.desc&offset=${offset}&limit=${limit}${filter}`,
    { headers: h }
  )
  if (!res.ok) return jsonError('Error leyendo logs', 500, request)

  const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0')
  const logs = await res.json()

  return json({ logs, total, page, limit, pages: Math.ceil(total / limit) }, 200, request)
}

// GET /api/admin/logs/stats — estadísticas de logs
export async function handleGetLogStats(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const isSup = await verifySupervisor(user.operator_id, env)
  if (!isSup) return jsonError('Solo supervisores', 403, request)

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  }

  // Obtener conteo por nivel y origen en paralelo
  const hoy = new Date().toISOString().split('T')[0]
  const [totalRes, erroresHoyRes, warnHoyRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/system_logs?select=id&limit=1`, { headers: { ...h, Prefer: 'count=exact' } }),
    fetch(`${env.SUPABASE_URL}/rest/v1/system_logs?select=id&nivel=eq.error&ts=gte.${hoy}T00:00:00&limit=1`, { headers: { ...h, Prefer: 'count=exact' } }),
    fetch(`${env.SUPABASE_URL}/rest/v1/system_logs?select=id&nivel=eq.warn&ts=gte.${hoy}T00:00:00&limit=1`, { headers: { ...h, Prefer: 'count=exact' } }),
  ])

  const total = parseInt(totalRes.headers.get('content-range')?.split('/')[1] || '0')
  const erroresHoy = parseInt(erroresHoyRes.headers.get('content-range')?.split('/')[1] || '0')
  const warningsHoy = parseInt(warnHoyRes.headers.get('content-range')?.split('/')[1] || '0')

  // Top 5 categorías con más errores (últimos 7 días)
  const hace7d = new Date(Date.now() - 7 * 86400000).toISOString()
  const topRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/system_logs?select=categoria&nivel=eq.error&ts=gte.${hace7d}&limit=500`,
    { headers: h }
  )
  const topLogs = topRes.ok ? await topRes.json() : []
  const catCount = {}
  for (const l of topLogs) catCount[l.categoria || 'SIN_CATEGORIA'] = (catCount[l.categoria || 'SIN_CATEGORIA'] || 0) + 1
  const topCategorias = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, count]) => ({ categoria: cat, count }))

  return json({ total, erroresHoy, warningsHoy, topCategorias }, 200, request)
}

// GET /api/admin/logs/download — descargar logs como JSON
export async function handleDownloadLogs(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const isSup = await verifySupervisor(user.operator_id, env)
  if (!isSup) return jsonError('Solo supervisores', 403, request)

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/system_logs?select=*&order=ts.desc&limit=10000`,
    { headers: h }
  )
  if (!res.ok) return jsonError('Error descargando logs', 500, request)
  const logs = await res.json()

  const fecha = new Date().toISOString().split('T')[0]
  const filename = `system-logs-${fecha}.json`

  return new Response(JSON.stringify({ generado_en: new Date().toISOString(), total: logs.length, logs }, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...corsHeaders(request),
    },
  })
}

// POST /api/admin/logs/analyze — análisis AI con Groq
export async function handleAnalyzeLogs(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const isSup = await verifySupervisor(user.operator_id, env)
  if (!isSup) return jsonError('Solo supervisores', 403, request)

  let body
  try { body = await request.json() } catch { return jsonError('JSON inválido', 400, request) }

  const tipo = body.tipo || 'errores'
  if (!['errores', 'mejoras', 'seguridad'].includes(tipo)) {
    return jsonError('tipo debe ser: errores, mejoras, seguridad', 400, request)
  }

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  }

  // Obtener logs según tipo de análisis
  let logsFilter = ''
  let grupo = 'A'
  let systemPrompt = ''

  if (tipo === 'errores') {
    logsFilter = '&nivel=eq.error'
    grupo = 'A'
    systemPrompt = `Eres un experto en diagnóstico de sistemas POS (Punto de Venta). Analiza los errores del sistema y:
1. Agrupa por causa raíz
2. Identifica patrones recurrentes
3. Prioriza por impacto al negocio (alto/medio/bajo)
4. Sugiere soluciones concretas para cada grupo
Responde en español, de forma clara y accionable. Usa formato markdown.`
  } else if (tipo === 'mejoras') {
    logsFilter = '&nivel=in.(warn,info)'
    grupo = 'B'
    systemPrompt = `Eres un consultor de optimización de sistemas POS. Analiza los logs de uso y advertencias para:
1. Identificar cuellos de botella y operaciones lentas
2. Detectar funciones poco usadas o con problemas frecuentes
3. Sugerir mejoras de UX y rendimiento
4. Recomendar optimizaciones de base de datos
Responde en español con recomendaciones priorizadas. Usa formato markdown.`
  } else {
    logsFilter = '&or=(categoria.eq.AUTH,categoria.eq.SISTEMA,nivel.eq.error)'
    grupo = 'C'
    systemPrompt = `Eres un auditor de seguridad especializado en sistemas POS. Analiza los logs para:
1. Detectar intentos de acceso no autorizado
2. Identificar patrones sospechosos (muchos errores de auth, IPs inusuales)
3. Evaluar vulnerabilidades potenciales
4. Recomendar medidas de seguridad
Responde en español con nivel de riesgo (crítico/alto/medio/bajo). Usa formato markdown.`
  }

  const logsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/system_logs?select=ts,nivel,origen,categoria,mensaje,endpoint,usuario_nombre,meta&order=ts.desc&limit=150${logsFilter}`,
    { headers: h }
  )
  if (!logsRes.ok) return jsonError('Error leyendo logs para análisis', 500, request)
  const logs = await logsRes.json()

  if (!logs.length) {
    return json({ tipo, resultado: 'No hay logs suficientes para análisis. El sistema necesita más datos de uso.', logs_count: 0 }, 200, request)
  }

  // Resumir logs para no exceder el contexto del LLM
  const resumen = logs.map(l => `[${l.ts}] ${l.nivel} | ${l.origen} | ${l.categoria || '-'} | ${l.mensaje}${l.endpoint ? ` (${l.endpoint})` : ''}${l.usuario_nombre ? ` — ${l.usuario_nombre}` : ''}`).join('\n')

  try {
    const resultado = await groqFetch(env, grupo, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Aquí están los ${logs.length} logs más recientes del sistema POS "Listo Cotizaciones" (Construacero Carabobo):\n\n${resumen}` },
    ], { maxTokens: 3000 })

    // Guardar resultado en cache
    await fetch(`${env.SUPABASE_URL}/rest/v1/system_log_analysis`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ tipo, resultado, logs_count: logs.length }),
    }).catch(() => {})

    return json({ tipo, resultado, logs_count: logs.length, modelo: 'llama-3.3-70b-versatile' }, 200, request)
  } catch (e) {
    await logToSystem(env, { nivel: 'error', origen: 'worker', categoria: 'SISTEMA', mensaje: `Error en análisis AI (${tipo}): ${e.message}`, stack: e.stack })
    return jsonError(`Error en análisis AI: ${e.message}`, 500, request)
  }
}

// DELETE /api/admin/logs/purge — limpiar logs según rango de días
export async function handlePurgeLogs(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const isSup = await verifySupervisor(user.operator_id, env)
  if (!isSup) return jsonError('Solo supervisores', 403, request)

  // Leer días del body (0 = todos, 7 = >7 días, 30 = >30 días, etc.)
  let body = {}
  try { body = await request.json() } catch { /* sin body = todos */ }
  const dias = typeof body.dias === 'number' ? body.dias : 0

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  }

  let filter = ''
  if (dias > 0) {
    const corte = new Date(Date.now() - dias * 86400000).toISOString()
    filter = `?ts=lt.${corte}`
  } else {
    // Borrar todos: necesitamos un filtro que matchee todo
    filter = '?id=not.is.null'
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/system_logs${filter}`,
    { method: 'DELETE', headers: { ...h, Prefer: 'return=representation', 'Content-Type': 'application/json' } }
  )

  if (!res.ok) return jsonError('Error purgando logs', 500, request)
  const deleted = await res.json()

  return json({ ok: true, eliminados: deleted.length }, 200, request)
}
