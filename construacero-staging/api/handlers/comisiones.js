// api/handlers/comisiones.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { verifyAuth, validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

async function obtenerVendedoresConRol(env, headers, cuentaId, roles) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?cuenta_id=eq.${cuentaId}&rol=in.(${roles.join(',')})&select=id`,
    { headers }
  );
  if (!res.ok) return '00000000-0000-0000-0000-000000000000';
  const rows = await res.json();
  if (!rows.length) return '00000000-0000-0000-0000-000000000000';
  return rows.map(r => r.id).join(',');
}

function safeParam(val) {
  if (!val || val === 'null' || val === 'undefined' || val.trim() === '') return null;
  return val.trim();
}

function fechaEfectivaDespacho(despacho) {
  return despacho?.entregada_en_ajustada
    || despacho?.entregada_en
    || despacho?.despachada_en
    || despacho?.creado_en
    || null;
}

function filtrarFechaEfectiva(rows, desde, hasta, getDespacho) {
  const inicio = desde ? new Date(`${desde}T00:00:00-04:00`).getTime() : -Infinity;
  const fin = hasta ? new Date(`${hasta}T23:59:59.999-04:00`).getTime() : Infinity;
  return rows.filter(row => {
    const timestamp = new Date(fechaEfectivaDespacho(getDespacho(row)) || '').getTime();
    return Number.isFinite(timestamp) && timestamp >= inicio && timestamp <= fin;
  });
}

// Helper interno para unificar la lógica de filtros entre Lista y Resumen
function aplicarFiltrosComisiones(query, urlParams, user) {
  const vendedorId = safeParam(urlParams.get('vendedorId'))
  const estado = safeParam(urlParams.get('estado'))
  const desde = safeParam(urlParams.get('desde'))
  const hasta = safeParam(urlParams.get('hasta'))
  const despachoId = safeParam(urlParams.get('despachoId') || urlParams.get('despachoid'))

  const operatorRol = user.operator_rol
  const operatorId = user.operator_id
  const esSupervisor = ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(operatorRol)

  // 1. Aislamiento por Cuenta/Tenant
  query += `&cuentaid=eq.${user.id}`

  // 2. Filtro por Vendedor (según Rol)
  const filtroVendedor = esSupervisor ? (vendedorId || null) : operatorId
  if (filtroVendedor) {
    if (filtroVendedor === '00000000-0000-0000-0000-000000000000') {
      query += `&vendedorid=is.null`
    } else {
      query += `&vendedorid=eq.${filtroVendedor}`
    }
  }
  // 3. Filtro por Estado
  // Cuando se filtra por 'pendiente', incluir también 'cta_cobrar' porque tienen
  // montos liberados pendientes de pago que deben aparecer en la vista
  if (estado === 'pendiente') {
    query += `&estado=in.(pendiente,cta_cobrar)`
  } else if (estado) {
    query += `&estado=eq.${estado}`
  }

  // 4. La fecha efectiva se filtra después de leer el despacho. PostgREST no
  // puede expresar COALESCE(entregada_en_ajustada, entregada_en, ...)
  // de forma segura en este endpoint paginado.

  // 5. Filtro por Despacho ID
  if (despachoId) {
    query += `&despachoid=eq.${despachoId}`
  }

  return query
}

function csvIds(ids) {
  return [...new Set(ids.filter(Boolean))].join(',')
}

async function fetchByIds(env, headers, table, ids, select) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (!uniqueIds.length) return {}

  const CHUNK_SIZE = 50
  const chunks = []
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(i, i + CHUNK_SIZE))
  }

  const results = await Promise.all(
    chunks.map(async chunk => {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=in.(${chunk.join(',')})&select=${select}`, { headers })
      if (!res.ok) return []
      const rows = await res.json().catch(() => [])
      return Array.isArray(rows) ? rows : []
    })
  )

  const allRows = results.flat()
  return Object.fromEntries(allRows.map(row => [row.id, row]))
}

