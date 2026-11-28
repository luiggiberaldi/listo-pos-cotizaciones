// api/lib/portero.js
// Capa 2 de Auditoría 2.0 (OP-2026-110): "Portero" en la entrada del servidor.
// Registra en auditoria_peticiones toda mutación (POST/PUT/PATCH/DELETE) y todo
// intento denegado (401/403) o error (5xx), siempre en segundo plano (waitUntil).

const RUTAS_EXCLUIDAS = new Set([
  '/api/logs',
  '/api/clientes/lookup',
  '/api/ping',
])

export function debeRegistrarPortero(metodo, ruta, status) {
  if (RUTAS_EXCLUIDAS.has(ruta)) return false
  const esMutacion = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo)
  const esAlerta = status === 401 || status === 403 || status >= 500
  return esMutacion || esAlerta
}

export function clasificarResultadoPortero(status) {
  if (status === 401 || status === 403) return 'denegado'
  if (status >= 500) return 'error'
  return 'ok'
}

export async function registrarPeticionPortero(env, {
  operacionId,
  cuentaId = null,
  metodo,
  ruta,
  status,
  duracionMs = 0,
  usuarioId = null,
  usuarioNombre = null,
  usuarioRol = null,
  ip = null,
}) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_KEY) return
  if (!debeRegistrarPortero(metodo, ruta, status)) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria_peticiones`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        operacion_id: operacionId,
        cuenta_id: cuentaId || null,
        metodo,
        ruta,
        status,
        duracion_ms: Math.max(0, Math.round(duracionMs)),
        resultado: clasificarResultadoPortero(status),
        usuario_id: usuarioId || null,
        usuario_nombre: usuarioNombre || null,
        usuario_rol: usuarioRol || null,
        ip_origen: ip || null,
      }),
      signal: controller.signal,
    })
  } catch {
    /* observabilidad best-effort: nunca frena ni rompe la operación principal */
  } finally {
    clearTimeout(timer)
  }
}
