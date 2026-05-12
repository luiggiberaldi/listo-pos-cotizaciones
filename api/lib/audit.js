// api/lib/audit.js

// ── System Logging ─────────────────────────────────────────────────────────
// Inserta logs persistentes en system_logs via service_role
export async function logToSystem(env, { nivel = 'error', origen = 'worker', categoria, mensaje, stack, endpoint, usuario_id, usuario_nombre, meta }) {
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

// Registra auditoría via REST
export async function registrarAuditoria(env, headers, { usuarioId, usuarioNombre, usuarioRol, categoria, accion, descripcion, entidadTipo, entidadId, meta, ip }) {
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
      ip_origen: ip || null,
    }),
  });
}
