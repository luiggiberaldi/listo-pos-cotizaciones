// api/handlers/comisiones.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { verifyAuth, validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

async function obtenerVendedoresConRol(env, headers, cuentaId, roles) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?cuenta_id=eq.${cuentaId}&rol=in.(${roles.join(',')})&activo=eq.true&select=id`,
    { headers }
  );
  if (!res.ok) return '00000000-0000-0000-0000-000000000000';
  const rows = await res.json();
  if (!rows.length) return '00000000-0000-0000-0000-000000000000';
  return rows.map(r => r.id).join(',');
}

// Helper interno para unificar la lógica de filtros entre Lista y Resumen
function aplicarFiltrosComisiones(query, urlParams, user) {
  const vendedorId = urlParams.get('vendedorId')
  const estado = urlParams.get('estado')
  const desde = urlParams.get('desde')
  const hasta = urlParams.get('hasta')

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

  const ROLES_PAGO = ['supervisor', 'administracion', 'jefe'];
  if (!ROLES_PAGO.includes(operador.rol)) {
    return jsonError('Solo supervisor o administracion pueden registrar pagos de comisiones', 403, request);
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

  const ROLES_ESTADO = ['supervisor', 'administracion', 'jefe'];
  if (!ROLES_ESTADO.includes(operador.rol)) {
    return jsonError('Solo supervisor o administracion pueden cambiar el estado de comisiones', 403, request);
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

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&limit=1&select=comision_pct_cabilla,comision_pct_otros,comision_categoria_cabilla`, {
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

  const vendedorIds = await obtenerVendedoresConRol(env, headers, user.id, ['vendedor', 'supervisor']);
  let baseUrl = `${env.SUPABASE_URL}/rest/v1/comisiones?vendedorid=in.(${vendedorIds})&select=id,despachoid,vendedorid,cotizacionid,cuentaid,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,montopagado,estado,pagadaen,pagadapor,creadoen,actualizadoen&order=creadoen.desc`
  
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
  const despachos = await fetchByIds(env, headers, 'notas_despacho', rows.map(c => c.despachoid), 'id,numero,total_usd,tasa_snapshot')
  const cotizaciones = await fetchByIds(env, headers, 'cotizaciones', rows.map(c => c.cotizacionid), 'id,numero,tasa_bcv_snapshot')
  const vendedores = await fetchByIds(env, headers, 'usuarios', rows.map(c => c.vendedorid), 'id,nombre,color')
  const data = rows.map(c => {
    const despacho = despachos[c.despachoid]
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
      vendedor: vendedores[c.vendedorid] || null,
      despacho: despacho ? { id: despacho.id, numero: despacho.numero, totalusd: despacho.total_usd, tasa_snapshot: despacho.tasa_snapshot } : null,
      cotizacion: cotizaciones[c.cotizacionid] || null
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
    const vendedorIds = await obtenerVendedoresConRol(env, headers, user.id, ['vendedor', 'supervisor']);
    let query = `${env.SUPABASE_URL}/rest/v1/comisiones?vendedorid=in.(${vendedorIds})&select=totalcomision,montopagado,estado`
    const userContext = { ...user, operator_rol: operador.rol, operator_id: operador.id }
    query = aplicarFiltrosComisiones(query, url.searchParams, userContext)

    const res = await fetch(query, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`
      }
    })

    if (!res.ok) {
      const err = await res.text()
      return jsonError(`Error al obtener resumen de comisiones: ${err}`, 500, request)
    }

    const rows = await res.json()
    const totalAcumulado = rows.reduce((sum, c) => sum + Number(c.totalcomision || 0), 0)
    const pendientes = rows.filter(c => ['pendiente', 'cta_cobrar'].includes(c.estado))
    const pagadas = rows.filter(c => c.estado === 'pagada')
    const pendientePago = pendientes.reduce((sum, c) => sum + Number(c.totalcomision || 0), 0)
    const yaPagado = pagadas.reduce((sum, c) => sum + Number(c.montopagado || 0), 0)

    return json({
      totalAcumulado,
      pendientePago,
      yaPagado,
      numPendientes: pendientes.length,
      numPagadas: pagadas.length,
      total: rows.length,
    }, 200, request);

  } catch (e) {
    return jsonError(`Error en agregación: ${e.message}`, 500, request);
  }
}
