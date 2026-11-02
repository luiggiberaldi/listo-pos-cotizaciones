// api/handlers/push.js
import { json, jsonError, corsHeaders, isRateLimited, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { logToSystem } from '../lib/audit.js'
import { SUPER_ADMIN_UUID } from '../lib/operatorSession.js'
import { sendWebPush } from '../lib/webpush.js'

const ROLES_VALIDOS = ['administracion', 'desarrollador', 'jefe', 'logistica', 'supervisor', 'vendedor', 'vendedor_sin_comision']
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

    // Construir filtro de suscripciones según el destino (todo validado)
    let subsUrl = `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth,usuario_id`;

    if (targetUserId) {
      if (!isValidUuid(targetUserId)) return jsonError('Destino inválido', 400, request);
      subsUrl += `&usuario_id=eq.${targetUserId}`;
    } else if (targetRole) {
      const roles = normalizarRoles(targetRole);
      if (!roles) return jsonError('Rol destino inválido', 400, request);
      const usersRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/usuarios?select=id&rol=in.(${roles.join(',')})`,
        { headers: serviceHeaders }
      );
      if (!usersRes.ok) return jsonError('Error al obtener usuarios', 500, request);
      const userIds = (await usersRes.json()).map(u => u.id).filter(isValidUuid);
      if (!userIds.length) return json({ ok: true, sent: 0 }, 200, request);
      subsUrl += `&usuario_id=in.(${userIds.join(',')})`;
    } else {
      // Aviso a todos: solo roles de dirección
      if (!ROLES_BROADCAST.includes(operador.rol)) {
        return jsonError('Permisos insuficientes para avisar a todos', 403, request);
      }
    }
    // Nunca avisarle a quien hizo la acción
    subsUrl += `&usuario_id=neq.${operador.id}`;

    const subsRes = await fetch(subsUrl, { headers: serviceHeaders });
    if (!subsRes.ok) return jsonError('Error al obtener suscripciones', 500, request);
    const subscriptions = await subsRes.json();

    if (!subscriptions.length) return json({ ok: true, sent: 0 }, 200, request);

    const payload = JSON.stringify({ title, body: message, tag, url: targetUrl });
    let sent = 0;
    let removed = 0;
    const failed = [];

    // Send in batches of 5 concurrent pushes to avoid Worker timeout
    const BATCH_SIZE = 5;
    for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
      const batch = subscriptions.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(sub => sendWebPush(sub.endpoint, sub.p256dh, sub.auth, payload, env))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          sent++;
          continue;
        }
        const errMsg = result.reason?.message || '';
        const failedEndpoint = batch[j].endpoint;
        console.error('Push failed for', failedEndpoint, errMsg);
        failed.push(errMsg.slice(0, 80));
        // Si el endpoint ya no existe, eliminarlo
        if (errMsg.includes('410') || errMsg.includes('404')) {
          removed++;
          await fetch(
            `${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(failedEndpoint)}`,
            { method: 'DELETE', headers: serviceHeaders }
          );
        }
      }
    }

    // Resumen de entrega (sin textos ni direcciones) para saber si las notificaciones llegan.
    await logToSystem(env, {
      nivel: failed.length ? 'warn' : 'info',
      categoria: 'PUSH',
      mensaje: `Push enviado: ${sent} ok, ${failed.length} con error, ${removed} suscripciones retiradas`,
      usuario_id: operador.id,
      usuario_nombre: operador.nombre,
      meta: { tag: tag || null, destinos: subscriptions.length, sent, errores: failed.slice(0, 5), removed },
    }).catch(() => {});

    return json({ ok: true, sent, failed: failed.length }, 200, request);
  }

  return jsonError('Ruta push no encontrada', 404, request);
}
