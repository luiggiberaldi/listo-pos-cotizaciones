// api/handlers/clientes.js
import { json, jsonError, corsHeaders, isRateLimited, sanitizeSearch, isValidUuid } from '../lib/utils.js'
import { verifyAuth, validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

export async function handleCheckRif(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const url = new URL(request.url);
  const rif = url.searchParams.get('rif');
  const exclude = url.searchParams.get('exclude');
  if (!rif) return json({ existe: false }, 200, request);

  let queryUrl = `${env.SUPABASE_URL}/rest/v1/clientes?rif_cedula=eq.${encodeURIComponent(rif)}&activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,vendedor:usuarios!clientes_vendedor_id_fkey(nombre)&limit=1`;
  if (exclude) queryUrl += `&id=neq.${encodeURIComponent(exclude)}`;

  const res = await fetch(queryUrl, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return json({ existe: false }, 200, request);

  const data = await res.json();
  if (data.length === 0) return json({ existe: false }, 200, request);

  const c = data[0];
  return json({
    existe: true,
    nombre: c.nombre,
    vendedor: c.vendedor?.nombre || 'Sin vendedor',
  }, 200, request);
}

export async function handleListarClientes(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const url = new URL(request.url);
  const busqueda = url.searchParams.get('busqueda') || '';

  // Fetch ALL active clients — filtrado en el Worker (in-memory, rápido)
  // limit=10000 evita el tope de 1000 filas de PostgREST
  // Fetch ALL clients (incluyendo inactivos) — filtrado en el Worker
  const baseUrl = `${env.SUPABASE_URL}/rest/v1/clientes?cuenta_id=eq.${user.id}&order=nombre.asc&limit=10000&select=id,nombre,rif_cedula,telefono,email,direccion,estado,ciudad,notas,tipo_cliente,activo,vendedor_id,saldo_pendiente,vendedor:usuarios!clientes_vendedor_id_fkey(id,nombre,color)`;

  const supaHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };

  const res = await fetch(baseUrl, { headers: supaHeaders });
  if (!res.ok) {
    const errText = await res.text();
    return jsonError(`Error al cargar clientes: ${errText}`, res.status, request);
  }

  let data = await res.json();

  if (busqueda.trim()) {
    const raw  = busqueda.trim().toLowerCase();
    const norm = raw.replace(/[\.\-\(\)\s\/\\]/g, '');

    data = data.filter(c => {
      const nombre = (c.nombre    || '').toLowerCase();
      const rif    = (c.rif_cedula|| '').toLowerCase().replace(/[\.\-\(\)\s\/\\]/g, '');
      const tel    = (c.telefono  || '').toLowerCase().replace(/[\.\-\(\)\s\/\\]/g, '');
      const email  = (c.email     || '').toLowerCase();

      return (
        nombre.includes(raw)  ||
        rif.includes(norm)    ||
        tel.includes(norm)    ||
        email.includes(raw)
      );
    });
  }

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ── Lookup clientes by IDs (service key, bypasses RLS) ──────────────────────
export async function handleClientesLookup(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const { ids } = await request.json();
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) {
    return jsonError('ids debe ser un array de 1-200 UUIDs', 400, request);
  }

  const queryUrl = `${env.SUPABASE_URL}/rest/v1/clientes?id=in.(${ids.map(encodeURIComponent).join(',')})&cuenta_id=eq.${user.id}&select=id,nombre,rif_cedula,telefono,email,direccion,estado,ciudad,tipo_cliente,vendedor_id,vendedor:usuarios!clientes_vendedor_id_fkey(id,nombre,color)`;

  const res = await fetch(queryUrl, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });

  if (!res.ok) {
    return jsonError('Error al buscar clientes', res.status, request);
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

export async function handleReasignarCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // ── Solo supervisores y administración pueden reasignar clientes ────────────
  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('Solo supervisores y administración pueden reasignar clientes', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { clienteId, nuevoVendedorId, motivo } = body;
  if (!clienteId || !nuevoVendedorId) return jsonError('Faltan campos', 400, request);
  if (!isValidUuid(clienteId) || !isValidUuid(nuevoVendedorId)) return jsonError('IDs inválidos', 400, request);
  const motivoFinal = (motivo || '').trim() || null;

  try {
    // 1. Obtener cliente
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&activo=eq.true&select=id,nombre,vendedor_id`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado o inactivo', 404, request);
    if (cliente.vendedor_id === nuevoVendedorId) return jsonError('El cliente ya pertenece a ese vendedor', 400, request);

    // 2. Validar vendedor destino
    const vRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${nuevoVendedorId}&activo=eq.true&select=id`, { headers });
    const [vendDest] = await vRes.json();
    if (!vendDest) return jsonError('Vendedor destino no encontrado o inactivo', 400, request);

    // 3. Actualizar cliente
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        vendedor_id: nuevoVendedorId,
        ultima_reasig_por: user.operator_id,
        ultima_reasig_motivo: motivoFinal,
        ultima_reasig_en: new Date().toISOString(),
        actualizado_en: new Date().toISOString(),
      }),
    });

    // 4. Insertar registro de reasignación
    await fetch(`${env.SUPABASE_URL}/rest/v1/reasignaciones_clientes`, {
      method: 'POST', headers,
      body: JSON.stringify({
        cliente_id: clienteId,
        vendedor_origen: cliente.vendedor_id,
        vendedor_destino: nuevoVendedorId,
        supervisor_id: user.operator_id,
        motivo: motivoFinal,
      }),
    });

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'REASIGNACION', accion: 'REASIGNAR_CLIENTE',
      descripcion: `Cliente "${cliente.nombre}" reasignado${motivoFinal ? `. Motivo: ${motivoFinal}` : ''}`,
      entidadTipo: 'cliente', entidadId: clienteId,
      meta: { vendedor_origen: cliente.vendedor_id, vendedor_destino: nuevoVendedorId, motivo: motivoFinal }, ip,
    });

    return json({ ok: true }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al reasignar cliente', 500, request);
  }
}

