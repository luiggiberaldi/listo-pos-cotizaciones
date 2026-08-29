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

// Registra auditoría vía REST con timeout; el caller decide si espera o la agenda en background.
export async function registrarAuditoria(env, headers, { usuarioId, usuarioNombre, usuarioRol, categoria, accion, descripcion, entidadTipo, entidadId, meta, ip }, { timeoutMs = 2000 } = {}) {
  const response = await fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ usuario_id: usuarioId, usuario_nombre: usuarioNombre, usuario_rol: usuarioRol, categoria, accion, descripcion: descripcion || null, entidad_tipo: entidadTipo, entidad_id: entidadId, meta: meta || null, ip_origen: ip || null }),
  }, timeoutMs)
  if (!response.ok) throw new Error(`auditoria_http_${response.status}`)
  return response
}
