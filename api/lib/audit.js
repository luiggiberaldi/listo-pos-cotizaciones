// api/lib/audit.js

// ── System Logging ─────────────────────────────────────────────────────────
const LOG_TIMEOUT_MS = 2000

function fetchWithTimeout(url, options = {}, timeoutMs = LOG_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

export async function logToSystem(env, { nivel = 'error', origen = 'worker', categoria, mensaje, stack, endpoint, usuario_id, usuario_nombre, meta }) {
  const msg = `[SYSTEM_LOG:${nivel.toUpperCase()}] [${origen}] [${categoria}] ${mensaje}${stack ? `\\nStack: ${stack}` : ''}${meta ? `\\nMeta: ${JSON.stringify(meta)}` : ''}`
  if (nivel === 'error') console.error(msg)
  else if (nivel === 'warn') console.warn(msg)
  else console.log(msg)

  // El logging nunca debe bloquear la operación principal.
  if (!env.SUPABASE_SERVICE_KEY || !env.SUPABASE_URL) return
  try {
    await fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/system_logs`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ nivel, origen, categoria, mensaje: String(mensaje || '').slice(0, 2000), stack: stack ? String(stack).slice(0, 5000) : null, endpoint: endpoint || null, usuario_id: usuario_id || null, usuario_nombre: usuario_nombre || null, meta: meta || {} }),
    })
  } catch { /* observabilidad best-effort */ }
}

// Registra auditoría vía REST con timeout; seguro y best-effort (no bloquea)
//
// OP-2026-050 (portado en OP-2026-059): "la auditoría debe registrar todo". Si la base RECHAZA la
// anotación (por ejemplo, una categoría que no está en su lista), se guarda de nuevo con categoría
// SISTEMA y la categoría original en meta, para que la acción nunca se pierda. Antes, devoluciones,
// descuentos, vehículos y configuración nunca quedaron anotados porque usaban categorías no aceptadas.
export async function registrarAuditoria(env, headers, { usuarioId, usuarioNombre, usuarioRol, categoria, accion, descripcion, entidadTipo, entidadId, meta, ip }, { timeoutMs = 4000 } = {}) {
  // Un registro de auditoría rechazado o perdido NUNCA se traga en silencio:
  // queda un aviso en los logs del sistema (console + system_logs). Sin este
  // aviso, el bug del enum categoria_auditoria ('FINANZAS' faltante, 2026-10)
  // estuvo meses sin que nadie lo notara.
  const avisar = (mensaje, extra = {}) => logToSystem(env, {
    nivel: 'error',
    origen: 'auditoria',
    categoria: categoria || 'SISTEMA',
    mensaje,
    endpoint: '/rest/v1/auditoria',
    usuario_id: usuarioId || null,
    usuario_nombre: usuarioNombre || null,
    meta: { accion: accion || null, categoria: categoria || null, entidadTipo: entidadTipo || null, entidadId: entidadId || null, ...extra },
  })
  const fila = (cat, extraMeta = null, prefijo = '') => JSON.stringify({
    usuario_id: usuarioId,
    usuario_nombre: usuarioNombre,
    usuario_rol: usuarioRol,
    categoria: cat,
    accion,
    descripcion: descripcion ? `${prefijo}${descripcion}` : (prefijo || null),
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    meta: extraMeta ? { ...(meta || {}), ...extraMeta } : (meta || null),
    ip_origen: ip || null,
  })
  try {
    const response = await fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
      method: 'POST',
      headers,
      body: fila(categoria),
    }, timeoutMs)
    if (!response.ok) {
      const detalle = await response.text().catch(() => '')
      // Rescate: misma anotación con categoría SISTEMA (siempre aceptada).
      let rescatada = false
      if (categoria !== 'SISTEMA') {
        try {
          const r2 = await fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
            method: 'POST',
            headers,
            body: fila('SISTEMA', { categoria_original: categoria || null, auditoria_rechazo: String(detalle).slice(0, 300) }, `[Categoría ${categoria} rechazada] `),
          }, timeoutMs)
          rescatada = r2.ok
        } catch { rescatada = false }
      }
      await avisar(`Auditoría RECHAZADA (${response.status}) acción=${accion} categoría=${categoria}${rescatada ? ' — guardada como SISTEMA' : ' — NO se pudo rescatar'}: ${String(detalle).slice(0, 300)}`, { status: response.status, rescatada })
    }
    return response
  } catch (err) {
    await avisar(`Auditoría SIN REGISTRAR (error de red/timeout) acción=${accion} categoría=${categoria}: ${err?.message || err}`)
    return null
  }
}