export async function handleBorrarCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { id } = body;
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request);

  // Verificar que el cliente pertenece a este tenant
  const cRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}&select=id,nombre,saldo_pendiente,activo&limit=1`,
    { headers }
  );
  const [cliente] = await cRes.json();
  if (!cliente) return jsonError('Cliente no encontrado', 404, request);

  // NIVEL 3: Deuda activa → bloqueo total
  if (Number(cliente.saldo_pendiente || 0) > 0) {
    return jsonError(
      `No se puede eliminar "${cliente.nombre}" porque tiene una deuda pendiente de $${Number(cliente.saldo_pendiente).toFixed(2)}. Sáldale la deuda primero.`,
      409,
      request
    );
  }

  // NIVEL 2: ¿Tiene cotizaciones o despachos? → solo desactivar
  const [cotRes, ndRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?cliente_id=eq.${id}&select=id&limit=1`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?cliente_id=eq.${id}&select=id&limit=1`, { headers }),
  ]);
  const cots = await cotRes.json();
  const nds  = await ndRes.json();
  const tieneHistorial = (Array.isArray(cots) && cots.length > 0) || (Array.isArray(nds) && nds.length > 0);

  if (tieneHistorial) {
    // Solo desactivar — preservar integridad histórica
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() }),
    });
    return json({ accion: 'desactivado', nombre: cliente.nombre }, 200, request);
  }

  // NIVEL 1: Sin historial → borrado físico real
  const delRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=minimal' },
  });

  if (!delRes.ok && delRes.status !== 204) {
    const err = await delRes.text();
    return jsonError(`Error al borrar cliente: ${err}`, delRes.status, request);
  }

  return json({ accion: 'eliminado', nombre: cliente.nombre }, 200, request);
}

export async function handleCrearCliente(request, env) {

  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { nombre, rif_cedula, telefono, email, direccion, estado, ciudad, notas, tipo_cliente, vendedor_id } = body;
  if (!nombre?.trim()) return jsonError('El nombre es obligatorio', 400, request);

  // Verificar duplicado de RIF si se proporciona
  if (rif_cedula?.trim()) {
    const checkUrl = `${env.SUPABASE_URL}/rest/v1/clientes?rif_cedula=eq.${encodeURIComponent(rif_cedula.trim())}&activo=eq.true&cuenta_id=eq.${user.id}&select=id&limit=1`;
    const checkRes = await fetch(checkUrl, { headers });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) return jsonError('Ya existe un cliente con ese RIF/cédula', 409, request);
    }
  }

  const payload = {
    nombre: nombre.trim(),
    rif_cedula: rif_cedula?.trim() || null,
    telefono: telefono?.trim() || null,
    email: email?.trim() || null,
    direccion: direccion?.trim() || null,
    estado: estado?.trim() || null,
    ciudad: ciudad?.trim() || null,
    notas: notas?.trim() || null,
    tipo_cliente: tipo_cliente || 'natural',
    vendedor_id: vendedor_id || operador.id,
    cuenta_id: user.id,
    activo: true,
  };

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error al crear cliente: ${err}`, res.status, request);
  }

  const [data] = await res.json();
  return json(data, 201, request);
}

