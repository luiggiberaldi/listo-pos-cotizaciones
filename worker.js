// worker.js
// Cloudflare Worker — sirve assets estáticos + API proxy para operaciones admin
// Las operaciones admin (crear/editar/eliminar usuarios) se manejan aquí
// para mantener el service_role key fuera del frontend.

// ── Allowed origins for CORS ──────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://listo-pos-cotizaciones.camelai.app',
  'https://listo-pos-cotizaciones.apps.camelai.dev',
  'https://listo-pos-cotizaciones.vercel.app',
]

function getAllowedOrigin(request) {
  const origin = request.headers.get('Origin') || ''
  if (ALLOWED_ORIGINS.includes(origin)) return origin
  // Allow same-origin requests (no Origin header)
  if (!origin) return null
  // Allow camelai subdomains
  if (origin.endsWith('.camelai.app') || origin.endsWith('.camelai.dev')) return origin
  // Allow Vercel preview deployments
  if (origin.endsWith('.vercel.app')) return origin
  return null
}

function corsHeaders(request) {
  const origin = getAllowedOrigin(request)
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

// ── Simple in-memory rate limiter (per-isolate, best-effort) ──────────────────
const rateLimitMap = new Map()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30 // max requests per minute per IP for admin endpoints

function isRateLimited(ip) {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 })
    return false
  }
  entry.count++
  if (entry.count > RATE_LIMIT_MAX) return true
  return false
}

// ── Email validation ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim())
}

// UUID v4 format validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidUuid(str) {
  return typeof str === 'string' && UUID_RE.test(str)
}

// ── PBKDF2 PIN hashing (Web Crypto, zero dependencies) ─────────────────────
async function hashPinPBKDF2(pin, salt) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 10_000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyPinPBKDF2(pin, storedHash, storedSalt) {
  const hash = await hashPinPBKDF2(pin, storedSalt)
  return hash === storedHash
}

function generateSalt() {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Sanitize search input for PostgREST ilike ─────────────────────────────────
function sanitizeSearch(input) {
  if (typeof input !== 'string') return ''
  return input.replace(/[%_\\'"()]/g, '').trim()
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight para requests cross-origin ────
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { headers: corsHeaders(request) });
    }

    // ── API routes (wrapped in error logging) ────
    if (url.pathname.startsWith('/api/')) {
      try {

    // ── API: recibir log del frontend ─────────────────────────────────────
    if (url.pathname === '/api/logs' && request.method === 'POST') {
      return handleLogFromClient(request, env);
    }

    // ── API: listar todos los clientes (bypass RLS para vendedores) ───────
    if (url.pathname === '/api/clientes' && request.method === 'GET') {
      return handleListarClientes(request, env);
    }

    // ── API: lookup clientes por IDs (bypass RLS para vendedores) ──────────
    if (url.pathname === '/api/clientes/lookup' && request.method === 'POST') {
      return handleClientesLookup(request, env);
    }

    // ── API: guardar cotización (bypass RLS para clientes ajenos) ─────────
    if (url.pathname === '/api/cotizaciones/guardar' && request.method === 'POST') {
      return handleGuardarCotizacion(request, env);
    }

    // ── API: reciclar cotización (supervisor: crea borrador desde rechazada/anulada/vencida) ──
    if (url.pathname === '/api/cotizaciones/reciclar' && request.method === 'POST') {
      return handleReciclarCotizacion(request, env);
    }

    // ── API: crear versión de cotización enviada (bypass RLS) ──────────────
    if (url.pathname === '/api/cotizaciones/crear-version' && request.method === 'POST') {
      return handleCrearVersion(request, env);
    }

    // ── API: enviar cotización (bypass RLS) ─────────────────────────────────
    if (url.pathname === '/api/cotizaciones/enviar' && request.method === 'POST') {
      return handleEnviarCotizacion(request, env);
    }

    // ── API: crear nota de despacho (bypass RLS) ────────────────────────────
    if (url.pathname === '/api/despachos/crear' && request.method === 'POST') {
      return handleCrearDespacho(request, env);
    }

    // ── API: actualizar estado de despacho (bypass RLS) ─────────────────────
    if (url.pathname === '/api/despachos/estado' && request.method === 'POST') {
      return handleActualizarEstadoDespacho(request, env);
    }

    // ── API: reciclar despacho anulado (bypass RLS) ─────────────────────────
    if (url.pathname === '/api/despachos/reciclar' && request.method === 'POST') {
      return handleReciclarDespacho(request, env);
    }

    // ── API: reasignar cliente (bypass RLS) ─────────────────────────────────
    if (url.pathname === '/api/clientes/reasignar' && request.method === 'POST') {
      return handleReasignarCliente(request, env);
    }

    // ── API: registrar abono CxC (bypass RLS) ──────────────────────────────
    if (url.pathname === '/api/cxc/abono' && request.method === 'POST') {
      return handleRegistrarAbono(request, env);
    }

    // ── API: marcar comisión pagada (bypass RLS) ────────────────────────────
    if (url.pathname === '/api/comisiones/pagar' && request.method === 'POST') {
      return handleMarcarComisionPagada(request, env);
    }

    // ── API: aplicar movimiento de inventario (bypass RLS) ──────────────────
    if (url.pathname === '/api/inventario/movimiento' && request.method === 'POST') {
      return handleAplicarMovimientoLote(request, env);
    }

    // ── API: admin logs (CRUD + análisis AI) ──────────────────────────────
    if (url.pathname === '/api/admin/logs' && request.method === 'GET') {
      return handleGetLogs(request, env, url);
    }
    if (url.pathname === '/api/admin/logs/stats' && request.method === 'GET') {
      return handleGetLogStats(request, env);
    }
    if (url.pathname === '/api/admin/logs/download' && request.method === 'GET') {
      return handleDownloadLogs(request, env);
    }
    if (url.pathname === '/api/admin/logs/analyze' && request.method === 'POST') {
      return handleAnalyzeLogs(request, env);
    }
    if (url.pathname === '/api/admin/logs/purge' && request.method === 'DELETE') {
      return handlePurgeLogs(request, env);
    }

    // ── API: backup completo del sistema ───────────────────────────────────
    if (url.pathname === '/api/admin/backup' && request.method === 'GET') {
      return handleBackup(request, env);
    }
    if (url.pathname === '/api/admin/restore' && request.method === 'POST') {
      return handleRestore(request, env);
    }
    if (url.pathname === '/api/admin/clear-inventory' && request.method === 'DELETE') {
      return handleClearInventory(request, env);
    }
    if (url.pathname === '/api/admin/factory-reset' && request.method === 'DELETE') {
      return handleTesterClearAll(request, env);
    }

    // ── API: guardar configuración (bypass RLS) ──────────────────────────
    if (url.pathname === '/api/admin/config' && request.method === 'PUT') {
      return handleSaveConfig(request, env);
    }

    // ── API: tester (seed demo + stress) ─────────────────────────────────
    if (url.pathname === '/api/admin/tester/seed-demo' && request.method === 'POST') {
      return handleTesterSeedDemo(request, env);
    }
    if (url.pathname === '/api/admin/tester/stress-seed' && request.method === 'POST') {
      return handleTesterStressSeed(request, env);
    }
    if (url.pathname === '/api/admin/tester/clear-all' && request.method === 'DELETE') {
      return handleTesterClearAll(request, env);
    }

    // ── API: switch/clear operator (auth con PIN) ────────────────────────
    if (url.pathname === '/api/auth/switch-operator' && request.method === 'POST') {
      return handleSwitchOperator(request, env);
    }
    if (url.pathname === '/api/auth/clear-operator' && request.method === 'POST') {
      return handleClearOperator(request, env);
    }
    if (url.pathname === '/api/auth/super-admin' && request.method === 'POST') {
      return handleSuperAdmin(request, env);
    }

    // ── API: subir PDF temporal (para WhatsApp) ─────────────────────────
    if (url.pathname === '/api/pdf-temp' && request.method === 'POST') {
      return handlePdfTemp(request, env);
    }

    // ── API routes para operaciones admin ──────────────────────────────────
    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdmin(request, env, url);
    }

    // ── API routes para push notifications ────────────────────────────────
    if (url.pathname.startsWith('/api/push/')) {
      return handlePush(request, env, url);
    }

    // API route not found
    return jsonError('Ruta API no encontrada', 404, request);

      } catch (e) {
        // Log unhandled API errors to system_logs
        const user = await verifyAuth(request, env).catch(() => null)
        await logToSystem(env, {
          nivel: 'error',
          origen: 'worker',
          categoria: 'SISTEMA',
          mensaje: `Unhandled: ${e.message}`,
          stack: e.stack?.slice(0, 3000),
          endpoint: `${request.method} ${url.pathname}`,
          usuario_id: user?.operator_id || user?.id || null,
          usuario_nombre: user?.app_metadata?.operator_nombre || user?.email || null,
          meta: { method: request.method, pathname: url.pathname },
        })
        return jsonError('Error interno del servidor', 500, request)
      }
    }

    // ── Security headers para assets estáticos ─────────────────────────────
    const response = await env.ASSETS.fetch(request);

    // SPA fallback: si el asset no existe y no es un archivo estático,
    // servir index.html para que React Router maneje la ruta
    if (response.status === 404) {
      const ext = url.pathname.split('.').pop()
      const isStaticFile = ['js', 'css', 'png', 'jpg', 'jpeg', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'webp', 'gif', 'map'].includes(ext)
      if (!isStaticFile) {
        const fallback = await env.ASSETS.fetch(new Request(new URL('/', url.origin), request))
        const fbHeaders = new Headers(fallback.headers)
        fbHeaders.set('X-Content-Type-Options', 'nosniff')
        fbHeaders.set('X-Frame-Options', 'DENY')
        fbHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin')
        fbHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        fbHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
        fbHeaders.set('Pragma', 'no-cache')
        return new Response(fallback.body, {
          status: 200,
          statusText: 'OK',
          headers: fbHeaders,
        })
      }
    }

    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('X-Frame-Options', 'DENY');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // index.html no debe cachearse para que el browser siempre cargue el JS actualizado
    const isHtml = response.headers.get('content-type')?.includes('text/html')
      || url.pathname === '/' || !url.pathname.includes('.')
    if (isHtml) {
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      newHeaders.set('Pragma', 'no-cache')
    } else {
      // Versioned assets (Vite hashed filenames) → immutable 1 year cache
      const isVersionedAsset = /\/assets\/.*-[a-zA-Z0-9]{8,}\.(js|css|woff2?|png|jpg|webp|ico)$/i.test(url.pathname)
      if (isVersionedAsset) {
        newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable')
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(request ? corsHeaders(request) : {}),
    },
  });
}

function jsonError(message, status = 400, request = null) {
  return json({ error: message }, status, request);
}

// ── System Logging ─────────────────────────────────────────────────────────
// Inserta logs persistentes en system_logs via service_role
async function logToSystem(env, { nivel = 'error', origen = 'worker', categoria, mensaje, stack, endpoint, usuario_id, usuario_nombre, meta }) {
  try {
    const body = { nivel, origen, categoria, mensaje, stack: stack || null, endpoint: endpoint || null, usuario_id: usuario_id || null, usuario_nombre: usuario_nombre || null, meta: meta || {} }
    await fetch(`${env.SUPABASE_URL}/rest/v1/system_logs`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    })
  } catch { /* silencioso — no queremos loop de errores */ }
}

// ── Groq Round-Robin ───────────────────────────────────────────────────────
const groqCounters = { A: 0, B: 0, C: 0 }

async function groqFetch(env, grupo, messages, { maxTokens = 2048, temperature = 0.3 } = {}) {
  const envKey = `GROQ_KEYS_${grupo}`
  const raw = env[envKey]
  if (!raw) throw new Error(`No hay keys configuradas para grupo ${grupo}`)
  const keys = raw.split(',').map(k => k.trim()).filter(Boolean)
  if (!keys.length) throw new Error(`Keys vacías para grupo ${grupo}`)

  const startIdx = groqCounters[grupo] % keys.length
  groqCounters[grupo]++

  // Intentar round-robin: si una falla (429), probar la siguiente
  for (let i = 0; i < keys.length; i++) {
    const idx = (startIdx + i) % keys.length
    const key = keys[idx]
    try {
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 20_000)
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          max_completion_tokens: maxTokens,
          temperature,
        }),
        signal: ctrl.signal,
      })
      clearTimeout(timeout)

      if (res.status === 429) continue  // rate limited → next key
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Groq API error ${res.status}: ${errText.slice(0, 200)}`)
      }
      const data = await res.json()
      return data.choices?.[0]?.message?.content || ''
    } catch (e) {
      if (e.name === 'AbortError') continue // timeout → next key
      if (i === keys.length - 1) throw e    // last key → propagate
    }
  }
  throw new Error(`Todas las keys del grupo ${grupo} fallaron (rate limit)`)
}

// Verifica el JWT del usuario autenticado contra Supabase
// Extrae operator_id/operator_rol de app_metadata si están presentes
async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  // Verificar el token llamando a Supabase auth
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) return null;
  const user = await res.json();
  // Attach operator context from app_metadata (set by switch-operator)
  user.operator_id = user.app_metadata?.operator_id || null;
  user.operator_rol = user.app_metadata?.operator_rol || null;
  return user;
}

// Verifica que el operador sea supervisor consultando la tabla usuarios
// UUID especial para Super Admin virtual (easter egg del logo)
const SUPER_ADMIN_UUID = '00000000-0000-0000-0000-000000000000'

async function verifySupervisor(operatorId, env) {
  if (!operatorId) return false;
  if (operatorId === SUPER_ADMIN_UUID) return true; // Super Admin virtual
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${operatorId}&activo=eq.true&select=rol`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length === 1 && rows[0].rol === 'supervisor';
}

// ── PDF temporal handler (para WhatsApp) ──────────────────────────────────

