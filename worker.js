// worker.js
// Cloudflare Worker — sirve assets estáticos + API proxy para operaciones admin
// Las operaciones admin (crear/editar/eliminar usuarios) se manejan aquí
// para mantener el service_role key fuera del frontend.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── API routes para operaciones admin ──────────────────────────────────
    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdmin(request, env, url);
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

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message, status = 400) {
  return json({ error: message }, status);
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
    return jsonError('Method not allowed', 405);
  }

  // Verificar que las secrets estén configuradas
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonError('Server misconfigured: missing Supabase secrets', 500);
  }

  // Autenticar usuario
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401);

  // Verificar que es supervisor
  const isSupervisor = await verifySupervisor(user.id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403);

  // Parsear body
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const route = url.pathname.replace('/api/admin/', '');

  // ── Crear usuario ─────────────────────────────────────────────────────
  if (route === 'users' && request.method === 'POST') {
    const { email, password, nombre, rol } = body;
    if (!email || !password || !nombre || !rol) {
      return jsonError('Faltan campos: email, password, nombre, rol');
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
        return jsonError('Ya existe un usuario con ese email', 409);
      }
      return jsonError(msg, authRes.status);
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
      return jsonError('Error al insertar en tabla usuarios', 500);
    }

    return json({ id: authData.id, ok: true }, 201);
  }

  // ── Actualizar usuario (nombre, rol, PIN) ─────────────────────────────
  if (route.startsWith('users/') && request.method === 'PUT') {
    const userId = route.replace('users/', '');
    const { nombre, rol, pin } = body;

    // Actualizar en public.usuarios
    if (nombre || rol) {
      const updateData = {};
      if (nombre) updateData.nombre = nombre.trim();
      if (rol) updateData.rol = rol;

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
      if (!dbRes.ok) return jsonError('Error al actualizar usuario', 500);
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
      if (!authRes.ok) return jsonError('Error al cambiar PIN', 500);
    }

    return json({ ok: true });
  }

  // ── Eliminar usuario ──────────────────────────────────────────────────
  if (route.startsWith('users/') && request.method === 'DELETE') {
    const userId = route.replace('users/', '');

    // Eliminar de public.usuarios primero
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

    if (!authRes.ok) return jsonError('Error al eliminar usuario de auth', 500);

    return json({ ok: true });
  }

  return jsonError('Ruta no encontrada', 404);
}
