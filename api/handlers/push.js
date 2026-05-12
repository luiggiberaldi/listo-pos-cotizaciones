// api/handlers/push.js
import { json, jsonError, corsHeaders, isRateLimited } from '../lib/utils.js'
import { verifyAuth } from '../lib/auth.js'
import { sendWebPush } from '../lib/webpush.js'

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