async function handlePdfTemp(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const blob = await request.arrayBuffer();
  if (!blob || blob.byteLength === 0) return jsonError('PDF vacío', 400, request);
  if (blob.byteLength > 2 * 1024 * 1024) return jsonError('PDF muy grande (max 2MB)', 400, request);

  const id = crypto.randomUUID().slice(0, 8);
  const filename = request.headers.get('X-Filename') || 'cotizacion.pdf';
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${id}_${safeName}`;

  const res = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/pdf-temp/${path}`,
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/pdf',
        'Cache-Control': 'max-age=604800',
      },
      body: blob,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error subiendo PDF: ${err}`, 500, request);
  }

  const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/pdf-temp/${path}`;
  return new Response(JSON.stringify({ url: publicUrl }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ── Admin route handler ───────────────────────────────────────────────────

async function handleAdmin(request, env, url) {
  // Solo POST/PUT/DELETE
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) {
    return jsonError('Method not allowed', 405, request);
  }

  // Verificar que las secrets estén configuradas
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonError('Server misconfigured: missing Supabase secrets', 500, request);
  }

  // Rate limiting on admin endpoints
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (isRateLimited(ip)) {
    return jsonError('Demasiadas solicitudes. Intenta en un minuto.', 429, request);
  }

  // Autenticar usuario
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Verificar que es supervisor (usa operator_id del JWT app_metadata)
  const isSupervisor = await verifySupervisor(user.operator_id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  // Parsear body
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const route = url.pathname.replace('/api/admin/', '');

  // ── Crear usuario (solo en tabla usuarios, sin auth.users) ───────────
  if (route === 'users' && request.method === 'POST') {
    const { nombre, rol, pin, color, telefono } = body;
    if (!nombre || !rol || !pin) {
      return jsonError('Faltan campos: nombre, rol, pin', 400, request);
    }

    // Validate rol
    if (!['supervisor', 'vendedor'].includes(rol)) {
      return jsonError('Rol inválido: debe ser supervisor o vendedor', 400, request);
    }

    // Validate PIN length
    const pinLen = rol === 'vendedor' ? 4 : 6;
    if (!/^\d+$/.test(pin) || pin.length !== pinLen) {
      return jsonError(`El PIN debe ser exactamente ${pinLen} dígitos numéricos`, 400, request);
    }

    // Hash PIN with PBKDF2
    const salt = generateSalt();
    const hash = await hashPinPBKDF2(pin, salt);
    const newId = crypto.randomUUID();

    // Insertar en public.usuarios
    const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: newId,
        nombre: nombre.trim(),
        rol,
        activo: true,
        pin_hash: hash,
        pin_salt: salt,
        ...(color ? { color } : {}),
        ...(telefono ? { telefono: telefono.trim() } : {}),
      }),
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      return jsonError('Error al crear usuario: ' + errText, 500, request);
    }

    return json({ id: newId, ok: true }, 201, request);
  }

  // ── Actualizar usuario (nombre, rol, PIN, color) ──────────────────────
  if (route.startsWith('users/') && request.method === 'PUT') {
    const userId = route.replace('users/', '');
    if (!isValidUuid(userId)) return jsonError('ID de usuario inválido', 400, request);
    const { nombre, rol, pin, color, telefono } = body;

    // Validate rol if provided
    if (rol && !['supervisor', 'vendedor'].includes(rol)) {
      return jsonError('Rol inválido', 400, request);
    }

    // Build update data
    const updateData = {};
    if (nombre) updateData.nombre = nombre.trim();
    if (rol) updateData.rol = rol;
    if (color !== undefined) updateData.color = color;
    if (telefono !== undefined) updateData.telefono = telefono ? telefono.trim() : null;

    // Hash new PIN if provided
    if (pin) {
      const pinLen = (rol || 'vendedor') === 'vendedor' ? 4 : 6;
      if (!/^\d+$/.test(pin) || pin.length !== pinLen) {
        return jsonError(`El PIN debe ser exactamente ${pinLen} dígitos numéricos`, 400, request);
      }
      const salt = generateSalt();
      const hash = await hashPinPBKDF2(pin, salt);
      updateData.pin_hash = hash;
      updateData.pin_salt = salt;
    }

    if (Object.keys(updateData).length > 0) {
      const dbRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${userId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(updateData),
        }
      );
      if (!dbRes.ok) return jsonError('Error al actualizar usuario', 500, request);
    }

    return json({ ok: true }, 200, request);
  }

  // ── Eliminar usuario (solo de tabla usuarios, sin auth) ──────────────
  if (route.startsWith('users/') && request.method === 'DELETE') {
    const userId = route.replace('users/', '');
    if (!isValidUuid(userId)) return jsonError('ID de usuario inválido', 400, request);

    // Eliminar de public.usuarios
    const dbRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${userId}`,
      {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=minimal',
        },
      }
    );

    if (!dbRes.ok) return jsonError('Error al eliminar usuario', 500, request);

    return json({ ok: true }, 200, request);
  }

  return jsonError('Ruta no encontrada', 404, request);
}

// ══════════════════════════════════════════════════════════════════════════════
// OPERATOR SWITCHING (PIN-based auth)
// ══════════════════════════════════════════════════════════════════════════════

async function handleSwitchOperator(request, env) {
  // Rate limit
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (isRateLimited(`switch:${ip}`)) {
    return jsonError('Demasiados intentos. Intenta en un minuto.', 429, request);
  }

  // Verify business account is authenticated
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { operator_id, pin } = body;
  if (!operator_id || !pin) return jsonError('operator_id y pin requeridos', 400, request);
  if (!isValidUuid(operator_id)) return jsonError('operator_id inválido', 400, request);

  // Fetch operator from usuarios table
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${operator_id}&activo=eq.true&select=id,nombre,rol,pin_hash,pin_salt,color`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return jsonError('Error al buscar operador', 500, request);
  const [operator] = await res.json();
  if (!operator) return jsonError('Operador no encontrado o inactivo', 404, request);

  // Validate PIN
  if (!operator.pin_hash || !operator.pin_salt) {
    return jsonError('El operador no tiene PIN configurado. El supervisor debe asignarle uno.', 400, request);
  }

  const isValid = await verifyPinPBKDF2(pin, operator.pin_hash, operator.pin_salt);
  if (!isValid) return jsonError('PIN incorrecto', 401, request);

  // Update app_metadata on the business auth user
  const metaRes = await fetch(
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
        },
      }),
    }
  );

  if (!metaRes.ok) {
    return jsonError('Error al establecer operador', 500, request);
  }

  return json({
    ok: true,
    operator: { id: operator.id, nombre: operator.nombre, rol: operator.rol, color: operator.color },
  }, 200, request);
}

async function handleClearOperator(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Clear operator from app_metadata
  await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_metadata: { operator_id: null, operator_rol: null, operator_nombre: null },
    }),
  });

  return json({ ok: true }, 200, request);
}

// Super Admin virtual — activa el operador especial sin usuario en DB
const SUPER_ADMIN_CODE = '794848'

async function handleSuperAdmin(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  if (body.code !== SUPER_ADMIN_CODE) {
    return jsonError('Código incorrecto', 401, request);
  }

  // Set super admin in app_metadata
  const metaRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_metadata: {
        operator_id: SUPER_ADMIN_UUID,
        operator_rol: 'supervisor',
        operator_nombre: 'Super Admin',
      },
    }),
  });

  if (!metaRes.ok) return jsonError('Error activando Super Admin', 500, request);

  await logToSystem(env, {
    nivel: 'info',
    origen: 'worker',
    categoria: 'AUTH',
    mensaje: 'Super Admin activado',
    usuario_id: SUPER_ADMIN_UUID,
    usuario_nombre: 'Super Admin',
    meta: { ip: request.headers.get('CF-Connecting-IP') || 'unknown' },
  })

  return json({
    ok: true,
    operator: { id: SUPER_ADMIN_UUID, nombre: 'Super Admin', rol: 'supervisor', color: '#ef4444' },
  }, 200, request);
}

// ══════════════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// Implementación de Web Push Protocol usando Web Crypto API (sin dependencias)
// ══════════════════════════════════════════════════════════════════════════════

async function handlePush(request, env, url) {
  const route = url.pathname.replace('/api/push/', '');

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }

  // ── GET vapid-public-key — devuelve la clave pública VAPID ──────────────
  if (route === 'vapid-public-key' && request.method === 'GET') {
    return json({ key: env.VAPID_PUBLIC_KEY }, 200, request);
  }

  // ── POST subscribe — guarda la suscripción push ──────────────────────────
  if (route === 'subscribe' && request.method === 'POST') {
    const user = await verifyAuth(request, env);
    if (!user?.id) return jsonError('No autenticado', 401, request);

    let body;
    try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

    const { endpoint, keys } = body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return jsonError('Suscripción incompleta', 400, request);
    }

    // Upsert de la suscripción
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        usuario_id: user.operator_id || user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      }),
    });

    if (!res.ok) return jsonError('Error al guardar suscripción', 500, request);
    return json({ ok: true }, 200, request);
  }

  // ── DELETE unsubscribe — elimina la suscripción ──────────────────────────
  if (route === 'unsubscribe' && request.method === 'DELETE') {
    const user = await verifyAuth(request, env);
    if (!user?.id) return jsonError('No autenticado', 401, request);

    let body;
    try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

    await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?usuario_id=eq.${user.operator_id || user.id}&endpoint=eq.${encodeURIComponent(body.endpoint)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    return json({ ok: true }, 200, request);
  }

  // ── POST send — envía push a usuarios específicos ──────────────────────────
  if (route === 'send' && request.method === 'POST') {
    const user = await verifyAuth(request, env);
    if (!user?.id) return jsonError('No autenticado', 401, request);

    // Rate limit push sends
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    if (isRateLimited(`push:${ip}`)) {
      return jsonError('Demasiadas notificaciones. Intenta en un minuto.', 429, request);
    }

    let body;
    try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

    const { title, message, url: targetUrl = '/', tag, targetRole, targetUserId } = body;
    if (!title || !message) return jsonError('Faltan title y message', 400, request);

    // Construir filtro de suscripciones según target
    let subsUrl = `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth,usuario_id`;

    if (targetUserId) {
      // Enviar solo a un usuario específico
      subsUrl += `&usuario_id=eq.${targetUserId}`;
    } else if (targetRole) {
      // Enviar solo a usuarios con un rol específico (supervisor/vendedor)
      // Primero obtener IDs de usuarios con ese rol
      const usersRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/usuarios?select=id&rol=eq.${targetRole}`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          },
        }
      );
      if (!usersRes.ok) return jsonError('Error al obtener usuarios', 500, request);
      const users = await usersRes.json();
      const userIds = users.map(u => u.id);
      if (!userIds.length) return json({ ok: true, sent: 0 }, 200, request);
      subsUrl += `&usuario_id=in.(${userIds.join(',')})`;
    }
    // Si no hay targetRole ni targetUserId, NO enviar a nadie (evitar spam global)
    // excepto si el sender es supervisor (notificaciones de sistema)
    else {
      // Por defecto: enviar a todos menos al que envía
      subsUrl += `&usuario_id=neq.${user.operator_id || user.id}`;
    }

    // Obtener suscripciones filtradas
    const subsRes = await fetch(subsUrl, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    });

    if (!subsRes.ok) return jsonError('Error al obtener suscripciones', 500, request);
    const subscriptions = await subsRes.json();

    if (!subscriptions.length) return json({ ok: true, sent: 0 }, 200, request);

    const payload = JSON.stringify({ title, body: message, tag, url: targetUrl });
    let sent = 0;
    const failed = [];

    // Send in batches of 5 concurrent pushes to avoid Worker timeout
    const BATCH_SIZE = 5;
    for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
      const batch = subscriptions.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (sub) => {
          await sendWebPush(sub.endpoint, sub.p256dh, sub.auth, payload, env);
          return sub.endpoint;
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          sent++;
        } else {
          const errMsg = result.reason?.message || '';
          const failedEndpoint = batch[results.indexOf(result)]?.endpoint;
          console.error('Push failed for', failedEndpoint, errMsg);
          failed.push(failedEndpoint);
          // Si el endpoint ya no existe, eliminarlo
          if (errMsg.includes('410') || errMsg.includes('404')) {
            await fetch(
              `${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(failedEndpoint)}`,
              {
                method: 'DELETE',
                headers: {
                  apikey: env.SUPABASE_SERVICE_KEY,
                  Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                },
              }
            );
          }
        }
      }
    }

    return json({ ok: true, sent, failed: failed.length }, 200, request);
  }

  return jsonError('Ruta push no encontrada', 404, request);
}

// ── Web Push Protocol — implementación pura con Web Crypto API ──────────────

async function sendWebPush(endpoint, p256dhBase64, authBase64, payload, env) {
  const crypto = globalThis.crypto;

  // Decodificar claves del cliente
  const clientPublicKey = base64urlDecode(p256dhBase64);
  const clientAuth = base64urlDecode(authBase64);

  // Importar clave pública del cliente
  const clientKey = await crypto.subtle.importKey(
    'raw', clientPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // Generar par de claves efímeras del servidor
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
  );

  // Exportar clave pública del servidor (para el header)
  const serverPublicKeyRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);

  // Derivar secreto compartido
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, serverKeyPair.privateKey, 256
  );

  // Salt aleatorio (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF para derivar claves de cifrado
  const prk = await hkdf(clientAuth, sharedSecret, concatBuffers(
    lengthPrefix(clientPublicKey),
    lengthPrefix(serverPublicKeyRaw),
  ), 32);

  const cek = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: aesgcm\0'), 16);
  const nonce = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Cifrar payload con AES-GCM
  const payloadBytes = new TextEncoder().encode(payload);
  const padded = new Uint8Array(2 + payloadBytes.length);
  new DataView(padded.buffer).setUint16(0, 0); // sin padding
  padded.set(payloadBytes, 2);

  const encryptionKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encryptionKey, padded);

  // JWT VAPID
  const vapidJwt = await createVapidJwt(endpoint, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);

  // Hacer la petición al push service
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Authorization': `vapid t=${vapidJwt},k=${env.VAPID_PUBLIC_KEY}`,
      'Crypto-Key': `dh=${base64urlEncode(serverPublicKeyRaw)}`,
      'Encryption': `salt=${base64urlEncode(salt)}`,
      'TTL': '86400',
    },
    body: encrypted,
  });

  if (!response.ok && response.status !== 201) {
    throw new Error(`Push failed: ${response.status}`);
  }
}

async function createVapidJwt(endpoint, privateKeyBase64, publicKeyBase64) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp,
    sub: 'mailto:admin@listpos.com',
  })));

  const signingInput = `${header}.${claims}`;

  // Importar clave privada VAPID
  const keyData = base64urlDecode(privateKeyBase64);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64urlEncode(signature)}`;
}

async function hkdf(salt, ikm, info, length) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = await crypto.subtle.sign('HMAC', saltKey, ikm);
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = concatBuffers(info, new Uint8Array([1]));
  const okm = await crypto.subtle.sign('HMAC', prkKey, infoWithCounter);
  return new Uint8Array(okm).slice(0, length);
}

function concatBuffers(...buffers) {
  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer || buf), offset);
    offset += buf.byteLength;
  }
  return result;
}

