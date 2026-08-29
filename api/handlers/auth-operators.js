// api/handlers/auth-operators.js
import { json, jsonError, isRateLimited, isValidUuid } from '../lib/utils.js'
import { verifyAuth, validateOperator, SUPER_ADMIN_UUID } from '../lib/auth.js'
import { verifyPinPBKDF2 } from '../lib/crypto.js'
import { registrarAuditoria, logToSystem } from '../lib/audit.js'

function fetchConTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

export async function handleSwitchOperator(request, env) {
  const requestId = request.headers.get('X-Request-Id') || crypto.randomUUID()
  const startedAt = Date.now()
  const mark = () => Date.now() - startedAt

  try {
    const auditHeaders = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }
    const audit = (payload) => registrarAuditoria(env, auditHeaders, { ...payload, meta: { ...(payload.meta || {}), request_id: requestId } }).catch(err => console.warn('[SWITCH-OP] audit failed', requestId, err.message))
    console.log('[SWITCH-OP] start', requestId)
    // Rate limit
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    if (isRateLimited(`switch:${ip}`)) {
      return jsonError('Demasiados intentos. Intenta en un minuto.', 429, request);
    }

  // Verify business account is authenticated
  const user = await verifyAuth(request, env);
  console.log('[SWITCH-OP] verifyAuth', requestId, mark(), 'ms')
  if (!user?.id) return jsonError('No autenticado', 401, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { operator_id, pin } = body;
  if (!operator_id || !pin) return jsonError('operator_id y pin requeridos', 400, request);
  if (!isValidUuid(operator_id)) return jsonError('operator_id inválido', 400, request);

  // Fetch operator from usuarios table
  const res = await fetchConTimeout(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${operator_id}&activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,rol,pin_hash,pin_salt,color,markup_pct,comision_pct,comision_pct_cabilla,es_externo`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    },
    12000
  );
  console.log('[SWITCH-OP] usuarios', requestId, mark(), 'ms status:', res.status)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'no body')
    console.error('[SWITCH-OP] Supabase fetch error:', errText)
    return jsonError('Error al buscar operador', 500, request);
  }
  const [operator] = await res.json();
  if (!operator) return jsonError('Operador no encontrado o inactivo', 404, request);

  // Validate PIN against PBKDF2 hash in database
  if (!operator.pin_hash || !operator.pin_salt) {
    return jsonError('El operador no tiene PIN configurado. El supervisor debe asignarle uno.', 400, request);
  }
  const isValid = await verifyPinPBKDF2(pin, operator.pin_hash, operator.pin_salt);

  if (!isValid) {
    // Auditoría: intento fallido
    try {
      await audit({
        usuarioId: operator.id, usuarioNombre: operator.nombre, usuarioRol: operator.rol,
        categoria: 'AUTH', accion: 'LOGIN_FALLIDO', descripcion: `Intento de login fallido para ${operator.nombre}`,
        entidadTipo: 'usuario', entidadId: operator.id, meta: { ip }, ip,
      });
    } catch { /* auditoría best-effort */ }
    return jsonError('PIN incorrecto', 401, request);
  }

  // Update app_metadata on the business auth user
  const metaRes = await fetchConTimeout(
    `${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`,
    {
      method: 'PUT',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_metadata: {
          operator_id: operator.id,
          operator_rol: operator.rol,
          operator_nombre: operator.nombre,
          operator_es_externo: !!operator.es_externo,
        },
      }),
    },
    12000
  );

  console.log('[SWITCH-OP] metadata', requestId, mark(), 'ms status:', metaRes.status)
  if (!metaRes.ok) {
    const errText = await metaRes.text().catch(() => 'no body')
    console.error('[SWITCH-OP] Metadata update error:', errText)
    return jsonError('Error al establecer operador', 500, request);
  }

  // Auditoría exitosa en background: no puede bloquear el login.
  void audit({
    usuarioId: operator.id, usuarioNombre: operator.nombre, usuarioRol: operator.rol,
    categoria: 'AUTH', accion: 'LOGIN_EXITOSO', descripcion: `${operator.nombre} inició sesión`,
    entidadTipo: 'usuario', entidadId: operator.id, meta: { ip }, ip,
  })

  let markup_pct = operator.markup_pct ?? null;
  if (operator.es_externo) {
    const configRes = await fetchConTimeout(
      `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&limit=1&select=markup_pct_externo`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      },
      12000
    );
    if (configRes.ok) {
      const [config] = await configRes.json();
      if (config) {
        markup_pct = config.markup_pct_externo;
      }
    }
  }

  return json({
    ok: true,
    operator: {
      id: operator.id,
      nombre: operator.nombre,
      rol: operator.rol,
      color: operator.color,
      markup_pct,
      comision_pct: operator.comision_pct ?? null,
      comision_pct_cabilla: operator.comision_pct_cabilla ?? null,
      es_externo: !!operator.es_externo,
    },
  }, 200, request);
  } catch (err) {
    console.error('[SWITCH-OP] Error no controlado:', requestId, err?.message || err)
    return jsonError(err?.message || 'Error interno al verificar operador', 500, request);
  }
}

export async function handleClearOperator(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Clear operator from app_metadata
  await fetchConTimeout(`${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_metadata: { operator_id: null, operator_rol: null, operator_nombre: null },
    }),
  }, 5000).catch(() => {});

  return json({ ok: true }, 200, request);
}