export async function handleMarcarComisionPagada(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  const ROLES_PAGO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_PAGO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden registrar pagos de comisiones', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body invalido', 400, request); }
  const comisionid = body.comisionid || body.comisionId;
  if (!comisionid || !isValidUuid(comisionid)) return jsonError('comisionid invalido', 400, request);

  try {
    // 1. Obtener la comisión actual para validar montos
    const actualRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&select=totalcomision,comision_liberada,comision_retenida,montopagado`, { headers });
    if (!actualRes.ok) {
      const err = await actualRes.text();
      return jsonError(`Error al leer comision: ${err}`, actualRes.status, request);
    }
    const [actual] = await actualRes.json();
    if (!actual) return jsonError('Comision no encontrada', 404, request);

    const comisionLiberada = Number(actual.comision_liberada || 0);
    const totalComision = Number(actual.totalcomision || 0);
    const comisionRetenida = Number(actual.comision_retenida || 0);
    const montopagadoPrev = Number(actual.montopagado || 0);

    let monto = Number(body.montopagado);
    if (body.montopagado == null) {
      // Si no se especifica monto, pagamos todo lo liberado hasta la fecha
      monto = comisionLiberada;
    }

    if (!Number.isFinite(monto) || monto < 0) {
      return jsonError('montopagado invalido', 400, request);
    }

    // Validar que el pago no supere lo liberado
    if (monto > comisionLiberada + 0.01) {
      return jsonError(`No se puede registrar un pago de ${monto} USD porque supera el monto liberado (${comisionLiberada} USD)`, 400, request);
    }

    if (monto < montopagadoPrev - 0.01) {
      return jsonError(`El nuevo monto pagado (${monto} USD) no puede ser inferior al monto ya pagado anteriormente (${montopagadoPrev} USD)`, 400, request);
    }

    // Determinar el nuevo estado
    let nuevoEstado = 'pendiente';
    if (comisionRetenida > 0.01) {
      nuevoEstado = 'cta_cobrar';
    } else if (monto >= comisionLiberada - 0.01) {
      nuevoEstado = 'pagada';
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&estado=in.(pendiente,cta_cobrar)&select=id,estado,montopagado`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        estado: nuevoEstado,
        montopagado: monto,
        pagadaen: nuevoEstado === 'pagada' ? new Date().toISOString() : null,
        pagadapor: nuevoEstado === 'pagada' ? operador.id : null,
        actualizadoen: new Date().toISOString()
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al registrar pago de comision: ${err}`, res.status, request);
    }

    const [comision] = await res.json();
    if (!comision) return jsonError('Comision no encontrada o ya pagada en su totalidad', 404, request);

    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'PAGAR_COMISION',
      entidadTipo: 'comision', entidadId: comisionid,
      meta: { montopagado: monto, estado_nuevo: nuevoEstado }, ip,
    });

    return json({ ok: true, comisionid, montopagado: monto, estado: nuevoEstado }, 200, request);
  } catch (e) {
    return jsonError(`Error critico de pago: ${e.message}`, 500, request);
  }
}

export async function handleLiberarComisionCxc(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  const ROLES_LIBERAR = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_LIBERAR.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden liberar comisiones CxC', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body invalido', 400, request); }
  const comisionid = body.comisionid || body.comisionId;
  if (!comisionid || !isValidUuid(comisionid)) return jsonError('comisionid invalido', 400, request);

  try {
    // 1. Obtener la comisión actual
    const actualRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&select=despachoid,vendedorid,cuentaid,totalcomision,comision_liberada,comision_retenida,montopagado,estado`, { headers });
    if (!actualRes.ok) {
      const err = await actualRes.text();
      return jsonError(`Error al leer comision: ${err}`, actualRes.status, request);
    }
    const [actual] = await actualRes.json();
    if (!actual) return jsonError('Comision no encontrada', 404, request);

    const totalComision = Number(actual.totalcomision || 0);
    const comisionRetenida = Number(actual.comision_retenida || 0);
    const montopagado = Number(actual.montopagado || 0);

    if (comisionRetenida <= 0.01) {
      return jsonError('Esta comisión no tiene monto CxC retenido para liberar', 400, request);
    }

    // 2. Fecha de aprobación real del despacho (para fechar el evento en su período)
    let fechaAprob = new Date().toISOString();
    if (actual.despachoid) {
      const despRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${actual.despachoid}&select=despachada_en,entregada_en,creado_en`, { headers });
      if (despRes.ok) {
        const [desp] = await despRes.json();
        if (desp) fechaAprob = desp.despachada_en || desp.entregada_en || desp.creado_en || fechaAprob;
      }
    }

    // 3. Liberar: todo lo retenido pasa a liberado
    const nuevoEstado = montopagado >= totalComision - 0.01 ? 'pagada' : 'pendiente';
    const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&estado=eq.cta_cobrar&select=id,estado`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        comision_liberada: totalComision,
        comision_retenida: 0,
        estado: nuevoEstado,
        pagadaen: nuevoEstado === 'pagada' ? new Date().toISOString() : null,
        pagadapor: nuevoEstado === 'pagada' ? operador.id : null,
        actualizadoen: new Date().toISOString()
      })
    });

    if (!patchRes.ok) {
      const err = await patchRes.text();
      return jsonError(`Error al liberar comision CxC: ${err}`, patchRes.status, request);
    }
    const [comision] = await patchRes.json();
    if (!comision) return jsonError('Comision no encontrada o ya liberada', 404, request);

    // 4. Registrar el evento de liberación manual, fechado a la aprobación
    await fetch(`${env.SUPABASE_URL}/rest/v1/comision_liberaciones`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        comision_id: comisionid,
        despacho_id: actual.despachoid,
        vendedor_id: actual.vendedorid,
        cuenta_id: actual.cuentaid,
        monto: comisionRetenida,
        tipo: 'manual',
        creado_en: fechaAprob
      })
    });

    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'LIBERAR_COMISION_CXC',
      entidadTipo: 'comision', entidadId: comisionid,
      meta: { monto_liberado: comisionRetenida, estado_nuevo: nuevoEstado }, ip,
    });

    return json({ ok: true, comisionid, monto_liberado: comisionRetenida, estado: nuevoEstado }, 200, request);
  } catch (e) {
    return jsonError(`Error critico al liberar comision CxC: ${e.message}`, 500, request);
  }
}