function lengthPrefix(buffer) {
  const arr = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer);
  const result = new Uint8Array(2 + arr.length);
  new DataView(result.buffer).setUint16(0, arr.length);
  result.set(arr, 2);
  return result;
}

function base64urlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + (4 - str.length % 4) % 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function base64urlEncode(buffer) {
  const arr = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer);
  let binary = '';
  arr.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Backup completo del sistema ───────────────────────────────────────────

async function handleBackup(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonError('Server misconfigured', 500, request);
  }

  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const isSupervisor = await verifySupervisor(user.operator_id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };

  const errors = [];

  async function fetchTable(tabla, query = '') {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tabla}?limit=100000${query}`, { headers: h });
    if (!res.ok) {
      errors.push(`Error al leer ${tabla}: ${res.status}`);
      return [];
    }
    return res.json();
  }

  const [
    productos,
    clientes,
    cotizaciones,
    cotizacion_items,
    notas_despacho,
    transportistas,
    usuarios,
    configuracion_negocio,
    auditoria,
  ] = await Promise.all([
    fetchTable('productos', '&order=codigo.asc'),
    fetchTable('clientes', '&order=nombre.asc'),
    fetchTable('cotizaciones', '&order=numero.asc'),
    fetchTable('cotizacion_items', '&order=cotizacion_id.asc,orden.asc'),
    fetchTable('notas_despacho', '&order=numero.asc'),
    fetchTable('transportistas', '&order=nombre.asc'),
    fetchTable('usuarios', '&order=nombre.asc'),
    fetchTable('configuracion_negocio'),
    fetchTable('auditoria', '&order=ts.desc&limit=5000'),
  ]);

  // If any table failed to load, warn in the backup
  const negocio = configuracion_negocio?.[0]?.nombre_negocio || 'sistema';

  const backup = {
    version: '1.0',
    generado_en: new Date().toISOString(),
    negocio,
    errores: errors.length > 0 ? errors : undefined,
    tablas: {
      productos,
      clientes,
      cotizaciones,
      cotizacion_items,
      notas_despacho,
      transportistas,
      usuarios,
      configuracion_negocio,
      auditoria,
    },
    resumen: {
      productos: productos.length,
      clientes: clientes.length,
      cotizaciones: cotizaciones.length,
      notas_despacho: notas_despacho.length,
      transportistas: transportistas.length,
      usuarios: usuarios.length,
    },
  };

  if (errors.length > 0) {
    backup.advertencia = `Backup incompleto: ${errors.length} tabla(s) con errores`;
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const filename = `backup-${negocio.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${fecha}.json`;

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...(errors.length > 0 ? { 'X-Backup-Warnings': errors.join('; ') } : {}),
    },
  });
}


async function handleRestore(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonError('Server misconfigured', 500, request);
  }

  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const isSupervisor = await verifySupervisor(user.operator_id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  let backup;
  try {
    backup = await request.json();
  } catch {
    return jsonError('Archivo inválido: no es un JSON válido', 400, request);
  }

  if (!backup?.tablas) {
    return jsonError('Archivo inválido: no parece un backup del sistema', 400, request);
  }

  // Validate expected tables (solo las fundamentales)
  const expectedTables = ['productos'];
  const missingTables = expectedTables.filter(t => !backup.tablas[t]);
  if (missingTables.length > 0) {
    return jsonError(`Backup incompleto: faltan tablas ${missingTables.join(', ')}`, 400, request);
  }

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  };

  // Tablas a restaurar en orden (respetando FK)
  const TABLAS_RESTORE = [
    'configuracion_negocio',
    'transportistas',
    'productos',
    'clientes',
    'cotizaciones',
    'cotizacion_items',
    'notas_despacho',
  ];

  const resumen = {};
  const errores = [];

  for (const tabla of TABLAS_RESTORE) {
    const filas = backup.tablas[tabla];
    if (!Array.isArray(filas) || filas.length === 0) {
      resumen[tabla] = 0;
      continue;
    }

    // Upsert en lotes de 500
    let restaurados = 0;
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500);
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tabla}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(lote),
      });
      if (res.ok) {
        restaurados += lote.length;
      } else {
        const errText = await res.text().catch(() => 'unknown');
        errores.push(`${tabla} lote ${i}-${i + lote.length}: ${errText}`);
      }
    }
    resumen[tabla] = restaurados;
  }

  return json({
    ok: errores.length === 0,
    resumen,
    errores: errores.length > 0 ? errores : undefined,
    advertencia: errores.length > 0 ? `Restore parcial: ${errores.length} lote(s) fallaron` : undefined,
  }, 200, request);
}


async function handleClearInventory(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);

  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const isSupervisor = await verifySupervisor(user.operator_id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  // Borrar kardex (movimientos) antes de productos
  await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: h,
  });

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: h,
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonError(`Error al borrar: ${text}`, 500, request);
  }

  return json({ ok: true }, 200, request);
}


async function handleListarClientes(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const url = new URL(request.url);
  const busqueda = url.searchParams.get('busqueda') || '';

  let queryUrl = `${env.SUPABASE_URL}/rest/v1/clientes?activo=eq.true&order=nombre.asc&select=id,nombre,rif_cedula,telefono,email,direccion,notas,tipo_cliente,activo,vendedor_id,saldo_pendiente,vendedor:usuarios!clientes_vendedor_id_fkey(id,nombre,color)`;

  if (busqueda.trim()) {
    const safe = sanitizeSearch(busqueda);
    if (safe) {
      queryUrl += `&or=(nombre.ilike.*${encodeURIComponent(safe)}*,rif_cedula.ilike.*${encodeURIComponent(safe)}*)`;
    }
  }

  const res = await fetch(queryUrl, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Error fetching clientes:', res.status, errText);
    return jsonError(`Error al cargar clientes: ${errText}`, res.status, request);
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ── Lookup clientes by IDs (service key, bypasses RLS) ──────────────────────
async function handleClientesLookup(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const { ids } = await request.json();
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) {
    return jsonError('ids debe ser un array de 1-200 UUIDs', 400, request);
  }

  const queryUrl = `${env.SUPABASE_URL}/rest/v1/clientes?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,nombre,rif_cedula,telefono,email,direccion,tipo_cliente,vendedor_id,vendedor:usuarios!clientes_vendedor_id_fkey(id,nombre,color)`;

  const res = await fetch(queryUrl, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });

  if (!res.ok) {
    return jsonError('Error al buscar clientes', res.status, request);
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ── Save cotización (service key bypasses RLS for cross-vendor clients) ────
async function handleGuardarCotizacion(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { cotizacionId, headerData, items } = body;
  if (!headerData || !items || !Array.isArray(items)) return jsonError('Faltan campos', 400, request);

  // Validate items
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.nombre_snap) return jsonError(`Item ${i + 1}: nombre requerido`, 400, request);
    if (typeof it.cantidad !== 'number' || it.cantidad <= 0) return jsonError(`Item ${i + 1}: cantidad debe ser > 0`, 400, request);
    if (typeof it.precio_unit_usd !== 'number' || it.precio_unit_usd < 0) return jsonError(`Item ${i + 1}: precio inválido`, 400, request);
    if (it.descuento_pct != null && (it.descuento_pct < 0 || it.descuento_pct > 100)) return jsonError(`Item ${i + 1}: descuento debe estar entre 0 y 100`, 400, request);
  }

  // Force vendedor_id to authenticated operator
  headerData.vendedor_id = user.operator_id;

  const supaHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  let id = cotizacionId;

  try {
    if (!id) {
      // Create new cotización
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id`, {
        method: 'POST',
        headers: { ...supaHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ ...headerData, estado: 'borrador' }),
      });
      if (!res.ok) {
        const err = await res.text();
        return jsonError(`Error al crear: ${err}`, 500, request);
      }
      const [row] = await res.json();
      id = row.id;
    } else {
      // Verify ownership: cotización must belong to the authenticated user
      const checkRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${id}&select=vendedor_id,estado`, {
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      });
      if (!checkRes.ok) return jsonError('Error al verificar cotización', 500, request);
      const [existing] = await checkRes.json();
      if (!existing) return jsonError('Cotización no encontrada', 404, request);
      if (existing.vendedor_id !== user.operator_id) {
        // Check if user is supervisor (supervisors can edit any cotización)
        const isSupervisor = await verifySupervisor(user.operator_id, env);
        if (!isSupervisor) return jsonError('No tienes permiso para editar esta cotización', 403, request);
      }
      if (existing.estado !== 'borrador') return jsonError('Solo se pueden editar cotizaciones en borrador', 400, request);

      // Update existing
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${id}`, {
        method: 'PATCH',
        headers: supaHeaders,
        body: JSON.stringify(headerData),
      });
      if (!res.ok) {
        const err = await res.text();
        return jsonError(`Error al actualizar: ${err}`, 500, request);
      }

      // Delete old items
      await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${id}`, {
        method: 'DELETE',
        headers: supaHeaders,
      });
    }

    // Insert items
    if (items.length > 0) {
      const rows = items.map((it, idx) => ({ ...it, cotizacion_id: id, orden: idx }));
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST',
        headers: supaHeaders,
        body: JSON.stringify(rows),
      });
      if (!res.ok) {
        const err = await res.text();
        return jsonError(`Error al insertar items: ${err}`, 500, request);
      }
    }

    return new Response(JSON.stringify({ id }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  } catch (e) {
    return jsonError(e.message || 'Error interno', 500, request);
  }
}

// ── Reciclar cotización (supervisor: crea borrador desde rechazada/anulada/vencida) ──
async function handleReciclarCotizacion(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Solo supervisores
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores pueden reciclar cotizaciones', 403, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { cotizacionId, vendedorDestinoId } = body;
  if (!cotizacionId || !vendedorDestinoId) return jsonError('Faltan campos: cotizacionId, vendedorDestinoId', 400, request);
  if (!isValidUuid(cotizacionId) || !isValidUuid(vendedorDestinoId)) return jsonError('IDs inválidos', 400, request);

  const supaHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  try {
    // 1. Obtener cotización original
    const cotRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`,
      { headers: supaHeaders }
    );
    const [cotOrig] = await cotRes.json();
    if (!cotOrig) return jsonError('Cotización no encontrada', 404, request);

    // 2. Validar estado
    if (!['rechazada', 'anulada', 'vencida'].includes(cotOrig.estado)) {
      return jsonError('Solo se pueden reciclar cotizaciones rechazadas, anuladas o vencidas', 400, request);
    }

    // 3. Fetch vendedor destino, vendedor original, and supervisor data in parallel
    const [vendRes, vendOrigRes, supRes] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${vendedorDestinoId}&activo=eq.true&select=id,nombre,rol`, { headers: supaHeaders }),
      fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${cotOrig.vendedor_id}&select=nombre`, { headers: supaHeaders }),
      fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${user.operator_id}&select=nombre,rol`, { headers: supaHeaders }),
    ]);

    const [vendDest] = await vendRes.json();
    if (!vendDest) return jsonError('Vendedor destino no existe o está inactivo', 400, request);

    const [vendOrig] = await vendOrigRes.json();
    const [supData] = await supRes.json();

    // 4. Registrar auditoría ANTES de la mutación
    const numOrigPad = String(cotOrig.numero).padStart(5, '0');

    // 5. Crear nueva cotización borrador
    const nuevaRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id,numero`, {
      method: 'POST',
      headers: { ...supaHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        version: 1,
        cliente_id: cotOrig.cliente_id,
        vendedor_id: vendedorDestinoId,
        transportista_id: cotOrig.transportista_id,
        estado: 'borrador',
        subtotal_usd: cotOrig.subtotal_usd,
        descuento_global_pct: cotOrig.descuento_global_pct,
        descuento_usd: cotOrig.descuento_usd,
        costo_envio_usd: cotOrig.costo_envio_usd,
        total_usd: cotOrig.total_usd,
        notas_cliente: cotOrig.notas_cliente,
        notas_internas: cotOrig.notas_internas,
      }),
    });
    if (!nuevaRes.ok) {
      const err = await nuevaRes.text();
      return jsonError(`Error al crear cotización: ${err}`, 500, request);
    }
    const [nueva] = await nuevaRes.json();

    // 6. Copiar items
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${cotizacionId}&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden`,
      { headers: supaHeaders }
    );
    const items = await itemsRes.json();

    if (items.length > 0) {
      const nuevosItems = items.map(it => ({ ...it, cotizacion_id: nueva.id }));
      const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST',
        headers: supaHeaders,
        body: JSON.stringify(nuevosItems),
      });
      if (!insRes.ok) {
        const err = await insRes.text();
        return jsonError(`Error al copiar items: ${err}`, 500, request);
      }
    }

    // 7. Registrar auditoría (after mutation since we need nueva.numero, but log even if push fails)
    const numNuevoPad = String(nueva.numero).padStart(5, '0');
    const auditRes = await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({
        usuario_id: user.operator_id,
        usuario_nombre: supData?.nombre || 'Supervisor',
        usuario_rol: supData?.rol || 'supervisor',
        categoria: 'COTIZACION',
        accion: 'RECICLAR_COTIZACION',
        descripcion: `Cotización COT-${numOrigPad} reciclada → COT-${numNuevoPad}. Vendedor: ${vendOrig?.nombre || '—'} → ${vendDest.nombre}`,
        entidad_tipo: 'cotizacion',
        entidad_id: nueva.id,
        meta: {
          cotizacion_original_id: cotizacionId,
          cotizacion_original_numero: cotOrig.numero,
          estado_original: cotOrig.estado,
          vendedor_origen_id: cotOrig.vendedor_id,
          vendedor_origen_nombre: vendOrig?.nombre || '—',
          vendedor_destino_id: vendedorDestinoId,
          vendedor_destino_nombre: vendDest.nombre,
          total_usd: cotOrig.total_usd,
          nuevo_numero: nueva.numero,
        },
      }),
    });

    if (!auditRes.ok) {
      console.error('Auditoría falló para reciclar cotización:', await auditRes.text().catch(() => ''));
    }

    return new Response(JSON.stringify({
      id: nueva.id,
      numero: nueva.numero,
      vendedorDestino: vendDest.nombre,
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  } catch (e) {
    return jsonError(e.message || 'Error interno al reciclar', 500, request);
  }
}

// ── Crear versión de cotización enviada/rechazada (bypass RLS) ──────────────
async function handleCrearVersion(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  if (!user.operator_id) return jsonError('No hay operador seleccionado', 400, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { cotizacionId, notasCambio } = body;
  if (!cotizacionId) return jsonError('Falta cotizacionId', 400, request);
  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);

  const supaHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  try {
    // 1. Obtener operador
    const opRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${user.operator_id}&activo=eq.true&select=id,nombre,rol`,
      { headers: supaHeaders }
    );
    const [operador] = await opRes.json();
    if (!operador) return jsonError('Operador no encontrado o inactivo', 400, request);

    // 2. Obtener cotización original
    const cotRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`,
      { headers: supaHeaders }
    );
    const [cotOrig] = await cotRes.json();
    if (!cotOrig) return jsonError('Cotización no encontrada', 404, request);

    // 3. Validar estado
    if (!['enviada', 'rechazada'].includes(cotOrig.estado)) {
      return jsonError('Solo se pueden versionar cotizaciones enviadas o rechazadas', 400, request);
    }

    // 4. Validar acceso
    if (cotOrig.vendedor_id !== user.operator_id && operador.rol !== 'supervisor') {
      return jsonError('No tienes permiso para versionar esta cotización', 403, request);
    }

    // 5. Calcular raíz y nueva versión
    const raizId = cotOrig.cotizacion_raiz_id || cotOrig.id;
    const verRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?or=(cotizacion_raiz_id.eq.${raizId},id.eq.${raizId})&select=version`,
      { headers: supaHeaders }
    );
    const versiones = await verRes.json();
    const nuevaVersion = Math.max(...versiones.map(v => v.version || 0)) + 1;

    // 6. Crear nueva cotización borrador
    const nuevaRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id,numero`, {
      method: 'POST',
      headers: { ...supaHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        version: nuevaVersion,
        cotizacion_raiz_id: raizId,
        cliente_id: cotOrig.cliente_id,
        vendedor_id: cotOrig.vendedor_id,
        transportista_id: cotOrig.transportista_id,
        estado: 'borrador',
        valida_hasta: cotOrig.valida_hasta,
        notas_cliente: cotOrig.notas_cliente,
        notas_internas: notasCambio || cotOrig.notas_internas,
      }),
    });
    if (!nuevaRes.ok) {
      const err = await nuevaRes.text();
      return jsonError(`Error al crear versión: ${err}`, 500, request);
    }
    const [nueva] = await nuevaRes.json();

    // 7. Copiar items
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${cotizacionId}&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden`,
      { headers: supaHeaders }
    );
    const items = await itemsRes.json();

    if (items.length > 0) {
      const nuevosItems = items.map(it => ({ ...it, cotizacion_id: nueva.id }));
      const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST',
        headers: supaHeaders,
        body: JSON.stringify(nuevosItems),
      });
      if (!insRes.ok) {
        const err = await insRes.text();
        return jsonError(`Error al copiar items: ${err}`, 500, request);
      }
    }

    // 8. Copiar totales
    await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${nueva.id}`, {
      method: 'PATCH',
      headers: { ...supaHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        subtotal_usd: cotOrig.subtotal_usd,
        descuento_global_pct: cotOrig.descuento_global_pct,
        descuento_usd: cotOrig.descuento_usd,
        costo_envio_usd: cotOrig.costo_envio_usd,
        total_usd: cotOrig.total_usd,
      }),
    });

    // 9. Anular la cotización original
    await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
      method: 'PATCH',
      headers: { ...supaHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'anulada', actualizado_en: new Date().toISOString() }),
    });

    // 10. Auditoría
    const numOrigPad = String(cotOrig.numero).padStart(5, '0');
    const numNuevoPad = String(nueva.numero).padStart(5, '0');
    await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({
        usuario_id: user.operator_id,
        usuario_nombre: operador.nombre,
        usuario_rol: operador.rol,
        categoria: 'COTIZACION',
        accion: 'CREAR_VERSION',
        descripcion: `Versión ${nuevaVersion} creada de COT-${numOrigPad} → COT-${numNuevoPad}`,
        entidad_tipo: 'cotizacion',
        entidad_id: nueva.id,
        meta: {
          cotizacion_origen: cotizacionId,
          nueva_version: nuevaVersion,
        },
      }),
    });

    return json({ id: nueva.id, numero: nueva.numero, version: nuevaVersion }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error interno al crear versión', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS para endpoints migrados de RPC
// ══════════════════════════════════════════════════════════════════════════════

// Obtiene headers Supabase con service key
function supaServiceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

// Valida auth + operator_id, devuelve { user, operador } o Response de error
async function validateOperator(request, env, { requireSupervisor = false } = {}) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return { error: jsonError('No autenticado', 401, request) };
  if (!user.operator_id) return { error: jsonError('No hay operador seleccionado', 400, request) };

  const h = supaServiceHeaders(env);
  const rolFilter = requireSupervisor ? '&rol=eq.supervisor' : '';
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${user.operator_id}&activo=eq.true${rolFilter}&select=id,nombre,rol,color`,
    { headers: h }
  );
  const [operador] = await res.json();
  if (!operador) {
    const msg = requireSupervisor
      ? 'Solo supervisores pueden realizar esta acción'
      : 'Operador no encontrado o inactivo';
    return { error: jsonError(msg, 403, request) };
  }

  return { user, operador, headers: h };
}

