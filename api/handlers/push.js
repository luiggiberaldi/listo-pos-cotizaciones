// api/handlers/push.js
import { json, jsonError, corsHeaders, isRateLimited, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { SUPER_ADMIN_UUID } from '../lib/operatorSession.js'
import { ROLES_VALIDOS } from '../lib/notificarPush.js'
import { enviarPush } from '../lib/notificarPush.js'

const ROLES_BROADCAST = ['supervisor', 'jefe', 'administracion', 'desarrollador']

// Solo servicios push reales: el Worker enviará una petición a esta dirección.
const HOSTS_PUSH = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
]

export function esEndpointPushValido(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false
  let u
  try { u = new URL(endpoint) } catch { return false }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOSTS_PUSH.some(re => re.test(u.hostname))
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/
export function esClavePushValida(valor, min, max) {
  return typeof valor === 'string' && valor.length >= min && valor.length <= max && BASE64URL.test(valor)
}

// Devuelve la lista de roles válidos o null si algún rol no existe.
export function normalizarRoles(targetRole) {
  const lista = (Array.isArray(targetRole) ? targetRole : String(targetRole).split(','))
    .map(r => String(r).trim()).filter(Boolean)
  if (!lista.length || lista.length > ROLES_VALIDOS.length) return null
  return lista.every(r => ROLES_VALIDOS.includes(r)) ? [...new Set(lista)] : null
}

// Solo rutas internas de la app (nunca enlaces externos).
export function urlInterna(valor) {
  if (typeof valor !== 'string' || valor.length > 300) return null
  return /^\/(?![/\\])[\w\-./?=&%#]*$/.test(valor) ? valor : null
}

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function handlePush(request, env, url) {
  const route = url.pathname.replace('/api/push/', '');

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }

  // ── GET vapid-public-key — devuelve la clave pública VAPID ──────────────
  if (route === 'vapid-public-key' && request.method === 'GET') {
    return json({ key: env.VAPID_PUBLIC_KEY }, 200, request);
  }

  const serviceHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };

  // ── POST subscribe — guarda la suscripción push del OPERADOR ─────────────
  if (route === 'subscribe' && request.method === 'POST') {
    const v = await validateOperator(request, env);
    if (v.error) return v.error;
    const { operador } = v;
    if (operador.id === SUPER_ADMIN_UUID) {
      return jsonError('Este usuario no puede recibir notificaciones push', 400, request);
    }

    let body;
    try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

    const { endpoint, keys } = body || {};
    if (!esEndpointPushValido(endpoint) || !esClavePushValida(keys?.p256dh, 40, 200) || !esClavePushValida(keys?.auth, 10, 60)) {
      return jsonError('Suscripción inválida', 400, request);
    }

    // Un dispositivo (endpoint) pertenece a un solo operador: si cambia de operador, se reasigna.
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
      method: 'POST',
      headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ usuario_id: operador.id, endpoint, p256dh: keys.p256dh, auth: keys.auth }),
    });

    if (!res.ok) return jsonError('Error al guardar suscripción', 500, request);
    return json({ ok: true }, 200, request);
  }

  // ── DELETE unsubscribe — elimina la suscripción del operador ─────────────
  if (route === 'unsubscribe' && request.method === 'DELETE') {
    const v = await validateOperator(request, env);
    if (v.error) return v.error;
    const { operador } = v;

    let body;
    try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
    if (typeof body?.endpoint !== 'string' || !body.endpoint || body.endpoint.length > 1000) {
      return jsonError('Suscripción inválida', 400, request);
    }

    await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?usuario_id=eq.${operador.id}&endpoint=eq.${encodeURIComponent(body.endpoint)}`,
      { method: 'DELETE', headers: serviceHeaders }
    );

    return json({ ok: true }, 200, request);
  }

  // ── POST send — envía push a un usuario o a roles específicos ────────────
  if (route === 'send' && request.method === 'POST') {
    const v = await validateOperator(request, env);
    if (v.error) return v.error;
    const { operador } = v;

    // Límite por operador (no solo por IP)
    if (isRateLimited(`push:${operador.id}`)) {
      return jsonError('Demasiadas notificaciones. Intenta en un minuto.', 429, request);
    }

    let body;
    try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

    const title = texto(body?.title, 80);
    const message = texto(body?.message, 240);
    if (!title || !message) return jsonError('Faltan title y message', 400, request);
    const targetUrl = urlInterna(body?.url ?? '/');
    if (!targetUrl) return jsonError('Enlace no permitido', 400, request);
    const tag = texto(body?.tag, 60) || undefined;
    const { targetRole, targetUserId } = body;

    // Destino (todo validado)
    let roles
    if (targetUserId) {
      if (!isValidUuid(targetUserId)) return jsonError('Destino inválido', 400, request);
    } else if (targetRole) {
      roles = normalizarRoles(targetRole);
      if (!roles) return jsonError('Rol destino inválido', 400, request);
    } else if (!ROLES_BROADCAST.includes(operador.rol)) {
      // Aviso a todos: solo roles de dirección
      return jsonError('Permisos insuficientes para avisar a todos', 403, request);
    }

    // Nunca se le avisa a quien hizo la acción
    const r = await enviarPush(env, {
      title, message, tag, url: targetUrl, roles, userId: targetUserId || undefined,
      excluirUsuarioId: operador.id, usuarioNombre: operador.nombre,
    });
    if (r.error) return jsonError(r.error, r.status || 500, request);
    return json({ ok: true, sent: r.sent, failed: r.failed }, 200, request);
  }

  return jsonError('Ruta push no encontrada', 404, request);
}
