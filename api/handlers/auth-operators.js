// api/handlers/auth-operators.js
import { json as baseJson, jsonError as baseJsonError, isRateLimited, isValidUuid } from '../lib/utils.js'
import { verifyAuth, SUPER_ADMIN_UUID, supaServiceHeaders } from '../lib/auth.js'
import { issueOperatorSession, resolveOperatorSession, revokeOperatorSession } from '../lib/operatorSession.js'
import { verifyPinPBKDF2 } from '../lib/crypto.js'
import { registrarAuditoria, logToSystem } from '../lib/audit.js'

function privateResponse(response) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  return response
}
const json = (...args) => privateResponse(baseJson(...args))
const jsonError = (...args) => privateResponse(baseJsonError(...args))

// Renovar un PIN válido no depende de que la sesión anterior siga vigente.
function verifyAccount(request, env) {
  const headers = new Headers(request.headers)
  headers.delete('X-Operator-Id')
  headers.delete('X-Operator-Session')
  return verifyAuth({ headers }, env)
}

function fetchConTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

async function replaceOperatorSession(request, env, accountId, operator, virtualDeveloper = false) {
  const session = await issueOperatorSession(env, { accountId, operator, virtualDeveloper })
  try {
    await revokeOperatorSession(env, request.headers.get('X-Operator-Session'), accountId)
  } catch (error) {
    // A failed replacement must not return an additional usable session.
    await revokeOperatorSession(env, session.token, accountId).catch(() => {})
    throw error
  }
  return session
}

async function resolveOperatorMarkup(env, headers, accountId, operator) {
  let markup_pct = operator.markup_pct ?? null
  if (operator.es_externo) {
    const configResponse = await fetchConTimeout(
      `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${accountId}&limit=1&select=markup_pct_externo`,
      { headers },
    )
    if (!configResponse.ok) throw new Error('Error al obtener configuración del operador')
    const [config] = await configResponse.json()
    if (config) markup_pct = config.markup_pct_externo
  }
  return markup_pct
}

function formatOperatorPayload(operator, markup_pct) {
  return {
    id: operator.id,
    nombre: operator.nombre,
    rol: operator.rol,
    color: operator.color,
    markup_pct,
    comision_pct: operator.comision_pct ?? null,
    comision_pct_cabilla: operator.comision_pct_cabilla ?? null,
    es_externo: !!operator.es_externo,
  }
}