// Registra auditoría via REST
async function registrarAuditoria(env, headers, { usuarioId, usuarioNombre, usuarioRol, categoria, accion, descripcion, entidadTipo, entidadId, meta }) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre,
      usuario_rol: usuarioRol,
      categoria: categoria,
      accion: accion,
      descripcion: descripcion || null,
      entidad_tipo: entidadTipo,
      entidad_id: entidadId,
      meta: meta || null,
    }),
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. ENVIAR COTIZACIÓN
// ══════════════════════════════════════════════════════════════════════════════
async function handleEnviarCotizacion(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { cotizacionId, tasaBcv } = body;
  if (!cotizacionId || !tasaBcv) return jsonError('Faltan campos: cotizacionId, tasaBcv', 400, request);
  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);

  try {
    // 1. Obtener cotización
    const cotRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`, { headers });
    const [cot] = await cotRes.json();
    if (!cot) return jsonError('Cotización no encontrada', 404, request);

    // 2. Validar acceso
    if (cot.vendedor_id !== user.operator_id && operador.rol !== 'supervisor') {
      return jsonError('No tienes permiso para enviar esta cotización', 403, request);
    }

    // 3. Validar estado
    if (cot.estado !== 'borrador') return jsonError('Solo se pueden enviar cotizaciones en borrador', 400, request);

    // 4. Validar que tenga items
    const itemsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${cotizacionId}&select=id&limit=1`, { headers });
    const items = await itemsRes.json();
    if (!items || items.length === 0) return jsonError('La cotización no tiene productos', 400, request);

    // 5. Actualizar estado
    const tasa = Number(tasaBcv);
    const totalBs = Number(cot.total_usd) * tasa;
    await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        estado: 'enviada',
        enviada_en: new Date().toISOString(),
        tasa_bcv_snapshot: tasa,
        total_bs_snapshot: totalBs,
        actualizado_en: new Date().toISOString(),
      }),
    });

    // 6. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'ENVIAR_COTIZACION',
      entidadTipo: 'cotizacion', entidadId: cotizacionId,
      meta: { tasa_bcv: tasa },
    });

    return json({ ok: true }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al enviar cotización', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. CREAR NOTA DE DESPACHO (+ cargo CxC + comisión)
// ══════════════════════════════════════════════════════════════════════════════
async function handleCrearDespacho(request, env) {
  const v = await validateOperator(request, env, { requireSupervisor: true });
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { cotizacionId, notas, formaPago } = body;
  if (!cotizacionId) return jsonError('Falta cotizacionId', 400, request);
  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);

  try {
    // 1. Obtener cotización
    const cotRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`, { headers });
    const [cot] = await cotRes.json();
    if (!cot) return jsonError('Cotización no encontrada', 404, request);

    if (!['enviada', 'aceptada'].includes(cot.estado)) {
      return jsonError('La cotización debe estar enviada o aceptada para despachar', 400, request);
    }

    // 2. Verificar que no exista despacho
    const existRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?cotizacion_id=eq.${cotizacionId}&select=id&limit=1`, { headers });
    const existing = await existRes.json();
    if (existing && existing.length > 0) {
      return jsonError('Ya existe una nota de despacho para esta cotización', 400, request);
    }

    // 3. Si está enviada, aceptarla
    if (cot.estado === 'enviada') {
      await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'aceptada' }),
      });
    }

    // 4. Obtener items con producto
    const ciRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${cotizacionId}&producto_id=not.is.null&select=producto_id,cantidad,nombre_snap`,
      { headers }
    );
    const cotItems = await ciRes.json();

    // 5. Verificar stock
    if (cotItems.length > 0) {
      const prodIds = cotItems.map(i => i.producto_id);
      const prodRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/productos?id=in.(${prodIds.join(',')})&activo=eq.true&select=id,stock_actual,nombre`,
        { headers }
      );
      const productos = await prodRes.json();
      const stockMap = Object.fromEntries(productos.map(p => [p.id, p]));

      for (const item of cotItems) {
        const prod = stockMap[item.producto_id];
        if (!prod) return jsonError(`Producto "${item.nombre_snap}" no encontrado o inactivo`, 400, request);
        if (Number(prod.stock_actual) < Number(item.cantidad)) {
          return jsonError(`Stock insuficiente: "${item.nombre_snap}" requiere ${item.cantidad} pero solo hay ${prod.stock_actual}`, 400, request);
        }
      }

      // 6. Descontar stock y registrar kardex
      const loteId = crypto.randomUUID();
      const movimientos = [];
      for (const item of cotItems) {
        const prod = stockMap[item.producto_id];
        const stockAnterior = Number(prod.stock_actual);
        const nuevoStock = stockAnterior - Number(item.cantidad);
        await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
          method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ stock_actual: nuevoStock }),
        });
        movimientos.push({
          lote_id: loteId,
          tipo: 'egreso',
          motivo: `Nota de despacho #${cot.numero}`,
          motivo_tipo: 'venta',
          producto_id: item.producto_id,
          producto_nombre: item.nombre_snap || prod.nombre,
          cantidad: Number(item.cantidad),
          stock_anterior: stockAnterior,
          stock_nuevo: nuevoStock,
          usuario_id: user.operator_id,
          usuario_nombre: operador.nombre,
          usuario_color: operador.color || null,
        });
      }

      // Insertar movimientos de kardex
      if (movimientos.length > 0) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
          method: 'POST', headers,
          body: JSON.stringify(movimientos),
        });
      }
    }

    // 7. Crear nota de despacho
    const despRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?select=id,numero`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation', 'X-Skip-Trigger': 'numero' },
      body: JSON.stringify({
        numero: cot.numero,
        cotizacion_id: cotizacionId,
        cliente_id: cot.cliente_id,
        vendedor_id: cot.vendedor_id,
        transportista_id: cot.transportista_id,
        estado: 'pendiente',
        total_usd: cot.total_usd,
        notas: notas || null,
        forma_pago: formaPago || null,
        creado_por: user.operator_id,
      }),
    });

    if (!despRes.ok) {
      const err = await despRes.text();
      return jsonError(`Error al crear despacho: ${err}`, 500, request);
    }
    const [despacho] = await despRes.json();

    // 8. Si es Cta por cobrar, registrar cargo CxC
    if (formaPago === 'Cta por cobrar' && despacho) {
      const saldoRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${cot.cliente_id}&select=saldo_pendiente`,
        { headers }
      );
      const [clienteSaldo] = await saldoRes.json();
      const saldoActual = Number(clienteSaldo?.saldo_pendiente || 0);
      const nuevoSaldo = saldoActual + Number(cot.total_usd);

      await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
        method: 'POST', headers,
        body: JSON.stringify({
          cliente_id: cot.cliente_id,
          despacho_id: despacho.id,
          tipo: 'cargo',
          monto_usd: cot.total_usd,
          saldo_usd: nuevoSaldo,
          descripcion: `Orden de despacho #${cot.numero}`,
          registrado_por: user.operator_id,
        }),
      });

      await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${cot.cliente_id}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ saldo_pendiente: nuevoSaldo }),
      });
    }

    // 9. Calcular comisión (usar RPC con service key — esta función no usa get_operador_id)
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calcular_comision_despacho`, {
        method: 'POST', headers,
        body: JSON.stringify({ p_despacho_id: despacho.id }),
      });
    } catch { /* comisión no es crítica */ }

    // 10. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'CREAR_DESPACHO',
      entidadTipo: 'nota_despacho', entidadId: despacho.id,
      meta: { cotizacion_id: cotizacionId, total_usd: cot.total_usd },
    });

    return json({ id: despacho.id, numero: despacho.numero }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al crear despacho', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. ACTUALIZAR ESTADO DESPACHO
// ══════════════════════════════════════════════════════════════════════════════
async function handleActualizarEstadoDespacho(request, env) {
  const v = await validateOperator(request, env, { requireSupervisor: true });
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { despachoId, nuevoEstado } = body;
  if (!despachoId || !nuevoEstado) return jsonError('Faltan campos', 400, request);
  if (!isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);

  try {
    // 1. Obtener despacho
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=*`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);

    // 2. Validar transición
    const valid = (desp.estado === 'pendiente' && ['despachada', 'anulada'].includes(nuevoEstado))
      || (desp.estado === 'despachada' && ['entregada', 'anulada'].includes(nuevoEstado));
    if (!valid) {
      return jsonError(`No se puede pasar de "${desp.estado}" a "${nuevoEstado}"`, 400, request);
    }

    // 3. Si se anula, devolver stock y registrar kardex
    if (nuevoEstado === 'anulada') {
      const ciRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${desp.cotizacion_id}&producto_id=not.is.null&select=producto_id,cantidad,nombre_snap`,
        { headers }
      );
      const items = await ciRes.json();
      const loteId = crypto.randomUUID();
      const movimientos = [];
      for (const item of items) {
        const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}&select=stock_actual,nombre`, { headers });
        const [prod] = await pRes.json();
        if (prod) {
          const stockAnterior = Number(prod.stock_actual);
          const nuevoStock = stockAnterior + Number(item.cantidad);
          await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
            method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ stock_actual: nuevoStock }),
          });
          movimientos.push({
            lote_id: loteId,
            tipo: 'ingreso',
            motivo: `Anulación de despacho #${desp.numero}`,
            motivo_tipo: 'venta',
            producto_id: item.producto_id,
            producto_nombre: item.nombre_snap || prod.nombre,
            cantidad: Number(item.cantidad),
            stock_anterior: stockAnterior,
            stock_nuevo: nuevoStock,
            usuario_id: user.operator_id,
            usuario_nombre: operador.nombre,
            usuario_color: operador.color || null,
          });
        }
      }
      if (movimientos.length > 0) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
          method: 'POST', headers,
          body: JSON.stringify(movimientos),
        });
      }
    }

    // 4. Actualizar estado
    const updateData = { estado: nuevoEstado };
    if (nuevoEstado === 'despachada') updateData.despachada_en = new Date().toISOString();
    if (nuevoEstado === 'entregada') updateData.entregada_en = new Date().toISOString();

    await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(updateData),
    });

    // 5. Si entregada, calcular comisión
    if (nuevoEstado === 'entregada') {
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calcular_comision_despacho`, {
          method: 'POST', headers,
          body: JSON.stringify({ p_despacho_id: despachoId }),
        });
      } catch { /* no crítico */ }
    }

    // 6. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'ACTUALIZAR_DESPACHO',
      entidadTipo: 'nota_despacho', entidadId: despachoId,
      meta: { estado_anterior: desp.estado, estado_nuevo: nuevoEstado, cotizacion_id: desp.cotizacion_id },
    });

    return json({ ok: true, nuevoEstado }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al actualizar despacho', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. RECICLAR DESPACHO ANULADO → COTIZACIÓN BORRADOR
// ══════════════════════════════════════════════════════════════════════════════
async function handleReciclarDespacho(request, env) {
  const v = await validateOperator(request, env, { requireSupervisor: true });
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { despachoId } = body;
  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);

  try {
    // 1. Obtener despacho
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=*`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);
    if (desp.estado !== 'anulada') return jsonError('Solo se pueden reciclar despachos anulados', 400, request);

    // 2. Obtener cotización original
    const cotRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${desp.cotizacion_id}&select=*`, { headers });
    const [cotOrig] = await cotRes.json();
    if (!cotOrig) return jsonError('Cotización original no encontrada', 404, request);

    // 3. Crear nueva cotización borrador
    const nuevaRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id,numero`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        version: 1,
        cliente_id: cotOrig.cliente_id,
        vendedor_id: cotOrig.vendedor_id,
        transportista_id: cotOrig.transportista_id,
        estado: 'borrador',
        subtotal_usd: cotOrig.subtotal_usd,
        descuento_global_pct: cotOrig.descuento_global_pct,
        descuento_usd: cotOrig.descuento_usd,
        costo_envio_usd: cotOrig.costo_envio_usd,
        total_usd: cotOrig.total_usd,
        notas_cliente: cotOrig.notas_cliente,
        notas_internas: cotOrig.notas_internas,
      }),
    });
    if (!nuevaRes.ok) return jsonError('Error al crear cotización', 500, request);
    const [nueva] = await nuevaRes.json();

    // 4. Copiar items
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${desp.cotizacion_id}&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden`,
      { headers }
    );
    const items = await itemsRes.json();
    if (items.length > 0) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST', headers,
        body: JSON.stringify(items.map(it => ({ ...it, cotizacion_id: nueva.id }))),
      });
    }

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'RECICLAR_DESPACHO',
      entidadTipo: 'cotizacion', entidadId: nueva.id,
      meta: { despacho_id: despachoId, cotizacion_original_id: desp.cotizacion_id, total_usd: cotOrig.total_usd },
    });

    return json({ id: nueva.id, numero: nueva.numero }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al reciclar despacho', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. REASIGNAR CLIENTE
// ══════════════════════════════════════════════════════════════════════════════
async function handleReasignarCliente(request, env) {
  const v = await validateOperator(request, env, { requireSupervisor: true });
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { clienteId, nuevoVendedorId, motivo } = body;
  if (!clienteId || !nuevoVendedorId) return jsonError('Faltan campos', 400, request);
  if (!isValidUuid(clienteId) || !isValidUuid(nuevoVendedorId)) return jsonError('IDs inválidos', 400, request);
  if (!motivo || motivo.trim().length < 10) return jsonError('El motivo debe tener al menos 10 caracteres', 400, request);

  try {
    // 1. Obtener cliente
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&activo=eq.true&select=id,nombre,vendedor_id`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado o inactivo', 404, request);
    if (cliente.vendedor_id === nuevoVendedorId) return jsonError('El cliente ya pertenece a ese vendedor', 400, request);

    // 2. Validar vendedor destino
    const vRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${nuevoVendedorId}&activo=eq.true&select=id`, { headers });
    const [vendDest] = await vRes.json();
    if (!vendDest) return jsonError('Vendedor destino no encontrado o inactivo', 400, request);

    // 3. Actualizar cliente
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        vendedor_id: nuevoVendedorId,
        ultima_reasig_por: user.operator_id,
        ultima_reasig_motivo: motivo,
        ultima_reasig_en: new Date().toISOString(),
        actualizado_en: new Date().toISOString(),
      }),
    });

    // 4. Insertar registro de reasignación
    await fetch(`${env.SUPABASE_URL}/rest/v1/reasignaciones_clientes`, {
      method: 'POST', headers,
      body: JSON.stringify({
        cliente_id: clienteId,
        vendedor_origen: cliente.vendedor_id,
        vendedor_destino: nuevoVendedorId,
        supervisor_id: user.operator_id,
        motivo,
      }),
    });

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'REASIGNACION', accion: 'REASIGNAR_CLIENTE',
      descripcion: `Cliente "${cliente.nombre}" reasignado. Motivo: ${motivo}`,
      entidadTipo: 'cliente', entidadId: clienteId,
      meta: { vendedor_origen: cliente.vendedor_id, vendedor_destino: nuevoVendedorId, motivo },
    });

    return json({ ok: true }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al reasignar cliente', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. REGISTRAR ABONO CxC
// ══════════════════════════════════════════════════════════════════════════════
async function handleRegistrarAbono(request, env) {
  const v = await validateOperator(request, env, { requireSupervisor: true });
  if (v.error) return v.error;
  const { user, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { clienteId, monto, formaPago, referencia, descripcion } = body;
  if (!clienteId || !monto) return jsonError('Faltan campos', 400, request);
  if (!isValidUuid(clienteId)) return jsonError('clienteId inválido', 400, request);
  if (Number(monto) <= 0) return jsonError('El monto debe ser mayor a cero', 400, request);

  try {
    // 1. Obtener saldo actual
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&activo=eq.true&select=saldo_pendiente`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado o inactivo', 404, request);

    const saldoActual = Number(cliente.saldo_pendiente || 0);
    if (saldoActual <= 0) return jsonError('El cliente no tiene saldo pendiente', 400, request);

    const nuevoSaldo = Math.max(0, saldoActual - Number(monto));

    // 2. Insertar abono
    const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?select=id`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cliente_id: clienteId,
        tipo: 'abono',
        monto_usd: monto,
        saldo_usd: nuevoSaldo,
        forma_pago_abono: formaPago || null,
        referencia: referencia ? referencia.trim() || null : null,
        descripcion: descripcion?.trim() || 'Abono recibido',
        registrado_por: user.operator_id,
      }),
    });
    if (!insRes.ok) return jsonError('Error al registrar abono', 500, request);
    const [abono] = await insRes.json();

    // 3. Actualizar saldo en cliente
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ saldo_pendiente: nuevoSaldo }),
    });

    return json({ id: abono.id, nuevoSaldo }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al registrar abono', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. MARCAR COMISIÓN PAGADA
// ══════════════════════════════════════════════════════════════════════════════
async function handleMarcarComisionPagada(request, env) {
  const v = await validateOperator(request, env, { requireSupervisor: true });
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { comisionId } = body;
  if (!comisionId || !isValidUuid(comisionId)) return jsonError('comisionId inválido', 400, request);

  try {
    // 1. Obtener comisión
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionId}&select=*`, { headers });
    const [comision] = await cRes.json();
    if (!comision) return jsonError('Comisión no encontrada', 404, request);
    if (comision.estado === 'pagada') return jsonError('Esta comisión ya fue marcada como pagada', 400, request);

    // 2. Actualizar
    await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionId}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        estado: 'pagada',
        pagada_en: new Date().toISOString(),
        pagada_por: user.operator_id,
        actualizado_en: new Date().toISOString(),
      }),
    });

    // 3. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'PAGAR_COMISION',
      entidadTipo: 'comision', entidadId: comisionId,
      meta: { vendedor_id: comision.vendedor_id, total_comision: comision.total_comision, despacho_id: comision.despacho_id },
    });

    return json({ ok: true }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al marcar comisión', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. APLICAR MOVIMIENTO DE INVENTARIO POR LOTES
// ══════════════════════════════════════════════════════════════════════════════
async function handleAplicarMovimientoLote(request, env) {
  const v = await validateOperator(request, env, { requireSupervisor: true });
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { tipo, motivo, motivo_tipo = 'otro', items } = body;
  if (!tipo || !motivo || !items || !Array.isArray(items) || items.length === 0) {
    return jsonError('Faltan campos: tipo, motivo, items', 400, request);
  }
  if (!['ingreso', 'egreso'].includes(tipo)) return jsonError('tipo debe ser ingreso o egreso', 400, request);
  if (!motivo.trim()) return jsonError('El motivo es obligatorio', 400, request);

  try {
    const loteId = crypto.randomUUID();
    const movimientos = [];

    for (const item of items) {
      const cantidad = Number(item.cantidad);
      if (cantidad <= 0) return jsonError('La cantidad debe ser mayor a 0', 400, request);

      // Obtener producto
      const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}&activo=eq.true&select=id,nombre,stock_actual`, { headers });
      const [prod] = await pRes.json();
      if (!prod) return jsonError('Producto no encontrado o inactivo', 400, request);

      let nuevoStock;
      if (tipo === 'egreso') {
        nuevoStock = Number(prod.stock_actual) - cantidad;
        if (nuevoStock < 0) {
          return jsonError(`Stock insuficiente para "${prod.nombre}": tiene ${prod.stock_actual} y se intenta retirar ${cantidad}`, 400, request);
        }
      } else {
        nuevoStock = Number(prod.stock_actual) + cantidad;
      }

      // Actualizar stock
      await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ stock_actual: nuevoStock, actualizado_en: new Date().toISOString() }),
      });

      movimientos.push({
        lote_id: loteId,
        tipo,
        motivo: motivo.trim(),
        motivo_tipo,
        producto_id: item.producto_id,
        producto_nombre: prod.nombre,
        cantidad,
        stock_anterior: Number(prod.stock_actual),
        stock_nuevo: nuevoStock,
        usuario_id: user.operator_id,
        usuario_nombre: operador.nombre,
      });
    }

    // Insertar todos los movimientos
    const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos?select=numero`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(movimientos),
    });
    const movResults = await insRes.json();
    const numero = movResults?.[0]?.numero || null;

    return json({ lote_id: loteId, numero }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al aplicar movimiento', 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTER — Seed demo + Stress seed endpoints
// ══════════════════════════════════════════════════════════════════════════════

// ── Helper: Supabase batch insert con service key ───────────────────────────
async function supaBatch(env, table, rows, chunkSize = 500, logFn = null) {
  // Normalizar: PostgREST requiere que todos los objetos tengan las mismas claves
  const allKeys = new Set();
  for (const row of rows) for (const k of Object.keys(row)) allKeys.add(k);
  const normalized = rows.map(row => {
    const obj = {};
    for (const k of allKeys) obj[k] = row[k] !== undefined ? row[k] : null;
    return obj;
  });

  const totalChunks = Math.ceil(normalized.length / chunkSize);
  if (logFn) logFn(`  INSERT ${table}: ${rows.length} filas, ${allKeys.size} columnas, ${totalChunks} chunk(s) de ${chunkSize}`);

  const all = [];
  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunkIdx = Math.floor(i / chunkSize) + 1;
    const chunk = normalized.slice(i, i + chunkSize);
    const t0 = Date.now();
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(chunk),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const errMsg = `POST ${table} chunk ${chunkIdx}/${totalChunks} (${chunk.length} filas): HTTP ${res.status} ${res.statusText} — ${errBody}`;
      if (logFn) logFn(`  ✗ ${errMsg}`);
      throw new Error(errMsg);
    }
    const data = await res.json();
    all.push(...data);
    if (logFn) logFn(`  ✓ ${table} chunk ${chunkIdx}/${totalChunks}: ${data.length} filas insertadas (${elapsed}ms, HTTP ${res.status})`);
  }
  return all;
}