export async function handleActualizarCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { id, nombre, rif_cedula, telefono, email, direccion, estado, ciudad, notas, tipo_cliente } = body;
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request);
  if (!nombre?.trim()) return jsonError('El nombre es obligatorio', 400, request);

  // Verificar duplicado de RIF excluyendo este cliente
  if (rif_cedula?.trim()) {
    const checkUrl = `${env.SUPABASE_URL}/rest/v1/clientes?rif_cedula=eq.${encodeURIComponent(rif_cedula.trim())}&activo=eq.true&cuenta_id=eq.${user.id}&id=neq.${id}&select=id&limit=1`;
    const checkRes = await fetch(checkUrl, { headers });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) return jsonError('Ya existe un cliente con ese RIF/cédula', 409, request);
    }
  }

  const payload = {
    nombre: nombre.trim(),
    rif_cedula: rif_cedula?.trim() || null,
    telefono: telefono?.trim() || null,
    email: email?.trim() || null,
    direccion: direccion?.trim() || null,
    estado: estado?.trim() || null,
    ciudad: ciudad?.trim() || null,
    notas: notas?.trim() || null,
    tipo_cliente: tipo_cliente || 'natural',
    actualizado_en: new Date().toISOString(),
  };

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error al actualizar cliente: ${err}`, res.status, request);
  }

  const [data] = await res.json();
  return json(data, 200, request);
}

export async function handleActivarCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { id } = body;
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ activo: true, actualizado_en: new Date().toISOString() }),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error al activar cliente: ${err}`, res.status, request);
  }

  const [data] = await res.json();
  return json(data, 200, request);
}

export async function handleReasignarClientesBulk(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // ── Solo supervisores y administración pueden reasignar masivamente ─────────
  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('Solo supervisores y administración pueden reasignar clientes', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { vendedorOrigenId, vendedorDestinoId, motivo } = body;
  if (!vendedorOrigenId || !vendedorDestinoId) return jsonError('Faltan campos: vendedorOrigenId, vendedorDestinoId', 400, request);
  if (!isValidUuid(vendedorOrigenId) || !isValidUuid(vendedorDestinoId)) return jsonError('IDs inválidos', 400, request);
  if (vendedorOrigenId === vendedorDestinoId) return jsonError('El origen y destino no pueden ser el mismo usuario', 400, request);
  const motivoFinal = (motivo || '').trim() || 'Reasignación masiva';

  try {
    // 1. Validar vendedor destino
    const vRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${vendedorDestinoId}&activo=eq.true&select=id,nombre`, { headers });
    const [vendDest] = await vRes.json();
    if (!vendDest) return jsonError('Vendedor destino no encontrado o inactivo', 400, request);

    // 2. Obtener todos los clientes del origen (solo de este tenant)
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?vendedor_id=eq.${vendedorOrigenId}&cuenta_id=eq.${user.id}&select=id,nombre,vendedor_id`, { headers });
    const clientes = await cRes.json();
    if (!Array.isArray(clientes) || clientes.length === 0) return json({ ok: true, reasignados: 0, mensaje: 'Este vendedor no tiene clientes' }, 200, request);

    const ahora = new Date().toISOString();

    // 3. Actualizar todos los clientes en bulk (solo de este tenant)
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?vendedor_id=eq.${vendedorOrigenId}&cuenta_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        vendedor_id: vendedorDestinoId,
        ultima_reasig_por: user.operator_id,
        ultima_reasig_motivo: motivoFinal,
        ultima_reasig_en: ahora,
        actualizado_en: ahora,
      }),
    });

    // 4. Registrar en reasignaciones_clientes (una por cliente)
    const registros = clientes.map(c => ({
      cliente_id: c.id,
      vendedor_origen: vendedorOrigenId,
      vendedor_destino: vendedorDestinoId,
      supervisor_id: user.operator_id,
      motivo: motivoFinal,
    }));
    await fetch(`${env.SUPABASE_URL}/rest/v1/reasignaciones_clientes`, {
      method: 'POST', headers,
      body: JSON.stringify(registros),
    });

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'REASIGNACION', accion: 'REASIGNAR_CLIENTES_BULK',
      descripcion: `${clientes.length} clientes reasignados de vendedor ${vendedorOrigenId} a ${vendDest.nombre}. Motivo: ${motivoFinal}`,
      entidadTipo: 'usuario', entidadId: vendedorOrigenId,
      meta: { vendedor_origen: vendedorOrigenId, vendedor_destino: vendedorDestinoId, total: clientes.length, motivo: motivoFinal }, ip,
    });

    return json({ ok: true, reasignados: clientes.length }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al reasignar clientes', 500, request);
  }
}