export async function handleActualizarEstadoComision(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  const ROLES_ESTADO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_ESTADO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden cambiar el estado de comisiones', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body invalido', 400, request); }
  const { comisionid, estado } = body;
  if (!comisionid || !isValidUuid(comisionid)) return jsonError('comisionid invalido', 400, request);
  if (!['pendiente', 'cta_cobrar'].includes(estado)) {
    return jsonError('estado invalido', 400, request);
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&select=id,estado`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        estado,
        actualizadoen: new Date().toISOString()
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al actualizar estado de comision: ${err}`, res.status, request);
    }

    const [comision] = await res.json();
    if (!comision) return jsonError('Comision no encontrada', 404, request);

    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'ACTUALIZAR_ESTADO_COMISION',
      entidadTipo: 'comision', entidadId: comisionid,
      meta: { estado_nuevo: estado }, ip,
    });

    return json({ ok: true, comisionid, estado }, 200, request);
  } catch (e) {
    return jsonError(`Error critico al actualizar estado de comision: ${e.message}`, 500, request);
  }
}

export async function handleGetComisionesConfig(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Consultar todas las columnas que existan sin select explícito
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return jsonError('Error al leer config comisiones', res.status, request);
  const rows = await res.json();
  return json(rows[0] || {}, 200, request);
}