async function supaDelete(env, table, logFn = null) {
  const t0 = Date.now();
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
  });
  const elapsed = Date.now() - t0;
  if (logFn) logFn(`  DELETE ${table}: HTTP ${res.status} (${elapsed}ms)`);
}

async function supaQuery(env, table, params = '') {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`GET ${table} failed: ${res.status}`);
  return res.json();
}

// ── Limpiar todos los datos (excepto usuarios y config) ─────────────────────
async function handleTesterClearAll(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores', 403, request);

  const start = Date.now();
  const log = [];
  function logStep(msg) { log.push({ ts: Date.now() - start, msg }) }

  logStep('=== CLEAR ALL — Inicio ===');
  logStep(`Usuario: ${user.id}`);
  logStep(`Supabase URL: ${env.SUPABASE_URL}`);

  try {
    // Orden por dependencias FK: primero las tablas hijas
    logStep('Eliminando cuentas_por_cobrar...');
    await supaDelete(env, 'cuentas_por_cobrar', logStep);
    logStep('Eliminando comisiones...');
    await supaDelete(env, 'comisiones', logStep);
    logStep('Eliminando notas_despacho...');
    await supaDelete(env, 'notas_despacho', logStep);
    logStep('Eliminando cotizacion_items...');
    await supaDelete(env, 'cotizacion_items', logStep);
    logStep('Eliminando cotizaciones...');
    await supaDelete(env, 'cotizaciones', logStep);
    logStep('Eliminando clientes...');
    await supaDelete(env, 'clientes', logStep);
    logStep('Eliminando transportistas...');
    await supaDelete(env, 'transportistas', logStep);
    logStep('Eliminando inventario_movimientos (kardex)...');
    await supaDelete(env, 'inventario_movimientos', logStep);
    logStep('Eliminando reasignaciones...');
    await supaDelete(env, 'reasignaciones', logStep);
    logStep('Eliminando auditoria...');
    await supaDelete(env, 'auditoria', logStep);
    logStep('Eliminando system_logs...');
    await supaDelete(env, 'system_logs', logStep);
    logStep('Inventario, usuarios y configuración conservados.');

    // Reiniciar correlativos (COT-00001, despacho #1)
    logStep('Reiniciando correlativos...');
    const seqRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/reiniciar_correlativos`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    logStep(`  Correlativos: HTTP ${seqRes.status}`);

    const elapsed = Date.now() - start;
    logStep(`✓ Limpieza completada en ${elapsed}ms`);
    return json({ ok: true, elapsed_ms: elapsed, log }, 200, request);
  } catch (e) {
    logStep(`✗ ERROR: ${e.message}`);
    return json({ ok: false, error: e.message, log }, 500, request);
  }
}

// ── Seed Demo (datos deterministas de ferretería) ───────────────────────────
// ── Guardar configuración del negocio (bypass RLS) ─────────────────────────
async function handleSaveConfig(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores', 403, request);

  const campos = await request.json();
  // Upsert con service_role key (bypass RLS)
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: 1, ...campos }),
  });
  if (!res.ok) {
    const text = await res.text();
    return jsonError(text || `Error ${res.status}`, res.status, request);
  }
  return json({ ok: true }, 200, request);
}

async function handleTesterSeedDemo(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores', 403, request);

  const start = Date.now();
  const log = [];
  function logStep(msg) { log.push({ ts: Date.now() - start, msg }) }

  try {
    logStep('=== SEED DEMO — Inicio ===');
    logStep(`Usuario autenticado: ${user.id}`);
    logStep(`Supabase URL: ${env.SUPABASE_URL}`);
    logStep(`Fecha/hora: ${new Date().toISOString()}`);

    // Limpiar
    logStep('--- Fase 1: Limpieza de tablas ---');
    await supaDelete(env, 'comisiones', logStep);
    await supaDelete(env, 'notas_despacho', logStep);
    await supaDelete(env, 'cotizacion_items', logStep);
    await supaDelete(env, 'cotizaciones', logStep);
    await supaDelete(env, 'clientes', logStep);
    await supaDelete(env, 'transportistas', logStep);
    await supaDelete(env, 'productos', logStep);
    logStep('✓ Limpieza completada');

    // Usuarios
    logStep('--- Fase 2: Consultar usuarios activos ---');
    const t0Users = Date.now();
    const usuarios = await supaQuery(env, 'usuarios', '?select=id,nombre,rol&activo=eq.true');
    logStep(`  GET usuarios: ${usuarios.length} encontrados (${Date.now() - t0Users}ms)`);
    for (const u of usuarios) logStep(`    → ${u.rol}: ${u.nombre} (${u.id.substring(0, 8)}...)`);
    const supervisor = usuarios.find(u => u.rol === 'supervisor');
    const vendedor = usuarios.find(u => u.rol === 'vendedor');
    if (!supervisor) {
      logStep('✗ ERROR: No hay supervisor activo en la tabla usuarios');
      return json({ ok: false, error: 'No hay supervisor activo', log }, 400, request);
    }
    const vendedorId = vendedor?.id ?? supervisor.id;
    logStep(`  Supervisor: ${supervisor.nombre} | Vendedor: ${vendedor?.nombre ?? 'N/A (usando supervisor)'}`);

    // Config
    logStep('--- Fase 3: Actualizar configuración de negocio ---');
    const t0Cfg = Date.now();
    const cfgRes = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?id=eq.1`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        nombre_negocio: 'Construacero Carabobo C.A.',
        rif_negocio: 'J-41256789-3',
        telefono_negocio: '0241-8675432',
        direccion_negocio: 'Av. Bolívar Norte, C.C. La Granja, Local 12, Valencia, Carabobo',
        email_negocio: 'ventas@construacero.com.ve',
        pie_pagina_pdf: 'Precios en USD. Sujetos a cambio sin previo aviso. Válidos según fecha indicada.',
        validez_cotizacion_dias: 7,
      }),
    });
    logStep(`  PATCH configuracion_negocio: HTTP ${cfgRes.status} (${Date.now() - t0Cfg}ms)`);

    // Productos
    logStep('--- Fase 4: Insertar productos (30) ---');
    const productos = [
      { codigo: 'CEM-001', nombre: 'Cemento Gris Tipo I 42.5kg',        categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 5.50,  costo_usd: 4.20,  stock_actual: 250,  stock_minimo: 50 },
      { codigo: 'CEM-002', nombre: 'Cemento Blanco 1kg',                 categoria: 'Cemento',      unidad: 'kg',    precio_usd: 2.80,  costo_usd: 2.10,  stock_actual: 80,   stock_minimo: 20 },
      { codigo: 'CEM-003', nombre: 'Mortero Premezclado 40kg',           categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 4.50,  costo_usd: 3.40,  stock_actual: 120,  stock_minimo: 30 },
      { codigo: 'CEM-004', nombre: 'Arena Lavada (saco 40kg)',           categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 2.00,  costo_usd: 1.30,  stock_actual: 180,  stock_minimo: 40 },
      { codigo: 'CEM-005', nombre: 'Piedra Picada Nro. 2 (saco 40kg)',  categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 2.50,  costo_usd: 1.60,  stock_actual: 150,  stock_minimo: 30 },
      { codigo: 'PIN-001', nombre: 'Pintura Caucho Int. Blanco Glaciar 4L', categoria: 'Pintura',   unidad: 'und',   precio_usd: 18.00, costo_usd: 13.50, stock_actual: 45,   stock_minimo: 10 },
      { codigo: 'PIN-002', nombre: 'Pintura Caucho Ext. Blanco Hueso 4L',   categoria: 'Pintura',   unidad: 'und',   precio_usd: 22.00, costo_usd: 16.80, stock_actual: 30,   stock_minimo: 8 },
      { codigo: 'PIN-003', nombre: 'Esmalte Brillante Rojo 1L',             categoria: 'Pintura',   unidad: 'und',   precio_usd: 8.50,  costo_usd: 6.20,  stock_actual: 25,   stock_minimo: 5 },
      { codigo: 'PIN-004', nombre: 'Impermeabilizante Acrílico 4L',         categoria: 'Pintura',   unidad: 'und',   precio_usd: 28.00, costo_usd: 21.00, stock_actual: 15,   stock_minimo: 5 },
      { codigo: 'PIN-005', nombre: 'Rodillo de Felpa 9" con Mango',         categoria: 'Pintura',   unidad: 'und',   precio_usd: 4.50,  costo_usd: 2.80,  stock_actual: 60,   stock_minimo: 15 },
      { codigo: 'HER-001', nombre: 'Martillo de Uña 16oz Mango Fibra',  categoria: 'Herramientas', unidad: 'und',   precio_usd: 12.00, costo_usd: 8.50,  stock_actual: 20,   stock_minimo: 5 },
      { codigo: 'HER-002', nombre: 'Taladro Percutor 1/2" 750W',        categoria: 'Herramientas', unidad: 'und',   precio_usd: 45.00, costo_usd: 32.00, stock_actual: 8,    stock_minimo: 3 },
      { codigo: 'HER-003', nombre: 'Juego Destornilladores 6 piezas',   categoria: 'Herramientas', unidad: 'und',   precio_usd: 9.00,  costo_usd: 5.80,  stock_actual: 15,   stock_minimo: 5 },
      { codigo: 'HER-004', nombre: 'Nivel de Burbuja 24"',              categoria: 'Herramientas', unidad: 'und',   precio_usd: 7.50,  costo_usd: 4.80,  stock_actual: 12,   stock_minimo: 3 },
      { codigo: 'HER-005', nombre: 'Cinta Métrica 5m Stanley',          categoria: 'Herramientas', unidad: 'und',   precio_usd: 5.00,  costo_usd: 3.20,  stock_actual: 35,   stock_minimo: 10 },
      { codigo: 'ELE-001', nombre: 'Cable THHN 12AWG Rojo (rollo 100m)',  categoria: 'Electricidad', unidad: 'rollo', precio_usd: 35.00, costo_usd: 26.00, stock_actual: 18,  stock_minimo: 5 },
      { codigo: 'ELE-002', nombre: 'Interruptor Sencillo 15A Blanco',     categoria: 'Electricidad', unidad: 'und',   precio_usd: 2.50,  costo_usd: 1.50,  stock_actual: 80,  stock_minimo: 20 },
      { codigo: 'ELE-003', nombre: 'Toma Corriente Doble 15A',            categoria: 'Electricidad', unidad: 'und',   precio_usd: 3.00,  costo_usd: 1.80,  stock_actual: 65,  stock_minimo: 15 },
      { codigo: 'ELE-004', nombre: 'Breaker 1x20A Riel DIN',              categoria: 'Electricidad', unidad: 'und',   precio_usd: 6.50,  costo_usd: 4.20,  stock_actual: 30,  stock_minimo: 8 },
      { codigo: 'ELE-005', nombre: 'Bombillo LED 12W Luz Blanca E27',     categoria: 'Electricidad', unidad: 'und',   precio_usd: 2.00,  costo_usd: 1.10,  stock_actual: 120, stock_minimo: 30 },
      { codigo: 'PLO-001', nombre: 'Tubo PVC 1/2" x 3m Presión',       categoria: 'Plomería',     unidad: 'und',   precio_usd: 3.50,  costo_usd: 2.30,  stock_actual: 60,   stock_minimo: 15 },
      { codigo: 'PLO-002', nombre: 'Tubo PVC 4" x 3m Drenaje',         categoria: 'Plomería',     unidad: 'und',   precio_usd: 8.00,  costo_usd: 5.80,  stock_actual: 25,   stock_minimo: 8 },
      { codigo: 'PLO-003', nombre: 'Codo PVC 1/2" x 90°',              categoria: 'Plomería',     unidad: 'und',   precio_usd: 0.40,  costo_usd: 0.20,  stock_actual: 200,  stock_minimo: 50 },
      { codigo: 'PLO-004', nombre: 'Llave de Paso 1/2" Bronce',        categoria: 'Plomería',     unidad: 'und',   precio_usd: 5.50,  costo_usd: 3.80,  stock_actual: 20,   stock_minimo: 5 },
      { codigo: 'PLO-005', nombre: 'Teflón Industrial 3/4" x 10m',     categoria: 'Plomería',     unidad: 'und',   precio_usd: 0.80,  costo_usd: 0.40,  stock_actual: 150,  stock_minimo: 40 },
      { codigo: 'FIJ-001', nombre: 'Tornillo Drywall 6x1" (caja 100)', categoria: 'Fijación',     unidad: 'caja',  precio_usd: 3.00,  costo_usd: 1.80,  stock_actual: 40,   stock_minimo: 10 },
      { codigo: 'FIJ-002', nombre: 'Clavo de Acero 2" (kg)',            categoria: 'Fijación',     unidad: 'kg',    precio_usd: 2.50,  costo_usd: 1.60,  stock_actual: 30,   stock_minimo: 10 },
      { codigo: 'FIJ-003', nombre: 'Ancla Expansiva 3/8" x 3"',        categoria: 'Fijación',     unidad: 'und',   precio_usd: 0.60,  costo_usd: 0.30,  stock_actual: 300,  stock_minimo: 50 },
      { codigo: 'FIJ-004', nombre: 'Silicón Transparente 280ml',        categoria: 'Fijación',     unidad: 'und',   precio_usd: 4.00,  costo_usd: 2.80,  stock_actual: 25,   stock_minimo: 8 },
      { codigo: 'FIJ-005', nombre: 'Pega Epóxica Bicomponente 50ml',    categoria: 'Fijación',     unidad: 'und',   precio_usd: 5.50,  costo_usd: 3.60,  stock_actual: 18,   stock_minimo: 5 },
    ];
    const prodsCreados = await supaBatch(env, 'productos', productos, 500, logStep);
    logStep(`✓ ${prodsCreados.length} productos creados`);

    // Transportistas
    logStep('--- Fase 5: Insertar transportistas (4) ---');
    const transportistas = [
      { nombre: 'TransVenCarga Express', rif: 'J-30456789-1', telefono: '0241-4561234', zona_cobertura: 'Valencia / Carabobo', tarifa_base: 8.00, notas: 'Entrega mismo día en Valencia', creado_por: supervisor.id },
      { nombre: 'MRW Encomiendas', rif: 'J-00359741-6', telefono: '0800-679-0000', zona_cobertura: 'Nacional', tarifa_base: 12.00, notas: 'Cobertura nacional, 2-3 días', creado_por: supervisor.id },
      { nombre: 'Zoom Envíos', rif: 'J-29871456-2', telefono: '0800-966-6000', zona_cobertura: 'Nacional', tarifa_base: 10.00, notas: 'Envíos puerta a puerta', creado_por: supervisor.id },
      { nombre: 'Fletes Rodríguez', rif: 'V-18456321', telefono: '0414-4123456', zona_cobertura: 'Carabobo / Aragua / Cojedes', tarifa_base: 15.00, notas: 'Camión 350 para materiales pesados', creado_por: supervisor.id },
    ];
    const transCreados = await supaBatch(env, 'transportistas', transportistas, 500, logStep);
    logStep(`✓ ${transCreados.length} transportistas creados`);

    // Clientes
    logStep('--- Fase 6: Insertar clientes (13) ---');
    const clientes = [
      { nombre: 'Ferretería Don Pedro', rif_cedula: 'J-41023456-7', telefono: '0241-8234567', email: 'donpedro@gmail.com', direccion: 'Av. Lara, C.C. Roma, Local 5, Valencia', tipo_cliente: 'ferreteria', vendedor_id: supervisor.id, notas: 'Cliente mayorista.' },
      { nombre: 'Constructora Bolívar 2020 C.A.', rif_cedula: 'J-50234567-8', telefono: '0241-8345678', email: 'compras@constructorabolivar.com', direccion: 'Zona Industrial Castillito, Galpón 15, San Diego', tipo_cliente: 'constructor', vendedor_id: supervisor.id, notas: 'Obras en curso.' },
      { nombre: 'Inversiones Martínez & Hijos', rif_cedula: 'J-40567890-1', telefono: '0414-4234567', email: 'martinez@hotmail.com', direccion: 'Urb. Prebo, Av. 98, Casa 12, Valencia', tipo_cliente: 'empresa', vendedor_id: supervisor.id, notas: 'Pago a 15 días.' },
      { nombre: 'Carlos Mendoza', rif_cedula: 'V-18456789', telefono: '0424-4567890', email: null, direccion: 'Sector San José, Naguanagua', tipo_cliente: 'particular', vendedor_id: supervisor.id, notas: 'Remodelación.' },
      { nombre: 'Ferretería La Esquina', rif_cedula: 'J-41234567-0', telefono: '0241-8567890', email: 'laesquina@gmail.com', direccion: 'Av. Cedeño, Nro. 78, Valencia', tipo_cliente: 'ferreteria', vendedor_id: supervisor.id, notas: 'Artículos eléctricos.' },
      { nombre: 'María González', rif_cedula: 'V-20345678', telefono: '0412-4678901', email: 'mariag78@gmail.com', direccion: 'Res. Las Acacias, Torre B, Apto 4-C, Valencia', tipo_cliente: 'particular', vendedor_id: supervisor.id },
      { nombre: 'Corporación SAMCA', rif_cedula: 'J-30987654-3', telefono: '0241-8901234', email: 'compras@samca.com.ve', direccion: 'Zona Industrial Municipal Norte, Valencia', tipo_cliente: 'empresa', vendedor_id: supervisor.id, notas: 'Mantenimiento industrial.' },
      { nombre: 'José Ramírez', rif_cedula: 'V-19876543', telefono: '0414-4789012', email: null, direccion: 'Barrio Unión, Guacara', tipo_cliente: 'particular', vendedor_id: vendedorId, notas: 'Autoconstrucción.' },
      { nombre: 'Construcciones Orinoco C.A.', rif_cedula: 'J-41567890-2', telefono: '0241-8012345', email: 'orinoco@gmail.com', direccion: 'Av. Universidad, Edif. Orinoco, Valencia', tipo_cliente: 'constructor', vendedor_id: vendedorId, notas: 'Obra: Parque del Este.' },
      { nombre: 'Ferretería El Tornillo Feliz', rif_cedula: 'J-50456789-5', telefono: '0241-8123456', email: 'eltornillofeliz@hotmail.com', direccion: 'C.C. Paseo Las Industrias, Valencia', tipo_cliente: 'ferreteria', vendedor_id: vendedorId, notas: 'Reventa quincenal.' },
      { nombre: 'Ana Lucía Pérez', rif_cedula: 'V-21456789', telefono: '0424-4890123', email: 'analucia@gmail.com', direccion: 'Urb. Trigal Norte, Valencia', tipo_cliente: 'particular', vendedor_id: vendedorId },
      { nombre: 'Soluciones Eléctricas VLC', rif_cedula: 'J-41890123-4', telefono: '0412-4901234', email: 'soluciones.electricas@gmail.com', direccion: 'Av. Bolívar Sur, C.C. Cosmos, Valencia', tipo_cliente: 'empresa', vendedor_id: vendedorId, notas: 'Cables por volumen.' },
      { nombre: 'Pedro Hernández', rif_cedula: 'V-15678901', telefono: '0416-6012345', email: null, direccion: 'Sector La Isabelica, Valencia', tipo_cliente: 'particular', vendedor_id: vendedorId, notas: 'Plomero independiente.' },
    ];
    const clientesCreados = await supaBatch(env, 'clientes', clientes, 500, logStep);
    logStep(`✓ ${clientesCreados.length} clientes creados`);

    // Cotizaciones con items
    logStep('--- Fase 7: Insertar cotizaciones (6) ---');
    const ahora = Date.now();
    const hace3d = new Date(ahora - 3 * 86400000).toISOString();
    const hace5d = new Date(ahora - 5 * 86400000).toISOString();
    const hace7d = new Date(ahora - 7 * 86400000).toISOString();
    const hace10d = new Date(ahora - 10 * 86400000).toISOString();
    const en7d = new Date(ahora + 7 * 86400000).toISOString().split('T')[0];
    const en15d = new Date(ahora + 15 * 86400000).toISOString().split('T')[0];

    const cotizaciones = [
      { cliente_id: clientesCreados[1].id, vendedor_id: supervisor.id, transportista_id: transCreados[3].id, estado: 'borrador', subtotal_usd: 777.50, descuento_global_pct: 3, descuento_usd: 23.33, costo_envio_usd: 15, total_usd: 769.17, valida_hasta: en15d, notas_cliente: 'Precios especiales por volumen.', notas_internas: 'Pendiente aprobación.', creado_en: hace3d },
      { cliente_id: clientesCreados[0].id, vendedor_id: supervisor.id, estado: 'enviada', subtotal_usd: 438.48, descuento_global_pct: 0, descuento_usd: 0, costo_envio_usd: 0, total_usd: 438.48, tasa_bcv_snapshot: 95.50, total_bs_snapshot: 41874.84, valida_hasta: en7d, notas_cliente: 'Retiro en tienda.', enviada_en: hace5d, creado_en: hace5d },
      { cliente_id: clientesCreados[12].id, vendedor_id: vendedorId, transportista_id: transCreados[0].id, estado: 'enviada', subtotal_usd: 121.50, descuento_global_pct: 0, descuento_usd: 0, costo_envio_usd: 8, total_usd: 129.50, tasa_bcv_snapshot: 94.80, total_bs_snapshot: 12276.60, valida_hasta: en7d, notas_cliente: 'Plomería residencial.', enviada_en: hace3d, creado_en: hace5d },
      { cliente_id: clientesCreados[11].id, vendedor_id: vendedorId, estado: 'aceptada', subtotal_usd: 441.25, descuento_global_pct: 2, descuento_usd: 8.83, costo_envio_usd: 0, total_usd: 432.42, tasa_bcv_snapshot: 93.20, total_bs_snapshot: 40321.54, valida_hasta: en15d, notas_cliente: 'Material eléctrico.', enviada_en: hace7d, creado_en: hace10d },
      { cliente_id: clientesCreados[3].id, vendedor_id: supervisor.id, estado: 'borrador', subtotal_usd: 29.00, descuento_global_pct: 0, descuento_usd: 0, costo_envio_usd: 0, total_usd: 29.00, notas_internas: 'Preguntó por descuento efectivo.', creado_en: new Date().toISOString() },
      { cliente_id: clientesCreados[8].id, vendedor_id: vendedorId, transportista_id: transCreados[3].id, estado: 'enviada', subtotal_usd: 1627.50, descuento_global_pct: 5, descuento_usd: 81.38, costo_envio_usd: 15, total_usd: 1561.12, tasa_bcv_snapshot: 95.10, total_bs_snapshot: 148462.51, valida_hasta: en7d, notas_cliente: 'Entrega en obra: Parque del Este.', notas_internas: 'Descuento autorizado.', enviada_en: hace3d, creado_en: hace5d },
    ];
    const cotsCreadas = await supaBatch(env, 'cotizaciones', cotizaciones, 500, logStep);
    logStep(`✓ ${cotsCreadas.length} cotizaciones creadas`);
    for (const c of cotsCreadas) logStep(`    → Cot ${c.id?.substring(0, 8)}... estado=${c.estado} cliente=${c.cliente_id?.substring(0, 8)}...`);

    // Items (simplificados)
    logStep('--- Fase 8: Insertar items (19) ---');
    const allItems = [
      { cotizacion_id: cotsCreadas[0].id, producto_id: prodsCreados[0].id, codigo_snap: 'CEM-001', nombre_snap: 'Cemento Gris Tipo I 42.5kg', unidad_snap: 'bolsa', cantidad: 100, precio_unit_usd: 5.50, descuento_pct: 5, total_linea_usd: 522.50, orden: 0 },
      { cotizacion_id: cotsCreadas[0].id, producto_id: prodsCreados[3].id, codigo_snap: 'CEM-004', nombre_snap: 'Arena Lavada (saco 40kg)', unidad_snap: 'bolsa', cantidad: 50, precio_unit_usd: 2.00, descuento_pct: 0, total_linea_usd: 100.00, orden: 1 },
      { cotizacion_id: cotsCreadas[0].id, producto_id: prodsCreados[4].id, codigo_snap: 'CEM-005', nombre_snap: 'Piedra Picada Nro. 2', unidad_snap: 'bolsa', cantidad: 50, precio_unit_usd: 2.50, descuento_pct: 0, total_linea_usd: 125.00, orden: 2 },
      { cotizacion_id: cotsCreadas[0].id, producto_id: prodsCreados[25].id, codigo_snap: 'FIJ-001', nombre_snap: 'Tornillo Drywall', unidad_snap: 'caja', cantidad: 10, precio_unit_usd: 3.00, descuento_pct: 0, total_linea_usd: 30.00, orden: 3 },
      { cotizacion_id: cotsCreadas[1].id, producto_id: prodsCreados[5].id, codigo_snap: 'PIN-001', nombre_snap: 'Pintura Caucho Int.', unidad_snap: 'und', cantidad: 12, precio_unit_usd: 18.00, descuento_pct: 8, total_linea_usd: 198.72, orden: 0 },
      { cotizacion_id: cotsCreadas[1].id, producto_id: prodsCreados[6].id, codigo_snap: 'PIN-002', nombre_snap: 'Pintura Caucho Ext.', unidad_snap: 'und', cantidad: 8, precio_unit_usd: 22.00, descuento_pct: 8, total_linea_usd: 161.92, orden: 1 },
      { cotizacion_id: cotsCreadas[1].id, producto_id: prodsCreados[9].id, codigo_snap: 'PIN-005', nombre_snap: 'Rodillo de Felpa', unidad_snap: 'und', cantidad: 20, precio_unit_usd: 4.50, descuento_pct: 0, total_linea_usd: 90.00, orden: 2 },
      { cotizacion_id: cotsCreadas[2].id, producto_id: prodsCreados[20].id, codigo_snap: 'PLO-001', nombre_snap: 'Tubo PVC 1/2"', unidad_snap: 'und', cantidad: 20, precio_unit_usd: 3.50, descuento_pct: 0, total_linea_usd: 70.00, orden: 0 },
      { cotizacion_id: cotsCreadas[2].id, producto_id: prodsCreados[22].id, codigo_snap: 'PLO-003', nombre_snap: 'Codo PVC 1/2"', unidad_snap: 'und', cantidad: 40, precio_unit_usd: 0.40, descuento_pct: 0, total_linea_usd: 16.00, orden: 1 },
      { cotizacion_id: cotsCreadas[3].id, producto_id: prodsCreados[15].id, codigo_snap: 'ELE-001', nombre_snap: 'Cable THHN 12AWG', unidad_snap: 'rollo', cantidad: 5, precio_unit_usd: 35.00, descuento_pct: 5, total_linea_usd: 166.25, orden: 0 },
      { cotizacion_id: cotsCreadas[3].id, producto_id: prodsCreados[16].id, codigo_snap: 'ELE-002', nombre_snap: 'Interruptor 15A', unidad_snap: 'und', cantidad: 30, precio_unit_usd: 2.50, descuento_pct: 0, total_linea_usd: 75.00, orden: 1 },
      { cotizacion_id: cotsCreadas[3].id, producto_id: prodsCreados[17].id, codigo_snap: 'ELE-003', nombre_snap: 'Toma Corriente', unidad_snap: 'und', cantidad: 25, precio_unit_usd: 3.00, descuento_pct: 0, total_linea_usd: 75.00, orden: 2 },
      { cotizacion_id: cotsCreadas[3].id, producto_id: prodsCreados[19].id, codigo_snap: 'ELE-005', nombre_snap: 'Bombillo LED', unidad_snap: 'und', cantidad: 50, precio_unit_usd: 2.00, descuento_pct: 0, total_linea_usd: 100.00, orden: 3 },
      { cotizacion_id: cotsCreadas[4].id, producto_id: prodsCreados[10].id, codigo_snap: 'HER-001', nombre_snap: 'Martillo 16oz', unidad_snap: 'und', cantidad: 1, precio_unit_usd: 12.00, descuento_pct: 0, total_linea_usd: 12.00, orden: 0 },
      { cotizacion_id: cotsCreadas[4].id, producto_id: prodsCreados[14].id, codigo_snap: 'HER-005', nombre_snap: 'Cinta Métrica 5m', unidad_snap: 'und', cantidad: 1, precio_unit_usd: 5.00, descuento_pct: 0, total_linea_usd: 5.00, orden: 1 },
      { cotizacion_id: cotsCreadas[4].id, producto_id: prodsCreados[28].id, codigo_snap: 'FIJ-004', nombre_snap: 'Silicón Transparente', unidad_snap: 'und', cantidad: 3, precio_unit_usd: 4.00, descuento_pct: 0, total_linea_usd: 12.00, orden: 2 },
      { cotizacion_id: cotsCreadas[5].id, producto_id: prodsCreados[0].id, codigo_snap: 'CEM-001', nombre_snap: 'Cemento Gris', unidad_snap: 'bolsa', cantidad: 200, precio_unit_usd: 5.50, descuento_pct: 8, total_linea_usd: 1012.00, orden: 0 },
      { cotizacion_id: cotsCreadas[5].id, producto_id: prodsCreados[2].id, codigo_snap: 'CEM-003', nombre_snap: 'Mortero 40kg', unidad_snap: 'bolsa', cantidad: 50, precio_unit_usd: 4.50, descuento_pct: 5, total_linea_usd: 213.75, orden: 1 },
      { cotizacion_id: cotsCreadas[5].id, producto_id: prodsCreados[3].id, codigo_snap: 'CEM-004', nombre_snap: 'Arena Lavada', unidad_snap: 'bolsa', cantidad: 80, precio_unit_usd: 2.00, descuento_pct: 0, total_linea_usd: 160.00, orden: 2 },
    ];
    const itemsCreados = await supaBatch(env, 'cotizacion_items', allItems, 500, logStep);
    logStep(`✓ ${itemsCreados.length} items creados`);

    const elapsed = Date.now() - start;
    logStep('--- Resumen final ---');
    logStep(`  Productos: ${prodsCreados.length}`);
    logStep(`  Transportistas: ${transCreados.length}`);
    logStep(`  Clientes: ${clientesCreados.length}`);
    logStep(`  Cotizaciones: ${cotsCreadas.length}`);
    logStep(`  Items: ${itemsCreados.length}`);
    logStep(`  Total registros: ${prodsCreados.length + transCreados.length + clientesCreados.length + cotsCreadas.length + itemsCreados.length}`);
    logStep(`✓ SEED DEMO completado exitosamente en ${elapsed}ms`);
    return json({
      ok: true,
      elapsed_ms: elapsed,
      resumen: { productos: prodsCreados.length, transportistas: transCreados.length, clientes: clientesCreados.length, cotizaciones: cotsCreadas.length, items: itemsCreados.length },
      log,
    }, 200, request);
  } catch (e) {
    logStep(`✗ ERROR FATAL: ${e.message}`);
    logStep(`  Stack: ${e.stack?.split('\n').slice(0, 3).join(' | ') || 'N/A'}`);
    return json({ ok: false, error: `Error en seed demo: ${e.message}`, log }, 500, request);
  }
}

