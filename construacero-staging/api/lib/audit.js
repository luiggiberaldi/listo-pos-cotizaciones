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
//
// OP-2026-050: "la auditoría debe registrar todo". Si la base RECHAZA la anotación
// (por ejemplo, una categoría que no está en su lista), se guarda de nuevo con
// categoría SISTEMA y la categoría original en meta, para que la acción nunca se
// pierda. Antes, devoluciones, descuentos, vehículos y configuración nunca quedaron
// anotados porque usaban categorías no aceptadas, y nadie se enteró.
export async function registrarAuditoria(env, headers, { usuarioId, usuarioNombre, usuarioRol, categoria, accion, descripcion, entidadTipo, entidadId, meta, ip }) {
  const fila = (cat, extraMeta = null, prefijo = '') => JSON.stringify({
    usuario_id: usuarioId,
    usuario_nombre: usuarioNombre,
    usuario_rol: usuarioRol,
    categoria: cat,
    accion: accion,
    descripcion: descripcion ? `${prefijo}${descripcion}` : (prefijo || null),
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    meta: extraMeta ? { ...(meta || {}), ...extraMeta } : (meta || null),
    ip_origen: ip || null,
  });
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
      method: 'POST',
      headers,
      body: fila(categoria),
    });
    if (!response.ok) {
      const detalle = await response.text().catch(() => '');
      // Rescate: misma anotación con categoría SISTEMA (siempre aceptada).
      let rescatada = false;
      if (categoria !== 'SISTEMA') {
        try {
          const r2 = await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
            method: 'POST',
            headers,
            body: fila('SISTEMA', { categoria_original: categoria || null, auditoria_rechazo: String(detalle).slice(0, 300) }, `[Categoría ${categoria} rechazada] `),
          });
          rescatada = r2.ok;
        } catch { rescatada = false; }
      }
      await logToSystem(env, {
        nivel: 'error',
        origen: 'auditoria',
        categoria: categoria || 'SISTEMA',
        mensaje: `Auditoría RECHAZADA (${response.status}) acción=${accion} categoría=${categoria}${rescatada ? ' — guardada como SISTEMA' : ' — NO se pudo rescatar'}: ${String(detalle).slice(0, 300)}`,
        endpoint: '/rest/v1/auditoria',
        usuario_id: usuarioId || null,
        usuario_nombre: usuarioNombre || null,
        meta: { accion: accion || null, status: response.status, rescatada },
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