export async function handleGetComisiones(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.max(1, Math.min(500, parseInt(url.searchParams.get('pageSize') || '100')));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const vista = url.searchParams.get('vista');
  const vendedorId = safeParam(url.searchParams.get('vendedorId'));
  const estado = safeParam(url.searchParams.get('estado'));
  const desde = safeParam(url.searchParams.get('desde'));
  const hasta = safeParam(url.searchParams.get('hasta'));

  const esSupervisor = ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(operador.rol);
  const operatorId = operador.id;

  if (vista === 'eventos') {
    let baseUrl = `${env.SUPABASE_URL}/rest/v1/comision_liberaciones?select=id,comision_id,despacho_id,vendedor_id,cuenta_id,monto,tipo,cxc_id,creado_en,comisiones:comisiones!inner(id,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,estado,montopagado,cotizacionid,despacho:notas_despacho(id,numero,total_usd,tasa_snapshot,creado_en,despachada_en,entregada_en,entregada_en_ajustada,cliente:clientes!notas_despacho_cliente_id_fkey(id,nombre,tipo_cliente),productos:notas_despacho_items(nombre_snap,codigo_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,origen,producto_id,producto:productos(categoria)))),vendedor:usuarios(id,nombre,color,markup_pct,rol,es_externo)&order=creado_en.desc`
    
    let query = baseUrl + `&cuenta_id=eq.${user.id}`

    const filtroVendedor = esSupervisor ? (vendedorId || null) : operatorId;
    if (filtroVendedor) {
      if (filtroVendedor === '00000000-0000-0000-0000-000000000000') {
        query += `&vendedor_id=is.null`
      } else {
        query += `&vendedor_id=eq.${filtroVendedor}`
      }
    }

    const res = await fetch(query, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Range': '0-4999',
        'Prefer': 'count=exact'
      },
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al obtener eventos de comision: ${err}`, 500, request);
    }

    const rawRows = await res.json();
    const allRows = filtrarFechaEfectiva(rawRows, desde, hasta, row => row.comisiones?.despacho);
    const rows = allRows.slice(from, to + 1);
    const cotizacionIds = rows.map(r => r.comisiones?.cotizacionid).filter(Boolean);
    const cotizaciones = await fetchByIds(env, headers, 'cotizaciones', cotizacionIds, 'id,numero,tasa_bcv_snapshot,cliente_id,cliente:clientes(id,nombre)');

    const data = rows.map(r => {
      const com = r.comisiones || {};
      const desp = com.despacho || {};
      const cot = cotizaciones[com.cotizacionid];
      return {
        id: r.id,
        monto: Number(r.monto || 0),
        tipo: r.tipo,
        creado_en: r.creado_en,
        comisiones: {
          id: com.id,
          totalcomision: Number(com.totalcomision || 0),
          comisioncabilla: Number(com.comisioncabilla || 0),
          comisionotros: Number(com.comisionotros || 0),
          pctcabilla: Number(com.pctcabilla || 0),
          pctotros: Number(com.pctotros || 0),
          estado: com.estado,
          montopagado: Number(com.montopagado || 0),
          despacho: desp ? {
            id: desp.id,
            numero: desp.numero,
            totalusd: desp.total_usd,
            tasa_snapshot: desp.tasa_snapshot,
            cliente: desp.cliente,
            productos: desp.productos
          } : null,
          cotizacion: cot ? {
            id: cot.id,
            numero: cot.numero,
            tasa_bcv_snapshot: cot.tasa_bcv_snapshot,
            cliente_nombre: cot.cliente?.nombre || null
          } : null
        },
        vendedor: r.vendedor
      };
    });

    const total = allRows.length;

    return json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }, 200, request);
  }

  // split:calculo_evidencia->split_cliente_ajeno identifica filas del split (v2 y v3/designado)
  let baseUrl = `${env.SUPABASE_URL}/rest/v1/comisiones?select=id,despachoid,vendedorid,cotizacionid,cuentaid,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,montopagado,comision_liberada,comision_retenida,estado,pagadaen,pagadapor,creadoen,actualizadoen,split:calculo_evidencia->>split_cliente_ajeno,designado_ev:calculo_evidencia->>split_designado_id,despacho:notas_despacho!inner(creado_en,despachada_en,entregada_en,entregada_en_ajustada)&order=creadoen.desc`
  
  const userContext = { ...user, operator_rol: operador.rol, operator_id: operador.id };
  let query = aplicarFiltrosComisiones(baseUrl, url.searchParams, userContext)

  const res = await fetch(query, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Range': '0-4999',
      'Prefer': 'count=exact'
    },
  })

  if (!res.ok) {
    const err = await res.text()
    return jsonError(`Error al obtener comisiones: ${err}`, 500, request)
  }

  const rawRows = await res.json()
  const allRows = filtrarFechaEfectiva(rawRows, desde, hasta, row => row.despacho)
  const rows = allRows.slice(from, to + 1)
  const despachos = await fetchByIds(env, headers, 'notas_despacho', rows.map(c => c.despachoid), 'id,numero,total_usd,tasa_snapshot,entregada_en,entregada_en_ajustada,despachada_en,creado_en,vendedor_id,cliente_id,cliente:clientes!notas_despacho_cliente_id_fkey(id,nombre),productos:notas_despacho_items(nombre_snap,codigo_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,origen,producto_id,producto:productos(categoria))')
  const cotizaciones = await fetchByIds(env, headers, 'cotizaciones', rows.map(c => c.cotizacionid), 'id,numero,tasa_bcv_snapshot,cliente_id,cliente:clientes(id,nombre)')
  const vendedores = await fetchByIds(env, headers, 'usuarios', rows.map(c => c.vendedorid), 'id,nombre,color,markup_pct,rol,es_externo')

  // Designaciones del día (v3): mapa fecha → designado_id para derivar el tipo de fila
  const fechasDespachos = [...new Set(rows
    .filter(c => c.split === true || c.split === 'true')
    .map(c => (despachos[c.despachoid]?.creado_en || '').slice(0, 10))
    .filter(Boolean))]
  const designacionPorFecha = {}
  if (fechasDespachos.length) {
    try {
      const desigRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/comision_designacion_diaria?cuenta_id=eq.${user.id}&fecha=in.(${fechasDespachos.map(f => `"${f}"`).join(',')})&select=fecha,designado_id`,
        { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      );
      if (desigRes.ok) {
        for (const d of await desigRes.json()) designacionPorFecha[d.fecha] = d.designado_id;
      }
    } catch { /* si falla, las filas split caen a 'cliente_ajeno_dueno' */ }
  }

  const data = rows.map(c => {
    const despacho = despachos[c.despachoid]
    const cotizacion = cotizaciones[c.cotizacionid]
    const esSplit = c.split === true || c.split === 'true'
    let tipo = 'venta'
    if (esSplit) {
      const fechaDespacho = (despacho?.creado_en || '').slice(0, 10)
      const designadoDelDia = c.designado_ev || designacionPorFecha[fechaDespacho] || null
      tipo = (designadoDelDia && c.vendedorid === designadoDelDia)
        ? 'designado'
        : 'cliente_ajeno_dueno'
    }
    return {
      id: c.id,
      despachoid: c.despachoid,
      vendedorid: c.vendedorid,
      tipo,
      cotizacionid: c.cotizacionid,
      cuentaid: c.cuentaid,
      totalcomision: c.totalcomision,
      comisioncabilla: c.comisioncabilla,
      comisionotros: c.comisionotros,
      pctcabilla: c.pctcabilla,
      pctotros: c.pctotros,
      montopagado: c.montopagado,
      comision_liberada: c.comision_liberada,
      comision_retenida: c.comision_retenida,
      estado: c.estado,
      pagadaen: c.pagadaen,
      pagadapor: c.pagadapor,
      creadoen: c.creadoen,
      vendedor: vendedores[c.vendedorid] || { id: null, nombre: 'Sin vendedor asignado', color: '#94a3b8' },
      despacho: despacho ? { 
        id: despacho.id, 
        numero: despacho.numero, 
        totalusd: despacho.total_usd, 
        tasa_snapshot: despacho.tasa_snapshot,
        cliente_nombre: despacho.cliente?.nombre || null,
        productos: despacho.productos
      } : null,
      cotizacion: cotizacion ? {
        id: cotizacion.id,
        numero: cotizacion.numero,
        tasa_bcv_snapshot: cotizacion.tasa_bcv_snapshot,
        cliente_nombre: cotizacion.cliente?.nombre || null
      } : null
    }
  })
  
  const total = allRows.length;

  return json({
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }, 200, request)
}