export async function handleSwitchOperator(request, env) {
  const requestId = request.headers.get('X-Request-Id') || crypto.randomUUID()
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (isRateLimited(`switch:${ip}`)) {
    return jsonError('Demasiados intentos. Intenta en un minuto.', 429, request)
  }

  try {
    const user = await verifyAccount(request, env)
    if (!user?.id) return jsonError('No autenticado', 401, request)
    let body
    try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
    const { operator_id, pin } = body || {}
    if (!isValidUuid(operator_id) || typeof pin !== 'string' || !pin || pin.length > 128) {
      return jsonError('operator_id y pin válidos requeridos', 400, request)
    }

    const headers = supaServiceHeaders(env)
    const response = await fetchConTimeout(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${operator_id}&activo=eq.true&cuenta_id=eq.${user.id}&select=id,cuenta_id,activo,nombre,rol,codigo,pin_hash,pin_salt,color,markup_pct,comision_pct,comision_pct_cabilla,es_externo`,
      { headers },
    )
    if (!response.ok) return jsonError('Error al buscar operador', 500, request)
    const operators = await response.json()
    const operator = Array.isArray(operators) && operators.length === 1 ? operators[0] : null
    if (!operator || operator.id !== operator_id || operator.cuenta_id !== user.id || operator.activo !== true || operator.id === SUPER_ADMIN_UUID) {
      return jsonError('Operador no encontrado o inactivo', 404, request)
    }
    if (!operator.pin_hash || !operator.pin_salt) {
      return jsonError('El operador no tiene PIN configurado. El supervisor debe asignarle uno.', 400, request)
    }

    const audit = (payload) => {
      const p = registrarAuditoria(env, headers, {
        ...payload, meta: { ...(payload.meta || {}), request_id: requestId },
      }).catch(() => null)
      if (typeof env?.waitUntil === 'function') {
        env.waitUntil(p)
        return Promise.resolve(null)
      }
      return p
    }
    if (!await verifyPinPBKDF2(pin, operator.pin_hash, operator.pin_salt)) {
      await audit({
        usuarioId: operator.id, usuarioNombre: operator.nombre, usuarioRol: operator.rol,
        categoria: 'AUTH', accion: 'LOGIN_FALLIDO', descripcion: `Intento de login fallido para ${operator.nombre}`,
        entidadTipo: 'usuario', entidadId: operator.id, meta: { ip }, ip,
      })
      return jsonError('PIN incorrecto', 401, request)
    }

    let markup_pct
    try {
      markup_pct = await resolveOperatorMarkup(env, headers, user.id, operator)
    } catch {
      return jsonError('Error al obtener configuración del operador', 500, request)
    }

    const operatorSession = await replaceOperatorSession(request, env, user.id, operator)
    await audit({
      usuarioId: operator.id, usuarioNombre: operator.nombre, usuarioRol: operator.rol,
      categoria: 'AUTH', accion: 'LOGIN_EXITOSO', descripcion: `${operator.nombre} inició sesión`,
      entidadTipo: 'usuario', entidadId: operator.id, meta: { ip }, ip,
    })
    return json({
      ok: true,
      operator: formatOperatorPayload(operator, markup_pct),
      operatorSession,
    }, 200, request)
  } catch (error) {
    console.error('[SWITCH-OP] Failed', requestId, error?.message)
    return jsonError('Error interno al verificar operador', 500, request)
  }
}

export async function handleCurrentOperator(request, env) {
  try {
    const user = await verifyAccount(request, env)
    if (!user?.id) return jsonError('No autenticado', 401, request)

    const tokenHeader = request.headers.get('X-Operator-Session')
    const operatorHeader = request.headers.get('X-Operator-Id')
    const session = await resolveOperatorSession(env, tokenHeader, user.id, operatorHeader)
    if (!session || (operatorHeader && operatorHeader !== session.operator.id)) {
      return json({ error: 'Sesión de operador expirada o revocada', code: 'OPERATOR_SESSION_INVALID' }, 403, request)
    }

    const headers = supaServiceHeaders(env)
    const markup_pct = session.virtualDeveloper
      ? null
      : await resolveOperatorMarkup(env, headers, user.id, session.operator)

    return json({
      ok: true,
      operator: formatOperatorPayload(session.operator, markup_pct),
      operatorSession: { id: session.id, expiresAt: session.expiresAt },
    }, 200, request)
  } catch {
    return jsonError('Error al verificar la sesión de operador', 500, request)
  }
}

export async function handleGetTasaConfig(request, env) {
  try {
    const user = await verifyAccount(request, env)
    if (!user?.id) return jsonError('No autenticado', 401, request)
    const response = await fetchConTimeout(
      `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&limit=1&select=tasa_bcv_manual,actualizado_en`,
      { headers: supaServiceHeaders(env) },
    )
    if (!response.ok) return jsonError('Error al obtener tasa configurada', 500, request)
    const rows = await response.json()
    const config = Array.isArray(rows) ? rows[0] : null
    return json({
      tasa_bcv_manual: config?.tasa_bcv_manual ?? 0,
      actualizado_en: config?.actualizado_en ?? null,
    }, 200, request)
  } catch {
    return jsonError('Error al obtener tasa configurada', 500, request)
  }
}

export async function handleClearOperator(request, env) {
  try {
    const user = await verifyAccount(request, env)
    if (!user?.id) return jsonError('No autenticado', 401, request)
    await revokeOperatorSession(env, request.headers.get('X-Operator-Session'), user.id)
    return json({ ok: true }, 200, request)
  } catch {
    return jsonError('Error al cerrar la sesión de operador', 500, request)
  }
}

export async function handleGetOperators(request, env) {
  try {
    const user = await verifyAccount(request, env)
    if (!user?.id) return jsonError('No autenticado', 401, request)
    const response = await fetchConTimeout(
      `${env.SUPABASE_URL}/rest/v1/usuarios?activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,rol,codigo,color,es_externo&order=nombre.asc`,
      { headers: supaServiceHeaders(env) },
    )
    if (!response.ok) return jsonError('Error al obtener operadores', 500, request)
    const operators = await response.json()
    // Allowlist response fields even if a backing query accidentally changes.
    return json({
      operators: operators.map(operator => ({
        id: operator.id, nombre: operator.nombre, rol: operator.rol,
        codigo: operator.codigo, color: operator.color, es_externo: !!operator.es_externo,
      })),
    }, 200, request)
  } catch {
    return jsonError('Error al obtener operadores', 500, request)
  }
}

export async function handleSuperAdmin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (isRateLimited(`superadmin:${ip}`)) {
    return jsonError('Demasiados intentos. Intenta en un minuto.', 429, request)
  }
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  if (!env.DEV_SUPER_CODE || body?.code !== env.DEV_SUPER_CODE) {
    return jsonError('Código de acceso incorrecto', 403, request)
  }

  try {
    const user = await verifyAccount(request, env)
    if (!user?.id) return jsonError('Código válido pero no hay sesión activa. Inicia sesión primero.', 401, request)
    const operator = {
      id: SUPER_ADMIN_UUID, nombre: 'Desarrollador', rol: 'desarrollador',
      color: '#8b5cf6', es_externo: false,
    }
    const operatorSession = await replaceOperatorSession(request, env, user.id, operator, true)
    void logToSystem(env, {
      nivel: 'info', origen: 'worker', categoria: 'AUTH', mensaje: 'Acceso desarrollador activado',
      usuario_id: SUPER_ADMIN_UUID, usuario_nombre: 'Desarrollador', meta: { ip },
    })
    return json({ ok: true, operator, operatorSession }, 200, request)
  } catch {
    return jsonError('Error activando acceso', 500, request)
  }
}
