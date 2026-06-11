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

// Helper interno para unificar la lógica de filtros entre Lista y Resumen
function aplicarFiltrosComisiones(query, urlParams, user) {
  const vendedorId = safeParam(urlParams.get('vendedorId'))
  const estado = safeParam(urlParams.get('estado'))
  const desde = safeParam(urlParams.get('desde'))
  const hasta = safeParam(urlParams.get('hasta'))

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
  if (estado) {
    query += `&estado=eq.${estado}`
  }

  // 4. Filtro por Fechas (Día Completo - Zona Horaria Venezuela UTC-4)
  if (desde) query += `&creadoen=gte.${desde}T00:00:00-04:00`
  if (hasta) query += `&creadoen=lte.${hasta}T23:59:59-04:00`

  return query
}

function csvIds(ids) {
  return [...new Set(ids.filter(Boolean))].join(',')
}

async function fetchByIds(env, headers, table, ids, select) {
  const idsCsv = csvIds(ids)
  if (!idsCsv) return {}

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=in.(${idsCsv})&select=${select}`, { headers })
  if (!res.ok) return {}

  const rows = await res.json()
  return Object.fromEntries(rows.map(row => [row.id, row]))
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

  let monto = Number(body.montopagado);
  if (body.montopagado == null) {
    const actualRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&select=totalcomision`, { headers });
    if (!actualRes.ok) {
      const err = await actualRes.text();
      return jsonError(`Error al leer comision: ${err}`, actualRes.status, request);
    }
    const [actual] = await actualRes.json();
    monto = Number(actual?.totalcomision);
  }

  if (!Number.isFinite(monto) || monto < 0) {
    return jsonError('montopagado invalido', 400, request);
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&estado=in.(pendiente,cta_cobrar)&select=id,estado,montopagado`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        estado: 'pagada',
        montopagado: monto,
        pagadaen: new Date().toISOString(),
        pagadapor: operador.id
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al marcar comision pagada: ${err}`, res.status, request);
    }

    const [comision] = await res.json();
    if (!comision) return jsonError('Comision no encontrada o ya pagada', 404, request);

    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'PAGAR_COMISION',
      entidadTipo: 'comision', entidadId: comisionid,
      meta: { montopagado: monto, estado_nuevo: 'pagada' }, ip,
    });

    return json({ ok: true, comisionid, montopagado: monto }, 200, request);
  } catch (e) {
    return jsonError(`Error critico de pago: ${e.message}`, 500, request);
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

  let baseUrl = `${env.SUPABASE_URL}/rest/v1/comisiones?select=id,despachoid,vendedorid,cotizacionid,cuentaid,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,montopagado,estado,pagadaen,pagadapor,creadoen,actualizadoen&order=creadoen.desc`
  
  const userContext = { ...user, operator_rol: operador.rol, operator_id: operador.id };
  let query = aplicarFiltrosComisiones(baseUrl, url.searchParams, userContext)

  const res = await fetch(query, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Range': `${from}-${to}`,
      'Prefer': 'count=exact'
    },
  })

  if (!res.ok) {
    const err = await res.text()
    return jsonError(`Error al obtener comisiones: ${err}`, 500, request)
  }

  const rows = await res.json()
  const despachos = await fetchByIds(env, headers, 'notas_despacho', rows.map(c => c.despachoid), 'id,numero,total_usd,tasa_snapshot,cliente_id,cliente:clientes!notas_despacho_cliente_id_fkey(id,nombre)')
  const cotizaciones = await fetchByIds(env, headers, 'cotizaciones', rows.map(c => c.cotizacionid), 'id,numero,tasa_bcv_snapshot,cliente_id,cliente:clientes(id,nombre)')
  const vendedores = await fetchByIds(env, headers, 'usuarios', rows.map(c => c.vendedorid), 'id,nombre,color,markup_pct,rol,es_externo')
  const data = rows.map(c => {
    const despacho = despachos[c.despachoid]
    const cotizacion = cotizaciones[c.cotizacionid]
    return {
      id: c.id,
      despachoid: c.despachoid,
      vendedorid: c.vendedorid,
      cotizacionid: c.cotizacionid,
      cuentaid: c.cuentaid,
      totalcomision: c.totalcomision,
      comisioncabilla: c.comisioncabilla,
      comisionotros: c.comisionotros,
      pctcabilla: c.pctcabilla,
      pctotros: c.pctotros,
      montopagado: c.montopagado,
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
        cliente_nombre: despacho.cliente?.nombre || null
      } : null,
      cotizacion: cotizacion ? {
        id: cotizacion.id,
        numero: cotizacion.numero,
        tasa_bcv_snapshot: cotizacion.tasa_bcv_snapshot,
        cliente_nombre: cotizacion.cliente?.nombre || null
      } : null
    }
  })
  
  // Extraer el total de filas del header Content-Range (ej: "0-99/1250")
  const contentRange = res.headers.get('content-range') || '';
  const total = parseInt(contentRange.split('/')[1] || '0');

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
    let queryBreakdown = `${env.SUPABASE_URL}/rest/v1/comisiones?select=estado,totalcomision,montopagado&estado=in.(pendiente,cta_cobrar)`;
    const userContext = { ...user, operator_rol: operador.rol, operator_id: operador.id };
    queryBreakdown = aplicarFiltrosComisiones(queryBreakdown, url.searchParams, userContext);

    let pendienteRegular = 0;
    let pendienteCxc = 0;

    try {
      const breakdownRes = await fetch(queryBreakdown, { headers });
      if (breakdownRes.ok) {
        const items = await breakdownRes.json();
        for (const item of items) {
          const saldo = Math.max(0, Number(item.totalcomision || 0) - Number(item.montopagado || 0));
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
