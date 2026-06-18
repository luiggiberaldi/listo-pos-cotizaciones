// api/lib/audit.js

// ── System Logging ─────────────────────────────────────────────────────────
// Inserta logs persistentes en system_logs via service_role
export async function logToSystem(env, { nivel = 'error', origen = 'worker', categoria, mensaje, stack, endpoint, usuario_id, usuario_nombre, meta }) {
  // Solo imprimir en consola para desarrollo/soporte en Cloudflare, evitando consumir espacio en Supabase
  const msg = `[SYSTEM_LOG:${nivel.toUpperCase()}] [${origen}] [${categoria}] ${mensaje}${stack ? `\nStack: ${stack}` : ''}${meta ? `\nMeta: ${JSON.stringify(meta)}` : ''}`;
  if (nivel === 'error') {
    console.error(msg);
  } else if (nivel === 'warn') {
    console.warn(msg);
  } else {
    console.log(msg);
  }
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