// ── Stress Seed (datos masivos para pruebas de rendimiento) ─────────────────
async function handleTesterStressSeed(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores', 403, request);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const LEVELS = {
    small:   { productos: 100,  clientes: 50,   cotizaciones: 200,  itemsPorCot: [2, 6] },
    medium:  { productos: 300,  clientes: 150,  cotizaciones: 500,  itemsPorCot: [2, 8] },
    large:   { productos: 500,  clientes: 300,  cotizaciones: 1000, itemsPorCot: [2, 8] },
  };

  const level = LEVELS[body.level] || LEVELS.medium;
  const levelName = body.level || 'medium';
  const start = Date.now();
  const log = [];
  function logStep(msg) { log.push({ ts: Date.now() - start, msg }) }

  try {
    logStep('=== STRESS SEED — Inicio ===');
    logStep(`Usuario: ${user.id}`);
    logStep(`Supabase URL: ${env.SUPABASE_URL}`);
    logStep(`Nivel: ${levelName}`);
    logStep(`Config: ${level.productos} prods, ${level.clientes} clientes, ${level.cotizaciones} cotizaciones, items/cot: ${level.itemsPorCot.join('-')}`);
    logStep(`Fecha/hora: ${new Date().toISOString()}`);

    // Limpiar
    logStep('--- Fase 1: Limpieza de tablas ---');
    await supaDelete(env, 'comisiones', logStep);
    await supaDelete(env, 'notas_despacho', logStep);
    await supaDelete(env, 'cotizacion_items', logStep);
    await supaDelete(env, 'cotizaciones', logStep);
    await supaDelete(env, 'clientes', logStep);
    await supaDelete(env, 'transportistas', logStep);
    await supaDelete(env, 'productos', logStep);
    logStep('✓ Limpieza completada');

    // Usuarios
    logStep('--- Fase 2: Consultar usuarios ---');
    const t0Users = Date.now();
    const usuarios = await supaQuery(env, 'usuarios', '?select=id,nombre,rol&activo=eq.true');
    logStep(`  GET usuarios: ${usuarios.length} encontrados (${Date.now() - t0Users}ms)`);
    for (const u of usuarios) logStep(`    → ${u.rol}: ${u.nombre} (${u.id.substring(0, 8)}...)`);
    const supervisor = usuarios.find(u => u.rol === 'supervisor');
    const vendedor = usuarios.find(u => u.rol === 'vendedor');
    if (!supervisor) {
      logStep('✗ ERROR: No hay supervisor activo');
      return json({ ok: false, error: 'No hay supervisor activo', log }, 400, request);
    }
    const vendedorId = vendedor?.id ?? supervisor.id;

    const CATEGORIAS = ['Cemento', 'Pintura', 'Herramientas', 'Electricidad', 'Plomería', 'Fijación', 'Ferretería General', 'Seguridad']
    const UNIDADES = ['und', 'bolsa', 'kg', 'rollo', 'caja', 'metro', 'galón', 'litro']
    const TIPOS = ['particular', 'ferreteria', 'constructor', 'empresa']
    const ESTADOS = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada']
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    const randF = (a, b) => +(Math.random() * (b - a) + a).toFixed(2);

    logStep('--- Fase 3: Generar productos ---');
    // Productos
    const productos = [];
    for (let i = 0; i < level.productos; i++) {
      const cat = pick(CATEGORIAS);
      const costo = randF(0.20, 50);
      productos.push({
        codigo: `${cat.substring(0, 3).toUpperCase()}-${String(i + 1).padStart(4, '0')}`,
        nombre: `Producto ${cat} #${i + 1}`,
        categoria: cat,
        unidad: pick(UNIDADES),
        precio_usd: +(costo * randF(1.2, 1.8)).toFixed(2),
        costo_usd: costo,
        stock_actual: rand(0, 500),
        stock_minimo: rand(5, 50),
      });
    }
    logStep(`  Generados ${productos.length} productos en memoria`);
    const prods = await supaBatch(env, 'productos', productos, 500, logStep);
    logStep(`✓ ${prods.length} productos insertados`);

    // Transportistas
    logStep('--- Fase 4: Insertar transportistas ---');
    const trans = await supaBatch(env, 'transportistas', [
      { nombre: 'TransVenCarga', rif: 'J-30456789-1', telefono: '0241-4561234', zona_cobertura: 'Valencia', tarifa_base: 8, creado_por: supervisor.id },
      { nombre: 'MRW', rif: 'J-00359741-6', telefono: '0800-679-0000', zona_cobertura: 'Nacional', tarifa_base: 12, creado_por: supervisor.id },
      { nombre: 'Zoom', rif: 'J-29871456-2', telefono: '0800-966-6000', zona_cobertura: 'Nacional', tarifa_base: 10, creado_por: supervisor.id },
    ], 500, logStep);
    logStep(`✓ ${trans.length} transportistas insertados`);

    // Clientes
    logStep(`--- Fase 5: Generar clientes (${level.clientes}) ---`);
    const clientes = [];
    const APELLIDOS = ['Rodríguez', 'Martínez', 'López', 'González', 'Hernández', 'Pérez', 'García', 'Ramírez', 'Torres', 'Flores', 'Morales', 'Castillo'];
    for (let i = 0; i < level.clientes; i++) {
      const tipo = pick(TIPOS);
      const esVend = Math.random() < 0.5;
      clientes.push({
        nombre: tipo === 'particular' ? `${pick(['José', 'María', 'Carlos', 'Ana', 'Luis', 'Rosa'])} ${pick(APELLIDOS)}` : `${pick(['Ferretería', 'Construcciones', 'Inversiones', 'Servicios'])} ${pick(APELLIDOS)} ${pick(['C.A.', 'S.A.', '& Hijos'])}`,
        rif_cedula: tipo === 'particular' ? `V-${rand(10000000, 29999999)}` : `J-${rand(30000000, 50999999)}-${rand(0, 9)}`,
        telefono: `04${rand(12, 26)}-${rand(1000000, 9999999)}`,
        email: Math.random() < 0.6 ? `stress${i}@test.com` : null,
        direccion: `Calle ${rand(1, 100)}, Valencia`,
        tipo_cliente: tipo,
        vendedor_id: esVend ? vendedorId : supervisor.id,
      });
    }
    logStep(`  Generados ${clientes.length} clientes en memoria`);
    const clis = await supaBatch(env, 'clientes', clientes, 500, logStep);
    logStep(`✓ ${clis.length} clientes insertados`);

    // Cotizaciones + Items
    logStep(`--- Fase 6: Generar cotizaciones (${level.cotizaciones}) ---`);
    const cotBatch = [];
    const ahora = Date.now();
    for (let i = 0; i < level.cotizaciones; i++) {
      const estado = pick(ESTADOS);
      const cli = pick(clis);
      const descG = Math.random() < 0.4 ? rand(1, 10) : 0;
      const envio = Math.random() < 0.3 ? pick(trans).tarifa_base : 0;
      const diasAtras = rand(0, 30);
      const creado = new Date(ahora - diasAtras * 86400000).toISOString();
      cotBatch.push({
        cliente_id: cli.id,
        vendedor_id: cli.vendedor_id,
        transportista_id: Math.random() < 0.3 ? pick(trans).id : null,
        estado,
        subtotal_usd: 0, descuento_global_pct: descG, descuento_usd: 0, costo_envio_usd: envio, total_usd: 0,
        tasa_bcv_snapshot: estado !== 'borrador' ? randF(90, 100) : null,
        valida_hasta: estado !== 'borrador' ? new Date(ahora + rand(1, 30) * 86400000).toISOString().split('T')[0] : null,
        notas_cliente: i % 3 === 0 ? `Stress test cotización #${i + 1}` : null,
        creado_en: creado,
        enviada_en: estado !== 'borrador' ? creado : null,
      });
    }
    logStep(`  Generadas ${cotBatch.length} cotizaciones en memoria`);
    const cots = await supaBatch(env, 'cotizaciones', cotBatch, 500, logStep);
    logStep(`✓ ${cots.length} cotizaciones insertadas`);
    const estadoCount = {};
    for (const c of cots) estadoCount[c.estado] = (estadoCount[c.estado] || 0) + 1;
    logStep(`  Distribución de estados: ${Object.entries(estadoCount).map(([k, v]) => `${k}=${v}`).join(', ')}`);

    // Items
    logStep(`--- Fase 7: Generar items ---`);
    const allItems = [];
    for (let i = 0; i < cots.length; i++) {
      const numItems = rand(level.itemsPorCot[0], level.itemsPorCot[1]);
      let subtotal = 0;
      for (let j = 0; j < numItems; j++) {
        const prod = pick(prods);
        const cant = rand(1, 50);
        const desc = Math.random() < 0.2 ? rand(1, 10) : 0;
        const total = +(cant * prod.precio_usd * (1 - desc / 100)).toFixed(2);
        subtotal += total;
        allItems.push({
          cotizacion_id: cots[i].id,
          producto_id: prod.id,
          codigo_snap: prod.codigo,
          nombre_snap: prod.nombre,
          unidad_snap: prod.unidad,
          cantidad: cant,
          precio_unit_usd: prod.precio_usd,
          descuento_pct: desc,
          total_linea_usd: total,
          orden: j,
        });
      }
    }
    logStep(`  Generados ${allItems.length} items en memoria (promedio ${(allItems.length / cots.length).toFixed(1)} items/cotización)`);
    const items = await supaBatch(env, 'cotizacion_items', allItems, 1000, logStep);
    logStep(`✓ ${items.length} items insertados`);

    const elapsed = Date.now() - start;
    const totalRegs = prods.length + trans.length + clis.length + cots.length + items.length;
    const throughput = Math.round(totalRegs / (elapsed / 1000));
    logStep('--- Resumen final ---');
    logStep(`  Nivel: ${levelName}`);
    logStep(`  Productos: ${prods.length}`);
    logStep(`  Transportistas: ${trans.length}`);
    logStep(`  Clientes: ${clis.length}`);
    logStep(`  Cotizaciones: ${cots.length}`);
    logStep(`  Items: ${items.length}`);
    logStep(`  Total registros: ${totalRegs}`);
    logStep(`  Tiempo total: ${elapsed}ms`);
    logStep(`  Throughput: ${throughput} registros/segundo`);
    logStep(`✓ STRESS SEED completado exitosamente`);
    return json({
      ok: true,
      level: levelName,
      elapsed_ms: elapsed,
      resumen: { productos: prods.length, transportistas: trans.length, clientes: clis.length, cotizaciones: cots.length, items: items.length },
      throughput: Math.round((prods.length + clis.length + cots.length + items.length) / (elapsed / 1000)),
      log,
    }, 200, request);
  } catch (e) {
    logStep(`✗ ERROR FATAL: ${e.message}`);
    logStep(`  Stack: ${e.stack?.split('\n').slice(0, 3).join(' | ') || 'N/A'}`);
    return json({ ok: false, error: `Error en stress seed: ${e.message}`, log }, 500, request);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ── System Logs Handlers ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════

// POST /api/logs — recibir log del frontend (cualquier usuario autenticado)
async function handleLogFromClient(request, env) {
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
async function handleGetLogs(request, env, url) {
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
async function handleGetLogStats(request, env) {
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
async function handleDownloadLogs(request, env) {
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
async function handleAnalyzeLogs(request, env) {
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

// DELETE /api/admin/logs/purge — limpiar logs > 90 días
async function handlePurgeLogs(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.operator_id) return jsonError('No autenticado', 401, request)
  const isSup = await verifySupervisor(user.operator_id, env)
  if (!isSup) return jsonError('Solo supervisores', 403, request)

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  }

  const corte = new Date(Date.now() - 90 * 86400000).toISOString()
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/system_logs?ts=lt.${corte}`,
    { method: 'DELETE', headers: { ...h, Prefer: 'return=representation' } }
  )

  if (!res.ok) return jsonError('Error purgando logs', 500, request)
  const deleted = await res.json()

  return json({ ok: true, eliminados: deleted.length }, 200, request)
}
