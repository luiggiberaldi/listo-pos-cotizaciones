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
  if (estado) {
    query += `&estado=eq.${estado}`
  }

  // 4. Filtro por Fechas (Día Completo - Zona Horaria Venezuela UTC-4)
  // Se filtra por la fecha del DESPACHO (notas_despacho.creado_en), igual que el PDF
  if (desde) query += `&despacho.creado_en=gte.${desde}T00:00:00-04:00`
  if (hasta) query += `&despacho.creado_en=lte.${hasta}T23:59:59-04:00`

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
  const idsCsv = csvIds(ids)
  if (!idsCsv) return {}

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=in.(${idsCsv})&select=${select}`, { headers })
  if (!res.ok) return {}

  const rows = await res.json()
  return Object.fromEntries(rows.map(row => [row.id, row]))
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
    let baseUrl = `${env.SUPABASE_URL}/rest/v1/comision_liberaciones?select=id,comision_id,despacho_id,vendedor_id,cuenta_id,monto,tipo,cxc_id,creado_en,comisiones:comisiones!inner(id,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,estado,montopagado,cotizacionid,despacho:notas_despacho(id,numero,total_usd,tasa_snapshot,cliente:clientes!notas_despacho_cliente_id_fkey(id,nombre,tipo_cliente),productos:notas_despacho_items(nombre_snap,codigo_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,origen,producto_id,producto:productos(categoria)))),vendedor:usuarios(id,nombre,color,markup_pct,rol,es_externo)&order=creado_en.desc`
    
    let query = baseUrl + `&cuenta_id=eq.${user.id}`

    const filtroVendedor = esSupervisor ? (vendedorId || null) : operatorId;
    if (filtroVendedor) {
      if (filtroVendedor === '00000000-0000-0000-0000-000000000000') {
        query += `&vendedor_id=is.null`
      } else {
        query += `&vendedor_id=eq.${filtroVendedor}`
      }
    }

    if (desde) query += `&creado_en=gte.${desde}T00:00:00-04:00`
    if (hasta) query += `&creado_en=lte.${hasta}T23:59:59-04:00`

    const res = await fetch(query, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Range': `${from}-${to}`,
        'Prefer': 'count=exact'
      },
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al obtener eventos de comision: ${err}`, 500, request);
    }

    const rows = await res.json();
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
          estado: com.estado || 'generada',
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

    const contentRange = res.headers.get('content-range') || '';
    const total = parseInt(contentRange.split('/')[1] || '0');

    return json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }, 200, request);
  }

  // Se incluye despacho:notas_despacho!inner(creado_en) para poder filtrar por fecha del despacho
  let baseUrl = `${env.SUPABASE_URL}/rest/v1/comisiones?select=id,despachoid,vendedorid,cotizacionid,cuentaid,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,estado,creadoen,actualizadoen,despacho:notas_despacho!inner(creado_en)&order=creadoen.desc`
  
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
  const despachos = await fetchByIds(env, headers, 'notas_despacho', rows.map(c => c.despachoid), 'id,numero,total_usd,tasa_snapshot,cliente_id,cliente:clientes!notas_despacho_cliente_id_fkey(id,nombre),productos:notas_despacho_items(nombre_snap,codigo_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,origen,producto_id,producto:productos(categoria))')
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
      estado: c.estado || 'generada',
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

    return json({
      totalAcumulado: Number(r.totalacumulado || 0),
      total: Number(r.total || 0),
    }, 200, request);

  } catch (e) {
    return jsonError(`Error en agregación: ${e.message}`, 500, request);
  }
}
