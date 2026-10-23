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

// Registra auditoría via REST; best-effort pero SIN fallos silenciosos: si la
// base de datos rechaza el registro o la red falla, queda un aviso en los logs
// (mismo endurecimiento que api/lib/audit.js del principal, 2026-10-23).
export async function registrarAuditoria(env, headers, { usuarioId, usuarioNombre, usuarioRol, categoria, accion, descripcion, entidadTipo, entidadId, meta, ip }) {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
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
    if (!response.ok) {
      const detalle = await response.text().catch(() => '');
      await logToSystem(env, {
        nivel: 'error',
        origen: 'auditoria',
        categoria: categoria || 'SISTEMA',
        mensaje: `Auditoría RECHAZADA (${response.status}) acción=${accion} categoría=${categoria}: ${String(detalle).slice(0, 300)}`,
        endpoint: '/rest/v1/auditoria',
        usuario_id: usuarioId || null,
        usuario_nombre: usuarioNombre || null,
        meta: { accion: accion || null, status: response.status },
      });
    }
    return response;
  } catch (err) {
    await logToSystem(env, {
      nivel: 'error',
      origen: 'auditoria',
      categoria: categoria || 'SISTEMA',
      mensaje: `Auditoría SIN REGISTRAR (error de red) acción=${accion} categoría=${categoria}: ${err?.message || err}`,
      endpoint: '/rest/v1/auditoria',
      meta: { accion: accion || null },
    });
    return null;
  }
}