export async function handleGetComisionesResumen(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador } = v;

  const url = new URL(request.url);

  try {
    const headers = {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    };
    const vendedorId = safeParam(url.searchParams.get('vendedorId'));
    const estado = safeParam(url.searchParams.get('estado'));
    const desde = safeParam(url.searchParams.get('desde'));
    const hasta = safeParam(url.searchParams.get('hasta'));

    const esSupervisor = ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(operador.rol);
    const filtroVendedor = esSupervisor ? (vendedorId || null) : operador.id;

    const rpcBody = {
      p_cuenta_id: user.id,
      p_vendedor_id: filtroVendedor,
      p_estado: estado,
      p_fecha_inicio: desde ? `${desde}T00:00:00-04:00` : null,
      p_fecha_fin: hasta ? `${hasta}T23:59:59-04:00` : null
    };

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/obtener_resumen_comisiones_v2`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rpcBody)
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al obtener resumen de comisiones: ${err}`, 500, request);
    }

    const rows = await res.json();
    const r = rows[0] || {};

    // ── CONSULTA SECUNDARIA: desglose de saldo pendiente (Regular vs CxC) ─────
    // Se incluye despacho:notas_despacho!inner(creado_en) para que el filtro de fecha use la fecha del despacho
    let queryBreakdown = `${env.SUPABASE_URL}/rest/v1/comisiones?select=estado,totalcomision,comision_liberada,montopagado,despacho:notas_despacho!inner(creado_en,despachada_en,entregada_en,entregada_en_ajustada)&estado=in.(pendiente,cta_cobrar)`;
    const userContext = { ...user, operator_rol: operador.rol, operator_id: operador.id };
    queryBreakdown = aplicarFiltrosComisiones(queryBreakdown, url.searchParams, userContext);

    let pendienteRegular = 0;
    let pendienteCxc = 0;

    try {
      const breakdownRes = await fetch(queryBreakdown, { headers });
      if (breakdownRes.ok) {
        const breakdownRows = await breakdownRes.json();
        const items = filtrarFechaEfectiva(breakdownRows, desde, hasta, row => row.despacho);
        for (const item of items) {
          const m = item.estado === 'cta_cobrar' ? Number(item.comision_liberada || 0) : Number(item.totalcomision || 0);
          const saldo = Math.max(0, m - Number(item.montopagado || 0));
          if (item.estado === 'cta_cobrar') {
            pendienteCxc += saldo;
          } else {
            pendienteRegular += saldo;
          }
        }
      } else {
        console.error('[ResumenComisiones] Error fetching breakdown:', await breakdownRes.text());
      }
    } catch (eBreakdown) {
      console.error('[ResumenComisiones] Exception in breakdown:', eBreakdown);
    }

    return json({
      totalAcumulado: Number(r.totalacumulado || 0),
      pendientePago: Number(r.pendientepago || 0),
      yaPagado: Number(r.yapagado || 0),
      numPendientes: Number(r.numpendientes || 0),
      numPagadas: Number(r.numpagadas || 0),
      total: Number(r.total || 0),
      pendienteRegular,
      pendienteCxc,
    }, 200, request);

  } catch (e) {
    return jsonError(`Error en agregación: ${e.message}`, 500, request);
  }
}