// ── Obtener operadores activos para cache offline (incluye pin_hash/pin_salt) ─────────
export async function handleGetOperators(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const [res, configRes] = await Promise.all([
    fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,rol,color,pin_hash,pin_salt,markup_pct,comision_pct,comision_pct_cabilla,es_externo&order=nombre.asc`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    ),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&limit=1&select=markup_pct_externo`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    )
  ]);

  if (!res.ok) return jsonError('Error al obtener operadores', 500, request);
  const operators = await res.json();

  let markup_pct_externo = 5.00;
  if (configRes.ok) {
    const [config] = await configRes.json();
    if (config) {
      markup_pct_externo = config.markup_pct_externo;
    }
  }

  // Mapear markup_pct dinámico si es vendedor externo
  const operatorsMapped = operators.map(op => {
    if (op.es_externo) {
      return {
        ...op,
        markup_pct: markup_pct_externo
      };
    }
    return op;
  });

  return json({ operators: operatorsMapped }, 200, request);
}

// Desarrollador virtual — activa el operador especial sin usuario en DB
export async function handleSuperAdmin(request, env) {
  // Primero verificar el código (antes de auth, para dar error claro)
  let body;
  try { body = await request.clone().json(); } catch { return jsonError('Body inválido', 400, request); }

  if (!env.DEV_SUPER_CODE || body.code !== env.DEV_SUPER_CODE) {
    return jsonError('Código de acceso incorrecto', 403, request);
  }

  // Código correcto — ahora verificar sesión
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('Código válido pero no hay sesión activa. Inicia sesión primero.', 401, request);

  // Set desarrollador in app_metadata
  const metaRes = await fetchConTimeout(`${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_metadata: {
        operator_id: SUPER_ADMIN_UUID,
        operator_rol: 'desarrollador',
        operator_nombre: 'Desarrollador',
      },
    }),
  }, 5000);

  if (!metaRes.ok) return jsonError('Error activando acceso', 500, request);

  await logToSystem(env, {
    nivel: 'info',
    origen: 'worker',
    categoria: 'AUTH',
    mensaje: 'Acceso desarrollador activado',
    usuario_id: SUPER_ADMIN_UUID,
    usuario_nombre: 'Desarrollador',
    meta: { ip: request.headers.get('CF-Connecting-IP') || 'unknown' },
  })

  return json({
    ok: true,
    operator: { id: SUPER_ADMIN_UUID, nombre: 'Desarrollador', rol: 'desarrollador', color: '#8b5cf6' },
  }, 200, request);
}
