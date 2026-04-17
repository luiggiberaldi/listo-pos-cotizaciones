// worker.js
// Cloudflare Worker — sirve assets estáticos + API proxy para operaciones admin
// Las operaciones admin (crear/editar/eliminar usuarios) se manejan aquí
// para mantener el service_role key fuera del frontend.

// ── Allowed origins for CORS ──────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://listo-pos-cotizaciones.camelai.app',
  'https://listo-pos-cotizaciones.apps.camelai.dev',
]

function getAllowedOrigin(request) {
  const origin = request.headers.get('Origin') || ''
  if (ALLOWED_ORIGINS.includes(origin)) return origin
  // Allow same-origin requests (no Origin header)
  if (!origin) return null
  // Allow camelai subdomains
  if (origin.endsWith('.camelai.app') || origin.endsWith('.camelai.dev')) return origin
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

    // ── API: listar todos los clientes (bypass RLS para vendedores) ───────
    if (url.pathname === '/api/clientes' && request.method === 'GET') {
      return handleListarClientes(request, env);
    }

    // ── API: guardar cotización (bypass RLS para clientes ajenos) ─────────
    if (url.pathname === '/api/cotizaciones/guardar' && request.method === 'POST') {
      return handleGuardarCotizacion(request, env);
    }

    // ── API: reciclar cotización (supervisor: crea borrador desde rechazada/anulada/vencida) ──
    if (url.pathname === '/api/cotizaciones/reciclar' && request.method === 'POST') {
      return handleReciclarCotizacion(request, env);
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

    // ── API routes para operaciones admin ──────────────────────────────────
    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdmin(request, env, url);
    }

    // ── API routes para push notifications ────────────────────────────────
    if (url.pathname.startsWith('/api/push/')) {
      return handlePush(request, env, url);
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

// Verifica el JWT del usuario autenticado contra Supabase
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
  return user;
}

// Verifica que el usuario sea supervisor consultando la tabla usuarios
async function verifySupervisor(userId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${userId}&activo=eq.true&select=rol`,
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

  // Verificar que es supervisor
  const isSupervisor = await verifySupervisor(user.id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  // Parsear body
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const route = url.pathname.replace('/api/admin/', '');

  // ── Crear usuario ─────────────────────────────────────────────────────
  if (route === 'users' && request.method === 'POST') {
    const { email, password, nombre, rol, color } = body;
    if (!email || !password || !nombre || !rol) {
      return jsonError('Faltan campos: email, password, nombre, rol', 400, request);
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return jsonError('Formato de email inválido', 400, request);
    }

    // Validate rol
    if (!['supervisor', 'vendedor'].includes(rol)) {
      return jsonError('Rol inválido: debe ser supervisor o vendedor', 400, request);
    }

    // Crear en Supabase Auth
    const authRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
      }),
    });

    const authData = await authRes.json();
    if (!authRes.ok) {
      const msg = authData?.msg || authData?.message || 'Error al crear usuario en auth';
      if (msg.includes('already registered')) {
        return jsonError('Ya existe un usuario con ese email', 409, request);
      }
      return jsonError(msg, authRes.status, request);
    }

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
        id: authData.id,
        nombre: nombre.trim(),
        rol,
        activo: true,
        ...(color ? { color } : {}),
      }),
    });

    if (!dbRes.ok) {
      // Rollback: eliminar auth user
      await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${authData.id}`, {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      });
      return jsonError('Error al insertar en tabla usuarios', 500, request);
    }

    return json({ id: authData.id, ok: true }, 201, request);
  }

  // ── Actualizar usuario (nombre, rol, PIN, color) ──────────────────────
  if (route.startsWith('users/') && request.method === 'PUT') {
    const userId = route.replace('users/', '');
    const { nombre, rol, pin, color } = body;

    // Validate rol if provided
    if (rol && !['supervisor', 'vendedor'].includes(rol)) {
      return jsonError('Rol inválido', 400, request);
    }

    // Actualizar en public.usuarios
    if (nombre || rol || color !== undefined) {
      const updateData = {};
      if (nombre) updateData.nombre = nombre.trim();
      if (rol) updateData.rol = rol;
      if (color !== undefined) updateData.color = color;

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

    // Cambiar PIN si se proporcionó
    if (pin) {
      const authRes = await fetch(
        `${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`,
        {
          method: 'PUT',
          headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ password: pin }),
        }
      );
      if (!authRes.ok) return jsonError('Error al cambiar PIN', 500, request);
    }

    return json({ ok: true }, 200, request);
  }

  // ── Eliminar usuario ──────────────────────────────────────────────────
  if (route.startsWith('users/') && request.method === 'DELETE') {
    const userId = route.replace('users/', '');

    // Eliminar de public.usuarios primero
    await fetch(
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

    // Eliminar de auth
    const authRes = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`,
      {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    if (!authRes.ok) return jsonError('Error al eliminar usuario de auth', 500, request);

    return json({ ok: true }, 200, request);
  }

  return jsonError('Ruta no encontrada', 404, request);
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
        usuario_id: user.id,
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
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?usuario_id=eq.${user.id}&endpoint=eq.${encodeURIComponent(body.endpoint)}`,
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

  // ── POST send — envía push a todos los supervisores ─────────────────────
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

    const { title, message, url: targetUrl = '/', tag } = body;
    if (!title || !message) return jsonError('Faltan title y message', 400, request);

    // Obtener suscripciones de supervisores
    const subsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );

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

  const isSupervisor = await verifySupervisor(user.id, env);
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

  const isSupervisor = await verifySupervisor(user.id, env);
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

  // Validate expected tables
  const expectedTables = ['configuracion_negocio', 'transportistas', 'productos', 'clientes', 'cotizaciones', 'cotizacion_items', 'notas_despacho'];
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

  const isSupervisor = await verifySupervisor(user.id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

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

  let queryUrl = `${env.SUPABASE_URL}/rest/v1/clientes?activo=eq.true&order=nombre.asc&select=id,nombre,rif_cedula,telefono,email,direccion,notas,tipo_cliente,activo,vendedor_id,asignado_en,ultima_reasig_por,ultima_reasig_motivo,ultima_reasig_en,creado_en,actualizado_en,vendedor:usuarios!clientes_vendedor_id_fkey(id,nombre,color)`;

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

// ── Save cotización (service key bypasses RLS for cross-vendor clients) ────
async function handleGuardarCotizacion(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { cotizacionId, headerData, items } = body;
  if (!headerData || !items) return jsonError('Faltan campos', 400, request);

  // Force vendedor_id to authenticated user
  headerData.vendedor_id = user.id;

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
  const isSup = await verifySupervisor(user.id, env);
  if (!isSup) return jsonError('Solo supervisores pueden reciclar cotizaciones', 403, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { cotizacionId, vendedorDestinoId } = body;
  if (!cotizacionId || !vendedorDestinoId) return jsonError('Faltan campos: cotizacionId, vendedorDestinoId', 400, request);

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
      fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${user.id}&select=nombre,rol`, { headers: supaHeaders }),
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
        usuario_id: user.id,
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
