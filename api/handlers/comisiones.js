// api/handlers/comisiones.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { verifyAuth, validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

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
  query += `&cuenta_id=eq.${user.id}`

  // 2. Filtro por Vendedor (según Rol)
  const filtroVendedor = esSupervisor ? (vendedorId || null) : operatorId
  if (filtroVendedor) {
    if (filtroVendedor === '00000000-0000-0000-0000-000000000000') {
      query += `&vendedor_id=is.null`
    } else {
      query += `&vendedor_id=eq.${filtroVendedor}`
    }
  }

  // 3. Filtro por Estado
  if (estado === 'pendiente') {
    query += `&estado=in.(retenida,pago_parcial,liberada)`
  } else if (estado) {
    query += `&estado=eq.${estado}`
  }

  // 4. Filtro por Fechas (Día Completo)
  if (desde) query += `&creado_en=gte.${desde}T00:00:00`
  if (hasta) query += `&creado_en=lte.${hasta}T23:59:59`

  return query
}

export async function handleMarcarComisionPagada(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_PAGO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_PAGO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden registrar pagos de comisiones', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { comisionId } = body;
  if (!comisionId || !isValidUuid(comisionId)) return jsonError('comisionId inválido', 400, request);

  try {
    const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/registrar_pago_comision`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'X-Client-Info': 'cloudflare-worker'
      },
      body: JSON.stringify({
        p_comision_id: comisionId,
        p_cuenta_id: user.id,
        p_operador_id: operador.id
      })
    });

    const result = await rpcRes.json();

    if (!rpcRes.ok) {
      return jsonError(result.message || 'Error en proceso de pago', rpcRes.status, request);
    }

    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'PAGAR_COMISION',
      entidadTipo: 'comision', entidadId: comisionId,
      meta: { 
        monto_pagado: result.monto_pagado,
        vendedor_id: result.vendedor_id, 
        estado_nuevo: result.estado_nuevo,
        total_comision: result.total_comision
      }, ip,
    });

    return json({ ok: true, montoPagado: result.monto_pagado }, 200, request);
  } catch (e) {
    return jsonError(`Error crítico de pago: ${e.message}`, 500, request);
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

  let baseUrl = `${env.SUPABASE_URL}/rest/v1/comisiones?select=*,despacho:notas_despacho!comisiones_despacho_id_fkey(numero,total_usd,tasa_snapshot),cotizacion:cotizaciones!comisiones_cotizacion_id_fkey(numero,tasa_bcv_snapshot),vendedor:usuarios!comisiones_vendedor_id_fkey(id,nombre,color)&order=creado_en.desc`
  
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

  const data = await res.json()
  
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
  const { user, operador, headers } = v;

  const url = new URL(request.url);
  const vendedorId = url.searchParams.get('vendedorId');
  const estado = url.searchParams.get('estado');
  const desde = url.searchParams.get('desde');
  const hasta = url.searchParams.get('hasta');

  const esSupervisor = ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(operador.rol);
  const filtroVendedor = esSupervisor ? (vendedorId || null) : operador.id;

  try {
    const estadoRpc = estado === 'pendiente' ? null : (estado || null)

    const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/obtener_resumen_comisiones`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_cuenta_id: user.id,
        p_vendedor_id: filtroVendedor,
        p_estado: estadoRpc,
        p_fecha_inicio: desde ? `${desde}T00:00:00` : null,
        p_fecha_fin: hasta ? `${hasta}T23:59:59` : null
      })
    });

    if (!rpcRes.ok) {
      const err = await rpcRes.text();
      return jsonError(`Error RPC Resumen: ${err}`, 500, request);
    }

    const [stats] = await rpcRes.json();

    return json({
      pendiente: Number(stats?.pendiente || 0),
      retenida: Number(stats?.retenida || 0),
      pagado: Number(stats?.pagado || 0),
      total: Number(stats?.total || 0),
      countPendiente: Number(stats?.count_pendiente || 0),
      countPagado: Number(stats?.count_pagado || 0),
    }, 200, request);

  } catch (e) {
    return jsonError(`Error en agregación: ${e.message}`, 500, request);
  }
}
