import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { recalcularSaldoPendienteCliente } from '../lib/cxcUtils.js'
import { getCommissionablePaymentSplit, isDonationPayment } from '../../src/utils/comisionUtils.js'

function resolverIdempotencyKey(request, body) {
  const fromBody = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
  const fromHeader = (request.headers.get('Idempotency-Key') || '').trim()
  return fromBody || fromHeader || crypto.randomUUID()
}

function errorReglaFlete(errorText, request, mensajeFallback) {
  const text = String(errorText || '')
  if (text.includes('DESTINO_ESTADO_REQUERIDO')) {
    return jsonError('Debe indicar el estado de destino para calcular la comisión del chofer local.', 400, request)
  }
  if (text.includes('FLETE_YA_PAGADO')) {
    return jsonError('El flete ya fue liquidado. Revierta el pago antes de modificar chofer, flete o destino.', 400, request)
  }
  if (text.includes('FLETE_NO_COMISIONABLE')) {
    return jsonError('El flete de Carabobo pertenece a la nómina externa y no puede liquidarse aquí.', 400, request)
  }
  if (text.includes('CONFIG_TRANSPORTISTA_NO_DISPONIBLE')) {
    return jsonError('Configure la comisión de choferes locales antes de registrar un flete fuera de Carabobo.', 400, request)
  }
  return jsonError(mensajeFallback, 500, request)
}

async function validarDestinoFleteLocal({ env, headers, cuentaId, transportistaId, clienteId, estadoDestino, flete, request }) {
  if (!transportistaId || Number(flete) <= 0) return null
  if (!isValidUuid(transportistaId)) return jsonError('transportistaId inválido', 400, request)
  if (!isValidUuid(cuentaId)) return jsonError('Cuenta del operador no disponible', 403, request)

  const cuentaFilter = `&cuenta_id=eq.${cuentaId}`
  const transpRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/transportistas?id=eq.${transportistaId}${cuentaFilter}&select=es_local&limit=1`,
    { headers }
  )
  if (!transpRes.ok) {
    const detail = await transpRes.text().catch(() => '')
    return errorReglaFlete(detail, request, 'No se pudo validar el transportista para el flete.')
  }
  const [transportista] = await transpRes.json()
  if (!transportista) return jsonError('Transportista no encontrado en la cuenta del operador', 400, request)
  if (!transportista.es_local) return null

  let estado = String(estadoDestino || '').trim()
  if (!estado && clienteId) {
    const clienteRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}${cuentaFilter}&select=estado&limit=1`,
      { headers }
    )
    if (clienteRes.ok) {
      const [cliente] = await clienteRes.json()
      estado = String(cliente?.estado || '').trim()
    }
  }

  if (!estado) {
    return jsonError('Debe indicar el estado de destino para calcular la comisión del chofer local.', 400, request)
  }
  return null
}

async function obtenerComisionExistente(despachoId, headers, env) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}&select=id,calculo_version,fuente_calculo&limit=1`,
    { headers },
  )
  if (!response.ok) return null
  const [row] = await response.json()
  return row || null
}

function esComisionNueva238b(comision) {
  return comision?.calculo_version === '238b'
}

function pagoMixtoRequiereRevision(totalUsd, formaPagoCliente, formaPago) {
  return getCommissionablePaymentSplit({ totalUsd, formaPagoCliente, formaPago }).requiresManualReview === true
}

function pagoEsDonacion(formaPagoCliente, formaPago) {
  return isDonationPayment(formaPagoCliente) || isDonationPayment(formaPago)
}

async function recalcularComision238b(despachoId, headers, env) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/rpc/recalcularcomisiondespacho_238b`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ p_despachoid: despachoId }),
  })
}

async function obtenerVendedorComisionId(despacho, headers, env) {
  if (despacho.cliente_id) {
    const cliRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${despacho.cliente_id}&select=vendedor_id`,
      { headers }
    );
    if (cliRes.ok) {
      const cliData = await cliRes.json();
      if (cliData && cliData[0]?.vendedor_id) {
        return cliData[0].vendedor_id;
      }
    }
  }
  return despacho.vendedor_id;
}


export async function handleCrearDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { cotizacionId, notas, formaPago, transportistaId, fleteUsd, corteUsd, clienteFacturaId, direccionEnvioDireccion, direccionEnvioCiudad, direccionEnvioEstado } = body;
  if (transportistaId !== undefined && transportistaId !== null && transportistaId !== '' && !isValidUuid(transportistaId)) {
    return jsonError('transportistaId inválido', 400, request);
  }
  if (fleteUsd !== undefined && (!Number.isFinite(Number(fleteUsd)) || Number(fleteUsd) < 0)) {
    return jsonError('fleteUsd inválido', 400, request);
  }
  if (corteUsd !== undefined && (!Number.isFinite(Number(corteUsd)) || Number(corteUsd) < 0)) {
    return jsonError('corteUsd inválido', 400, request);
  }
  const flete = Number(fleteUsd ?? 0);
  const corte = Number(corteUsd ?? 0);
  if (!cotizacionId) return jsonError('Falta cotizacionId', 400, request);
  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);

  try {
    // 1+2. Fetch cotización + check existing despacho in parallel
    const [cotRes, existRes] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`, { headers }),
      fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?cotizacion_id=eq.${cotizacionId}&select=id&limit=1`, { headers }),
    ]);
    const [cot] = await cotRes.json();
    if (!cot) return jsonError('Cotización no encontrada', 404, request);

    const existing = await existRes.json();
    if (existing && existing.length > 0) {
      return jsonError('Ya existe una nota de despacho para esta cotización', 400, request);
    }

    const esSupervisorOp = ['supervisor', 'administracion', 'jefe', 'desarrollador'].includes(operador.rol);
    const esPropietario = cot.vendedor_id === operador.id;

    if (!['enviada', 'aceptada'].includes(cot.estado)) {
      return jsonError('La cotización debe estar enviada o aceptada para despachar', 400, request);
    }
    if (!esSupervisorOp && !esPropietario) {
      return jsonError(`Solo puedes despachar tus propias cotizaciones (op:${operador.id} vs vend:${cot.vendedor_id})`, 403, request);
    }

    const transportistaFinalId = transportistaId || cot.transportista_id || null
    const destinoError = await validarDestinoFleteLocal({
      env,
      headers,
      cuentaId: operador.cuenta_id,
      transportistaId: transportistaFinalId,
      clienteId: cot.cliente_id,
      estadoDestino: direccionEnvioEstado,
      flete,
      request,
    })
    if (destinoError) return destinoError

    // 3. Si está enviada, aceptarla automáticamente
    if (cot.estado === 'enviada') {
      await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'aceptada' }),
      });
    }

    // Fetch cliente details
    let clienteNombre = 'cliente';
    let clienteSaldoFavor = 0;
    const targetCliId = (clienteFacturaId && isValidUuid(clienteFacturaId)) ? clienteFacturaId : cot.cliente_id;
    if (targetCliId) {
      const cliRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${targetCliId}&select=nombre,saldo_a_favor,vendedor_id,vendedor:usuarios!clientes_vendedor_id_fkey(rol)`, { headers });
      if (cliRes.ok) {
        const cliData = await cliRes.json();
        if (cliData && cliData.length > 0) {
          clienteNombre = cliData[0].nombre;
          clienteSaldoFavor = Number(cliData[0].saldo_a_favor || 0);
        }
      }
    }

    if (formaPago) {
      try {
        const fps = typeof formaPago === 'string' ? JSON.parse(formaPago) : formaPago;
        if (Array.isArray(fps)) {
          const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
          if (cxc) {
            const dias = parseInt(cxc.diasVencimiento, 10);
            if (isNaN(dias) || dias <= 0) {
              return jsonError('Los días de vencimiento son obligatorios para cuentas por cobrar', 400, request);
            }
          }
          const sf = fps.find(f => f.metodo === 'Saldo a Favor');
          if (sf && Number(sf.monto) > clienteSaldoFavor + 0.01) {
            return jsonError(`El monto en Saldo a Favor ($${sf.monto}) excede el disponible actual del cliente ($${clienteSaldoFavor.toFixed(2)})`, 400, request);
          }
        }
      } catch { /* forma de pago malformada; se ignora */ }
    }

    // 4. Crear nota de despacho (stock se descuenta al confirmar entrega por logística)
    // Se resta costo_envio_usd y corte_usd de la cotización (estimados) para evitar doble suma
    // con el flete y corte reales ingresados al momento del despacho.
    const cotEnvio = Number(cot.costo_envio_usd || 0);
    const cotCorte = Number(cot.corte_usd || 0);
    const totalBase = Number(cot.total_usd) - cotEnvio - cotCorte;
    const totalConFleteCorte = totalBase + flete + corte;
    const despRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?select=id,numero`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cuenta_id: operador.cuenta_id,
        cotizacion_id: cotizacionId,
        cliente_id: cot.cliente_id,
        cliente_factura_id: (clienteFacturaId && isValidUuid(clienteFacturaId)) ? clienteFacturaId : null,
        vendedor_id: cot.vendedor_id,
        transportista_id: transportistaFinalId,
        estado: 'pendiente',
        total_usd: totalConFleteCorte,
        flete_usd: flete,
        corte_usd: corte,
        notas: notas || null,
        forma_pago: formaPago || null,
        creado_por: user.operator_id,
        direccion_envio_direccion: direccionEnvioDireccion || null,
        direccion_envio_ciudad:    direccionEnvioCiudad || null,
        direccion_envio_estado:    direccionEnvioEstado || null,
      }),
    });

    if (!despRes.ok) {
      const err = await despRes.text();
      return errorReglaFlete(err, request, `Error al crear despacho: ${err}`)
    }
    const [despacho] = await despRes.json();

    // ── Copiar ítems de la cotización al despacho (snapshot inicial) ──────────
    const ciSnap = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items` +
      `?cotizacion_id=eq.${cotizacionId}` +
      `&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden,origen` +
      `&order=orden.asc`,
      { headers }
    );
    const ciRows = await ciSnap.json();

    if (Array.isArray(ciRows) && ciRows.length > 0) {
      const despItems = ciRows.map((item, i) => ({
        despacho_id:       despacho.id,
        producto_id:       item.producto_id || null,
        codigo_snap:       item.codigo_snap || null,
        nombre_snap:       item.nombre_snap,
        unidad_snap:       item.unidad_snap || 'und',
        origen:            item.origen || 'inventario',
        cantidad_original: Number(item.cantidad),
        precio_original:   Number(item.precio_unit_usd),
        cantidad:          Number(item.cantidad),
        precio_unit_usd:   Number(item.precio_unit_usd),
        descuento_pct:     Number(item.descuento_pct || 0),
        total_linea_usd:   Number(item.total_linea_usd),
        orden:             item.orden ?? i,
      }));

      await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho_items`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(despItems),
      });
    }

    // Auditoría (fire-and-forget)
    registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'CREAR_DESPACHO',
      entidadTipo: 'nota_despacho', entidadId: despacho.id,
      meta: { cotizacion_id: cotizacionId, total_usd: cot.total_usd }, ip,
    }).catch(() => {});

    return json({
      id: despacho.id,
      numero: despacho.numero,
      numeroCotizacion: cot.numero,
      clienteNombre: clienteNombre
    }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al crear despacho', 500, request);
  }
}

export async function handleEditarPagoDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers: h } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { despachoId, formaPago, formaPagoCliente, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, clienteId, direccionEnvioDireccion, direccionEnvioCiudad, direccionEnvioEstado } = body;
  if (transportistaId !== undefined && transportistaId !== null && transportistaId !== '' && !isValidUuid(transportistaId)) {
    return jsonError('transportistaId inválido', 400, request);
  }
  if (fleteUsd !== undefined && (!Number.isFinite(Number(fleteUsd)) || Number(fleteUsd) < 0)) {
    return jsonError('fleteUsd inválido', 400, request);
  }
  if (corteUsd !== undefined && (!Number.isFinite(Number(corteUsd)) || Number(corteUsd) < 0)) {
    return jsonError('corteUsd inválido', 400, request);
  }
  if (!despachoId) return jsonError('Falta despachoId', 400, request);
  if (!isValidUuid(operador.cuenta_id)) return jsonError('Cuenta del operador no disponible', 403, request);

  const checkRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}&select=id,estado,vendedor_id,flete_usd,corte_usd,total_usd,cotizacion_id,cliente_id,transportista_id,direccion_envio_estado,flete_pagado,forma_pago,forma_pago_cliente`, { headers: h });
  if (!checkRes.ok) return jsonError('Error al verificar despacho', 500, request);
  const despachos = await checkRes.json();
  if (!despachos.length) return jsonError('Despacho no encontrado', 404, request);
  const despacho = despachos[0];
  const comisionAntes = await obtenerComisionExistente(despachoId, h, env)

  const totalPosterior = (fleteUsd !== undefined || corteUsd !== undefined)
    ? Number(despacho.total_usd || 0)
      - Number(despacho.flete_usd || 0)
      - Number(despacho.corte_usd || 0)
      + (fleteUsd !== undefined ? Number(fleteUsd || 0) : Number(despacho.flete_usd || 0))
      + (corteUsd !== undefined ? Number(corteUsd || 0) : Number(despacho.corte_usd || 0))
    : Number(despacho.total_usd || 0)
  if (esComisionNueva238b(comisionAntes)
    && pagoMixtoRequiereRevision(
      totalPosterior,
      formaPagoCliente !== undefined ? formaPagoCliente : despacho.forma_pago_cliente,
      formaPago !== undefined ? formaPago : despacho.forma_pago,
    )) {
    return jsonError('Pago mixto sin montos explícitos: complete los montos de CxC y del método no-CxC antes de recalcular la comisión.', 400, request)
  }

  const camposFinancierosFlete = transportistaId !== undefined
    || fleteUsd !== undefined
    || direccionEnvioEstado !== undefined
    || clienteId !== undefined;
  if (despacho.flete_pagado && camposFinancierosFlete) {
    return jsonError('El flete ya fue liquidado. Revierta el pago antes de modificar chofer, flete o destino.', 400, request);
  }
  
  const esAdmin = ['supervisor', 'administracion', 'jefe', 'desarrollador', 'logistica'].includes(operador.rol);
  const esVendedorDueno = despacho.vendedor_id === operador.id;
  if (!esAdmin && !esVendedorDueno) return jsonError('No tienes permiso para editar este despacho', 403, request);

  // Validar el destino efectivo antes de guardar: el trigger SQL es la última
  // defensa, pero la API debe devolver un error claro y no depender de un 500.
  if (transportistaId !== undefined || fleteUsd !== undefined || direccionEnvioEstado !== undefined || clienteId !== undefined) {
    const destinoError = await validarDestinoFleteLocal({
      env,
      headers: h,
      cuentaId: operador.cuenta_id,
      transportistaId: transportistaId !== undefined ? (transportistaId || null) : (despacho.transportista_id || null),
      clienteId: clienteId !== undefined ? (clienteId || null) : despacho.cliente_id,
      estadoDestino: direccionEnvioEstado !== undefined ? direccionEnvioEstado : despacho.direccion_envio_estado,
      flete: fleteUsd !== undefined ? Number(fleteUsd) : Number(despacho.flete_usd || 0),
      request,
    })
    if (destinoError) return destinoError
  }

  if (formaPago) {
    try {
      const fps = typeof formaPago === 'string' ? JSON.parse(formaPago) : formaPago;
      if (Array.isArray(fps)) {
        const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
        if (cxc) {
          const dias = parseInt(cxc.diasVencimiento, 10);
          if (isNaN(dias) || dias <= 0) {
            return jsonError('Los días de vencimiento son obligatorios para cuentas por cobrar', 400, request);
          }
        }
      }
    } catch { /* forma de pago malformada; se ignora */ }
  }

  const esConciliacionCod = formaPago !== undefined && 
    (['administracion', 'desarrollador', 'supervisor', 'jefe'].includes(operador.rol));

  if (despacho.estado === 'entregada' && !esConciliacionCod) {
    const editandoSoloNotas = notas !== undefined && 
      formaPago === undefined && 
      formaPagoCliente === undefined && 
      referenciaPago === undefined && 
      transportistaId === undefined && 
      fleteUsd === undefined && 
      corteUsd === undefined && 
      clienteId === undefined && 
      direccionEnvioDireccion === undefined && 
      direccionEnvioCiudad === undefined && 
      direccionEnvioEstado === undefined;

    // Logística/admin puede editar transportista, flete y destino en despachos ya entregados
    // pero NO puede tocar campos financieros (forma de pago, corte) ni cliente ni dirección física
    const editandoTransportista = esAdmin &&
      formaPago === undefined &&
      formaPagoCliente === undefined &&
      referenciaPago === undefined &&
      corteUsd === undefined &&
      clienteId === undefined &&
      direccionEnvioDireccion === undefined &&
      (transportistaId !== undefined || fleteUsd !== undefined || notas !== undefined);

    if (!editandoSoloNotas && !editandoTransportista) {
      return jsonError('No se pueden editar despachos en estado entregado', 400, request);
    }
  }

  if (despacho.estado !== 'pendiente' && !esConciliacionCod) {
    const tieneCamposFinancierosRestringidos = formaPago !== undefined || formaPagoCliente !== undefined || referenciaPago !== undefined || corteUsd !== undefined || clienteId !== undefined;
    if (tieneCamposFinancierosRestringidos) {
      return jsonError('No se pueden editar datos financieros en un despacho aprobado', 400, request);
    }
    if (transportistaId === undefined && fleteUsd === undefined && notas === undefined) {
      return jsonError('No hay campos editables para este estado', 400, request);
    }
  }

  // Actualizar campos
  const campos = {};
  if (formaPago !== undefined) campos.forma_pago = formaPago;
  if (formaPagoCliente !== undefined) campos.forma_pago_cliente = formaPagoCliente;
  if (referenciaPago !== undefined) campos.referencia_pago = referenciaPago;
  if (direccionEnvioDireccion !== undefined) campos.direccion_envio_direccion = direccionEnvioDireccion || null;
  if (direccionEnvioCiudad !== undefined) campos.direccion_envio_ciudad = direccionEnvioCiudad || null;
  if (direccionEnvioEstado !== undefined) campos.direccion_envio_estado = direccionEnvioEstado || null;
  if (transportistaId !== undefined) campos.transportista_id = transportistaId || null;
  if (fleteUsd !== undefined || corteUsd !== undefined) {
    const nuevoFlete = fleteUsd !== undefined ? (Number(fleteUsd) || 0) : Number(despacho.flete_usd || 0);
    const nuevoCorte = corteUsd !== undefined ? (Number(corteUsd) || 0) : Number(despacho.corte_usd || 0);
    const fleteAnterior = Number(despacho.flete_usd) || 0;
    const corteAnterior = Number(despacho.corte_usd) || 0;
    campos.flete_usd = nuevoFlete;
    campos.corte_usd = nuevoCorte;
    // Recalcular total_usd: total actual - flete/corte anterior + nuevo flete/corte
    campos.total_usd = Number(despacho.total_usd) - fleteAnterior - corteAnterior + nuevoFlete + nuevoCorte;
  }
  if (notas !== undefined) campos.notas = notas || null;
  if (clienteId !== undefined && isValidUuid(clienteId)) {
    campos.cliente_id = clienteId;
    campos.cliente_factura_id = clienteId;

    // Buscar el vendedor dueño del cliente para mantener consistencia
    try {
      const cliRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=vendedor_id`, { headers: h });
      if (cliRes.ok) {
        const cliData = await cliRes.json();
        if (Array.isArray(cliData) && cliData.length > 0 && cliData[0].vendedor_id) {
          campos.vendedor_id = cliData[0].vendedor_id;
        }
      }
    } catch (cliErr) {
      console.error('[EDITAR_PAGO] Error al sincronizar vendedor del cliente:', cliErr?.message);
    }
  }

  if (Object.keys(campos).length === 0) return jsonError('No hay campos para actualizar', 400, request);

  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}`, {
    method: 'PATCH',
    headers: { ...h, Prefer: 'return=minimal' },
    body: JSON.stringify(campos),
  });
  if (!upRes.ok) {
    const err = await upRes.text().catch(() => '')
    return errorReglaFlete(err, request, 'Error al actualizar despacho')
  }

  // Recalcular únicamente una comisión nueva 238b; las legacy no se modifican.
  if (esComisionNueva238b(comisionAntes)) {
    const vendedorIdComision = await obtenerVendedorComisionId(despacho, h, env);
    const vendRolRes2 = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${vendedorIdComision}&select=rol,markup_pct`,
      { headers: h }
    );
    const [vendRol2] = await vendRolRes2.json();
    console.log('[COMISION][EDITAR_PAGO] rol vendedor:', vendRol2?.rol, 'markup:', vendRol2?.markup_pct);

    const esDonacion = pagoEsDonacion(
      formaPagoCliente !== undefined ? formaPagoCliente : despacho.forma_pago_cliente,
      formaPago !== undefined ? formaPago : despacho.forma_pago,
    )

    if (esDonacion || ['jefe', 'logistica', 'administracion', 'desarrollador'].includes(vendRol2?.rol) || (vendRol2?.rol === 'vendedor_sin_comision' && parseFloat(vendRol2?.markup_pct || 0) <= 0)) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionAntes.id}`, {
        method: 'DELETE', headers: h,
      });
      console.log('[COMISION][EDITAR_PAGO] Comisión 238b eliminada por método Donación o rol exento.');
    } else {
      const recalcRes = await recalcularComision238b(despachoId, h, env)
      if (!recalcRes.ok) console.error('[COMISION][EDITAR_PAGO] Error al recalcular 238b:', await recalcRes.text())
    }
  }

  // Auditoría
  try {
    await registrarAuditoria(env, h, {
      usuarioId: operador.id,
      usuarioNombre: operador.nombre,
      usuarioRol: operador.rol,
      categoria: 'COTIZACION',
      accion: 'EDITAR_PAGO_DESPACHO',
      descripcion: `Despacho ${despachoId.slice(0,8)} editado (pago/transportista/notas)`,
      entidadTipo: 'despacho',
      entidadId: despachoId,
      meta: campos,
      ip: request.headers.get('CF-Connecting-IP') || null,
    });
  } catch { /* auditoría best-effort */ }

  return json({ ok: true }, 200, request);
}

export async function handleActualizarEstadoDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { despachoId, nuevoEstado, tasaBcv } = body || {};
  const idempotencyKey = resolverIdempotencyKey(request, body);
  if (!despachoId || !nuevoEstado) return jsonError('Faltan campos', 400, request);
  if (!isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request);

  try {
    // 1. Obtener despacho dentro del tenant del operador
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}&select=*`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);

    // La política 238b se valida antes de registrar CxC, cambiar estado o
    // descontar inventario. Un despacho legacy existente no se reinterpreta.
    const comisionInicial = await obtenerComisionExistente(despachoId, headers, env)
    const flujoComision238b = !comisionInicial || esComisionNueva238b(comisionInicial)
    if (flujoComision238b
      && ['despachada', 'entregada'].includes(nuevoEstado)
      && pagoMixtoRequiereRevision(desp.total_usd, desp.forma_pago_cliente, desp.forma_pago)) {
      return jsonError('Pago mixto sin montos explícitos: complete los montos de CxC y del método no-CxC antes de aprobar o entregar el despacho.', 400, request)
    }

    // 2. Validar transición
    const valid = (desp.estado === 'pendiente' && ['despachada', 'entregada', 'anulada'].includes(nuevoEstado))
      || (desp.estado === 'despachada' && ['entregada', 'pendiente'].includes(nuevoEstado))
      || (desp.estado === 'entregada' && ['pendiente', 'despachada'].includes(nuevoEstado))
      || (desp.estado === nuevoEstado && ['pendiente', 'despachada', 'entregada', 'anulada'].includes(nuevoEstado));
    if (!valid) {
      return jsonError(`No se puede pasar de "${desp.estado}" a "${nuevoEstado}"`, 400, request);
    }

    // Un pago de comisión externa no se revierte implícitamente al devolver o
    // anular el despacho. Primero debe ejecutarse la reversa del pago para que
    // el vínculo pago-despacho y el saldo vuelvan a quedar consistentes.
    if (
      desp.flete_pagado
      && ['pendiente', 'anulada'].includes(nuevoEstado)
      && ['despachada', 'entregada'].includes(desp.estado)
    ) {
      return jsonError('Revierte primero la liquidación del transportista antes de devolver o anular el despacho', 400, request);
    }

    // 2b. Aprobar (pendiente→despachada): solo administración y desarrollador
    const rolOp = operador.rol;
    if (desp.estado === 'pendiente' && nuevoEstado === 'despachada') {
      if (rolOp !== 'administracion' && rolOp !== 'jefe' && rolOp !== 'desarrollador') {
        return jsonError('Solo administración puede aprobar despachos', 403, request);
      }
    }

    // 2c. Confirmar entrega: logística, jefe, administración y desarrollador
    if (nuevoEstado === 'entregada') {
      if (!['logistica', 'jefe', 'desarrollador', 'administracion'].includes(rolOp)) {
        return jsonError('No tiene permisos para confirmar entregas', 403, request);
      }
    }

    // 2d. Anular: administración, supervisor, desarrollador, o vendedor dueño si está pendiente.
    if (nuevoEstado === 'anulada') {
      const esVendedorPropio = ['vendedor', 'vendedor_sin_comision'].includes(rolOp) && desp.vendedor_id === operador.id && desp.estado === 'pendiente';
      if (!['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(rolOp) && !esVendedorPropio) {
        return jsonError('No tiene permiso para anular despachos', 403, request);
      }
    }

    // 2e. Devolver (despachada/entregada→pendiente): logistica, jefe, desarrollador, administracion
    if (['despachada', 'entregada'].includes(desp.estado) && nuevoEstado === 'pendiente') {
      const rolesPermitidos = ['logistica', 'jefe', 'desarrollador', 'administracion'];
      if (!rolesPermitidos.includes(rolOp)) {
        return jsonError('No tiene permiso para devolver este despacho a pendiente', 403, request);
      }
      if (!body.motivo_devolucion || body.motivo_devolucion.trim() === '') {
        return jsonError('Debe proporcionar el motivo de devolución', 400, request);
      }
    }

    // Bloquear reversión o anulación si el despacho tiene préstamos activos que ya han sido devueltos o facturados
    // Excluyendo a administración, jefe y desarrollador de este bloqueo
    if (['pendiente', 'anulada'].includes(nuevoEstado) && ['despachada', 'entregada'].includes(desp.estado)) {
      if (!['administracion', 'jefe', 'desarrollador'].includes(rolOp)) {
        const prestRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/cliente_prestamos?despacho_id=eq.${despachoId}&select=cantidad_devuelta,cantidad_facturada`,
          { headers }
        );
        if (prestRes.ok) {
          const prestList = await prestRes.json();
          if (Array.isArray(prestList) && prestList.length > 0) {
            const tieneActividad = prestList.some(
              p => Number(p.cantidad_devuelta || 0) > 0 || Number(p.cantidad_facturada || 0) > 0
            );
            if (tieneActividad) {
              return jsonError(
                'No se puede revertir o anular un despacho que tiene préstamos asociados con devoluciones o facturaciones ya registradas.',
                400,
                request
              );
            }
          }
        }
      }
    }

    // Bloquear reversión o anulación si el Saldo a Favor generado por una devolución en este despacho ya fue consumido en otras compras
    if (['pendiente', 'anulada'].includes(nuevoEstado) && desp.tiene_devoluciones && desp.estado !== nuevoEstado) {
      try {
        const cxcCredRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.credito&select=monto_usd`,
          { headers }
        );
        if (cxcCredRes.ok) {
          const credRows = await cxcCredRes.json();
          const creditoGenerado = Math.round((credRows || []).reduce((s, r) => s + Number(r.monto_usd || 0), 0) * 100) / 100;
          if (creditoGenerado > 0) {
            const clienteCxCId = desp.cliente_factura_id || desp.cliente_id;
            const clRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_a_favor`, { headers });
            if (clRes.ok) {
              const [clData] = await clRes.json();
              const saldoFavorActual = Math.round(Number(clData?.saldo_a_favor || 0) * 100) / 100;
              if (saldoFavorActual < (creditoGenerado - 0.01)) {
                return jsonError(
                  `No se puede ${nuevoEstado === 'anulada' ? 'anular' : 'revertir'} este despacho porque el cliente ya consumió parte o la totalidad del Saldo a Favor ($${creditoGenerado.toFixed(2)}) generado por la devolución previa.`,
                  400,
                  request
                );
              }
            }
          }
        }
      } catch (errCredCheck) {
        console.error('[DESPACHOS] Error verificando saldo a favor consumido:', errCredCheck);
      }
    }

    // Guardarrail: Bloquear si la comisión del vendedor ya fue pagada (solo desarrollador puede forzar)
    if (['pendiente', 'anulada'].includes(nuevoEstado) && ['despachada', 'entregada'].includes(desp.estado)) {
      if (rolOp !== 'desarrollador') {
        try {
          const comRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}&estado=eq.pagada&select=id&limit=1`,
            { headers }
          );
          if (comRes.ok) {
            const [comPagada] = await comRes.json();
            if (comPagada) {
              return jsonError(
                'No se puede reabrir/revertir este despacho porque la comisión del vendedor ya fue pagada. Anule el pago de comisión primero.',
                400, request
              );
            }
          }
        } catch (comChkErr) {
          console.warn('[GUARDARRAIL] Error verificando comisión pagada:', comChkErr?.message);
        }
      }
    }

    // Guardarrail: Bloquear si existen abonos REALES en CxC para este despacho.
    // Los abonos 'Devolución' y 'Saldo a favor' son ajustes contables del propio
    // despacho (no entró dinero) y la RPC de reversión los anula dentro de su
    // transacción (release 06). El chequeo de reembolsos en efectivo
    // (REEMBOLSO_EFECTIVO_REGISTRADO) y de crédito consumido vive en la RPC.
    if (['pendiente', 'anulada'].includes(nuevoEstado) && ['despachada', 'entregada'].includes(desp.estado)) {
      if (rolOp !== 'desarrollador') {
        try {
          const abonosRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.abono&select=id,monto_usd,forma_pago_abono`,
            { headers }
          );
          if (abonosRes.ok) {
            const abonos = await abonosRes.json();
            const abonoReal = (abonos || []).find(a =>
              !a.forma_pago_abono ||
              (a.forma_pago_abono !== 'Saldo a favor' && a.forma_pago_abono !== 'Devolución')
            );
            if (abonoReal) {
              return jsonError(
                `No se puede reabrir/revertir este despacho porque tiene cobros reales registrados en CxC ($${Number(abonoReal.monto_usd || 0).toFixed(2)}). Anule los cobros primero.`,
                400, request
              );
            }
          }
        } catch (abonoChkErr) {
          console.warn('[GUARDARRAIL] Error verificando abonos en CxC:', abonoChkErr?.message);
        }
      }
    }

    // 2f. Revertir entrega (entregada→despachada): administración, supervisor, desarrollador
    if (desp.estado === 'entregada' && nuevoEstado === 'despachada') {
      if (!['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(rolOp)) {
        return jsonError('Solo un supervisor o administración puede revertir un despacho entregado', 403, request);
      }
    }

    let entregaAtomica = null
    let reversaAtomica = null

    // La RPC neutral es la autoridad para stock, Kardex y estado de entrega.
    // En replay devuelve el resultado persistido antes de tocar efectos auxiliares.
    const deliveryCandidate = nuevoEstado === 'entregada'
      && ['pendiente', 'despachada', 'entregada'].includes(desp.estado)
    if (deliveryCandidate) {
      const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/confirmar_entrega_finanzas_idempotente`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_cuenta_id: operador.cuenta_id,
          p_despacho_id: despachoId,
          p_idempotency_key: idempotencyKey,
          p_usuario_id: user.operator_id,
          p_usuario_nombre: operador.nombre,
          p_usuario_color: operador.color || null,
          p_tasa_snapshot: Number.isFinite(Number(tasaBcv)) && Number(tasaBcv) > 0 ? Number(tasaBcv) : null,
          p_permitir_negativo: null,
        }),
      })
      const rpcText = await rpcRes.text()
      let result = null
      try { result = rpcText ? JSON.parse(rpcText) : null } catch { result = null }
      if (!rpcRes.ok) {
        return jsonError(`No se pudo confirmar la entrega atómica: ${result?.message || rpcText || `HTTP ${rpcRes.status}`}`, 400, request)
      }
      if (!result?.ok) return jsonError('La RPC no confirmó la entrega atómica', 500, request)
      entregaAtomica = result
      if (result.idempotent === true) {
        return json({
          ...result,
          ok: true,
          nuevoEstado: result.nuevo_estado || 'entregada',
          idempotency_key: idempotencyKey,
          idempotent: true,
        }, 200, request)
      }
    }

    // Reversión de entrega + finanzas: la RPC conserva las guardas de flete,
    // abonos y comisión pagada y evita mutaciones REST parciales.
    const reversalCandidate = ['pendiente', 'despachada', 'anulada'].includes(nuevoEstado)
      && (desp.estado === 'entregada' || desp.estado === nuevoEstado)
    if (reversalCandidate) {
      const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/revertir_entrega_finanzas_idempotente`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_cuenta_id: operador.cuenta_id,
          p_despacho_id: despachoId,
          p_idempotency_key: idempotencyKey,
          p_nuevo_estado: nuevoEstado,
          p_usuario_id: user.operator_id,
          p_usuario_nombre: operador.nombre,
          p_usuario_color: operador.color || null,
        }),
      })
      const rpcText = await rpcRes.text()
      let result = null
      try { result = rpcText ? JSON.parse(rpcText) : null } catch { result = null }
      if (!rpcRes.ok) {
        return jsonError(`No se pudo revertir la entrega atómica: ${result?.message || rpcText || `HTTP ${rpcRes.status}`}`, 400, request)
      }
      if (!result?.ok) return jsonError('La RPC no confirmó la reversión atómica', 500, request)
      reversaAtomica = result
      if (result.idempotent === true) {
        return json({
          ...result,
          ok: true,
          nuevoEstado: result.nuevo_estado || nuevoEstado,
          idempotency_key: idempotencyKey,
          idempotent: true,
        }, 200, request)
      }
    }

    // Solo restaurar stock si ya había sido entregada (stock ya descontado) y se anula o revierte
    if (!reversaAtomica && desp.estado === 'entregada' && ['pendiente', 'despachada', 'anulada'].includes(nuevoEstado)) {
      // 1. Obtener ítems originales
      const ciRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notas_despacho_items?despacho_id=eq.${despachoId}&producto_id=not.is.null&origen=eq.inventario&select=producto_id,cantidad,nombre_snap`,
        { headers }
      );
      const itemsOrig = (await ciRes.json()) || [];

      // 2. Si tiene devoluciones, consultar devoluciones e intercambios
      let mapDevoluciones = {};
      let mapIntercambios = {};
      if (desp.tiene_devoluciones) {
        const [devRes, intRes] = await Promise.all([
          fetch(`${env.SUPABASE_URL}/rest/v1/despacho_devoluciones?despacho_id=eq.${despachoId}&select=producto_id,cantidad_devuelta`, { headers }),
          fetch(`${env.SUPABASE_URL}/rest/v1/despacho_devolucion_intercambios?despacho_id=eq.${despachoId}&select=producto_id,cantidad,nombre_snap`, { headers })
        ]);
        if (devRes.ok) {
          const devList = await devRes.json();
          (devList || []).forEach(d => {
            if (d.producto_id) {
              mapDevoluciones[d.producto_id] = (mapDevoluciones[d.producto_id] || 0) + Number(d.cantidad_devuelta || 0);
            }
          });
        }
        if (intRes.ok) {
          const intList = await intRes.json();
          (intList || []).forEach(i => {
            if (i.producto_id) {
              mapIntercambios[i.producto_id] = {
                cantidad: (mapIntercambios[i.producto_id]?.cantidad || 0) + Number(i.cantidad || 0),
                nombre: i.nombre_snap
              };
            }
          });
        }
      }

      // 3. Consolidar mapa de productos y calcular cantidad neta a restaurar
      const prodsToRestore = {}; // { prodId: { cant: number, nombre: string } }
      itemsOrig.forEach(it => {
        const devueltosPrevio = mapDevoluciones[it.producto_id] || 0;
        const cantNetaOriginal = Number(it.cantidad || 0) - devueltosPrevio;
        prodsToRestore[it.producto_id] = {
          cant: cantNetaOriginal,
          nombre: it.nombre_snap
        };
      });

      // Sumar ítems de intercambio (que fueron egresados y deben devolverse a stock)
      Object.keys(mapIntercambios).forEach(pId => {
        const intObj = mapIntercambios[pId];
        if (prodsToRestore[pId]) {
          prodsToRestore[pId].cant += intObj.cantidad;
        } else {
          prodsToRestore[pId] = {
            cant: intObj.cantidad,
            nombre: intObj.nombre
          };
        }
      });

      const loteId = crypto.randomUUID();
      const movimientos = [];

      for (const pId of Object.keys(prodsToRestore)) {
        const itemInfo = prodsToRestore[pId];
        if (itemInfo.cant <= 0) continue;

        const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${pId}&select=stock_actual,nombre`, { headers });
        const [prod] = await pRes.json();
        if (prod) {
          const stockAnterior = Number(prod.stock_actual);
          const nuevoStock = stockAnterior + itemInfo.cant;
          await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${pId}`, {
            method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ stock_actual: nuevoStock }),
          });
          movimientos.push({
            lote_id: loteId,
            tipo: 'ingreso',
            motivo: nuevoEstado === 'anulada'
              ? `Anulación de despacho #${desp.numero} (Ajuste neto inventario)`
              : `Reversión de despacho #${desp.numero} a ${nuevoEstado === 'pendiente' ? 'pendiente' : 'aprobado'}`,
            motivo_tipo: 'venta',
            producto_id: pId,
            producto_nombre: itemInfo.nombre || prod.nombre,
            cantidad: itemInfo.cant,
            stock_anterior: stockAnterior,
            stock_nuevo: nuevoStock,
            usuario_id: user.operator_id,
            usuario_nombre: operador.nombre,
            usuario_color: operador.color || null,
          });
        }
      }

      if (movimientos.length > 0) {
        const revKardexRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
          method: 'POST', headers,
          body: JSON.stringify(movimientos),
        });
        if (!revKardexRes.ok) {
          console.error('[REVERSAR] Fallo al registrar Kardex:', await revKardexRes.text());
        }
      }
    }

    // 3b. Al confirmar entrega: descontar stock + registrar kardex.
    // P0-B lo delega al wrapper neutral; esta rama queda solo como referencia
    // para transiciones no portadas y no debe ejecutarse cuando hubo RPC.
    if (!entregaAtomica && nuevoEstado === 'entregada') {
      const ciResEnt = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notas_despacho_items?despacho_id=eq.${despachoId}&producto_id=not.is.null&origen=eq.inventario&select=producto_id,cantidad,nombre_snap`,
        { headers }
      );
      const itemsEnt = await ciResEnt.json();

      if (itemsEnt.length > 0) {
        // Consultar si la cuenta permite stock negativo (Venta Anticipada)
        let permitirNegativo = false;
        try {
          const cuentaId = operador?.cuenta_id || user?.id || desp?.cuenta_id;
          const configUrl = cuentaId
            ? `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${cuentaId}&select=*&limit=1`
            : `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?select=*&limit=1`;
          const cfgRes = await fetch(configUrl, { headers });
          if (cfgRes.ok) {
            const [cfgData] = await cfgRes.json();
            permitirNegativo = cfgData?.permitir_stock_negativo === true ||
              (Array.isArray(cfgData?._comision_extras) && cfgData._comision_extras.some(x => x && typeof x === 'object' && x.__meta_venta_anticipada === true));
          }
        } catch (e) {
          console.warn('[VENTA ANTICIPADA] Error leyendo config permitir_stock_negativo:', e);
        }

        const prodIdsEnt = itemsEnt.map(i => i.producto_id);
        const prodResEnt = await fetch(
          `${env.SUPABASE_URL}/rest/v1/productos?id=in.(${prodIdsEnt.join(',')})&activo=eq.true&select=id,stock_actual,stock_minimo,nombre,unidad`,
          { headers }
        );
        const productosEnt = await prodResEnt.json();
        const stockMapEnt = Object.fromEntries(productosEnt.map(p => [p.id, p]));

        // Verificar existencia de productos y stock suficiente (salvo Venta Anticipada)
        for (const item of itemsEnt) {
          const prod = stockMapEnt[item.producto_id];
          if (!prod) return jsonError(`Producto "${item.nombre_snap}" no encontrado o inactivo`, 400, request);
          const stockAnterior = Number(prod.stock_actual);
          const cantReq = Number(item.cantidad);
          if (stockAnterior < cantReq && !permitirNegativo) {
            return jsonError(`Stock insuficiente para "${prod.nombre}": disponible ${stockAnterior}, requerido ${cantReq}`, 400, request);
          }
        }

        // Descontar stock y registrar kardex
        const loteIdEnt = crypto.randomUUID();
        const movimientosEnt = [];
        for (const item of itemsEnt) {
          const prod = stockMapEnt[item.producto_id];
          const stockAnterior = Number(prod.stock_actual);
          const nuevoStock = stockAnterior - Number(item.cantidad);
          await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
            method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ stock_actual: nuevoStock }),
          });

          const esVentaAnticipada = nuevoStock < 0;
          movimientosEnt.push({
            lote_id: loteIdEnt,
            tipo: 'egreso',
            motivo: esVentaAnticipada
              ? `Entrega confirmada [VENTA ANTICIPADA] — Despacho #${desp.numero}`
              : `Entrega confirmada — Despacho #${desp.numero}`,
            motivo_tipo: 'venta',
            producto_id: item.producto_id,
            producto_nombre: item.nombre_snap || prod.nombre,
            cantidad: Number(item.cantidad),
            stock_anterior: stockAnterior,
            stock_nuevo: nuevoStock,
            usuario_id: user.operator_id,
            usuario_nombre: operador.nombre,
            usuario_color: operador.color || null,
          });
        }
        if (movimientosEnt.length > 0) {
          const kardexRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
            method: 'POST', headers,
            body: JSON.stringify(movimientosEnt),
          });
          if (!kardexRes.ok) {
            const kardexErr = await kardexRes.text();
            return jsonError(`Error al registrar kardex de entrega: ${kardexErr}`, 500, request);
          }
        }
      }
    }

    // 4. Actualizar estado
    const updateData = { estado: nuevoEstado };
    const ahora = new Date().toISOString();
    if (nuevoEstado === 'despachada') {
      updateData.despachada_en = ahora;
      updateData.aprobado_por_nombre = operador.nombre;
    }
    if (nuevoEstado === 'entregada') {
      updateData.entregada_en = ahora;
      if (!desp.despachada_en) updateData.despachada_en = ahora; // auto-despachar
      // Guardar tasa del momento de entrega
      if (tasaBcv && Number(tasaBcv) > 0) updateData.tasa_snapshot = Number(tasaBcv);
    }
    if (nuevoEstado === 'pendiente' && (desp.estado === 'despachada' || desp.estado === 'entregada')) {
      updateData.motivo_devolucion = body.motivo_devolucion;
      updateData.entregada_en = null;
      updateData.flete_pagado = false;
    }
    if (nuevoEstado === 'anulada' && (desp.estado === 'despachada' || desp.estado === 'entregada')) {
      updateData.motivo_anulacion = body.motivo_anulacion;
      updateData.flete_pagado = false;
    }
    if (nuevoEstado === 'despachada' && desp.estado === 'entregada') {
      updateData.entregada_en = null;
    }

    // Resetear metadatos de pago COD si se devuelve o anula desde despachada o entregada
    if (['pendiente', 'anulada'].includes(nuevoEstado) && (desp.estado === 'despachada' || desp.estado === 'entregada')) {
      const cleanFormaPago = (fpRaw) => {
        if (!fpRaw) return fpRaw;
        try {
          const fps = typeof fpRaw === 'string' ? JSON.parse(fpRaw) : fpRaw;
          if (Array.isArray(fps)) {
            const updated = fps.map(f => {
              if (f.metodo === 'Cobro a destino') {
                const copy = { ...f };
                copy.cobro_destino_pagado = false;
                if (Array.isArray(copy.metodos_pagados) && copy.metodos_pagados.length > 0) {
                  copy.metodo_propuesto = copy.metodos_pagados.map(p => ({
                    metodo: p.metodo,
                    monto: String(p.monto),
                    referencia: p.referencia || ""
                  }));
                }
                delete copy.metodos_pagados;
                return copy;
              }
              return f;
            });
            return JSON.stringify(updated);
          }
        } catch (err) {
          console.error('[CXC] Error reseteando metadatos de pago COD:', err);
        }
        return fpRaw;
      };

      if (desp.forma_pago) updateData.forma_pago = cleanFormaPago(desp.forma_pago);
      if (desp.forma_pago_cliente) updateData.forma_pago_cliente = cleanFormaPago(desp.forma_pago_cliente);
    }

    // 4b. Revertir CxC si se devuelve o anula desde despachada o entregada
    if (!reversaAtomica && ['pendiente', 'anulada'].includes(nuevoEstado) && (desp.estado === 'despachada' || desp.estado === 'entregada')) {
      try {
        const clienteCxCId = desp.cliente_factura_id || desp.cliente_id;
        if (clienteCxCId) {
          // Eliminar tanto cargos como abonos asociados a este despacho
          await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}`, {
            method: 'DELETE',
            headers,
          });
          console.log(`[CXC] Movimientos CxC eliminados para despacho ${despachoId}`);
          
          // Recalcular saldo pendiente del cliente de forma unificada
          await recalcularSaldoPendienteCliente(clienteCxCId, env, headers);
        }
      } catch (cxcRevErr) {
        console.error('[CXC] Error al revertir CxC:', cxcRevErr?.message);
        /* no crítico — no bloquear operación por error CxC */
      }
    }

    // 4c. Solo las comisiones 238b se eliminan al revertir el despacho.
    // Las filas legacy se conservan exactamente como fueron registradas.
    if (!reversaAtomica && ['despachada', 'entregada'].includes(desp.estado) && ['pendiente', 'anulada'].includes(nuevoEstado)) {
      try {
        const comisionActual = await obtenerComisionExistente(despachoId, headers, env)
        if (esComisionNueva238b(comisionActual)) {
          await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionActual.id}`, {
            method: 'DELETE', headers,
          })
          console.log('[COMISION] Comisión 238b eliminada por reversión de despacho.')
        } else if (comisionActual) {
          console.log('[COMISION] Comisión legacy preservada durante reversión.')
        }
      } catch (comRevErr) {
        console.error('[COMISION] Error al revertir comisión:', comRevErr?.message)
      }
    }

    if (!entregaAtomica && !reversaAtomica) {
      const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(updateData),
      });
      if (!patchRes.ok) {
        const err = await patchRes.text();
        console.error('[DESPACHOS] Error al hacer PATCH notas_despacho:', err);
        return jsonError(`Error BD al actualizar despacho: ${err}`, 500, request);
      }
    }

    // 5. Al aprobar (despachada): registrar cargo CxC si hay saldo a crédito / abono si hay Saldo a Favor
    if (!reversaAtomica && nuevoEstado === 'despachada') {
      try {
        const fpRaw = desp.forma_pago_cliente || desp.forma_pago || '[]';
        let itemsCargos = []; // [{ monto: number, dias: number|null, metodo: 'cxc'|'cod', desc: string }]
        let abonoSaldoFavor = null; // { monto: number, origen: string }
        let fps = [];
        try {
          fps = typeof fpRaw === 'string' ? JSON.parse(fpRaw) : fpRaw;
          if (Array.isArray(fps)) {
            const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
            const cod = fps.find(f => f.metodo === 'Cobro a destino');
            const sf = fps.find(f => f.metodo === 'Saldo a Favor');
            if (cxc && Number(cxc.monto) > 0) {
              itemsCargos.push({
                monto: Number(cxc.monto),
                dias: cxc.diasVencimiento ? parseInt(cxc.diasVencimiento, 10) : null,
                metodo: 'cxc',
                desc: ' (Crédito)'
              });
            }
            if (cod && Number(cod.monto) > 0) {
              itemsCargos.push({
                monto: Number(cod.monto),
                dias: cod.diasVencimiento ? parseInt(cod.diasVencimiento, 10) : null,
                metodo: 'cod',
                desc: ' (COD)'
              });
            }
            if (sf && Number(sf.monto) > 0) {
              abonoSaldoFavor = {
                monto: Number(sf.monto),
                origen: sf.forma_pago_origen || 'Crédito'
              };
            }
          }
        } catch {
          if (fpRaw === 'Cta por cobrar' && Number(desp.total_usd) > 0) {
            itemsCargos.push({
              monto: Number(desp.total_usd),
              dias: null,
              metodo: 'cxc',
              desc: ' (Crédito)'
            });
          }
        }

        let cot = null;
        if (desp.cotizacion_id) {
          const cotRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${desp.cotizacion_id}&select=cliente_id,numero`,
            { headers }
          );
          if (cotRes.ok) {
            const cotList = await cotRes.json();
            cot = cotList[0] || null;
          }
        }
        const clienteCxCId = desp.cliente_factura_id || desp.cliente_id || (cot ? cot.cliente_id : null);

        if (clienteCxCId) {
          // 5.a. Registrar cargos
          if (itemsCargos.length > 0) {
            const cxcExistRes = await fetch(
              `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.cargo&select=id`,
              { headers }
            );
            const cxcExist = await cxcExistRes.json();
            if (!Array.isArray(cxcExist) || cxcExist.length === 0) {
              for (const item of itemsCargos) {
                const saldoRes = await fetch(
                  `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_pendiente`,
                  { headers }
                );
                const [clienteSaldo] = await saldoRes.json();
                const saldoActual = Number(clienteSaldo?.saldo_pendiente || 0);
                const nuevoSaldo = saldoActual + item.monto;

                let fecha_vencimiento = null;
                if (item.dias && !isNaN(item.dias)) {
                  const date = new Date();
                  date.setDate(date.getDate() + item.dias);
                  fecha_vencimiento = date.toISOString().split('T')[0];
                }

                await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
                  method: 'POST', headers,
                  body: JSON.stringify({
                    cliente_id: clienteCxCId,
                    despacho_id: despachoId,
                    tipo: 'cargo',
                    monto_usd: item.monto,
                    saldo_usd: nuevoSaldo,
                    descripcion: `Orden de despacho #${cot ? cot.numero : despachoId}${item.desc}`,
                    registrado_por: user.operator_id,
                    fecha_vencimiento: fecha_vencimiento,
                    metodo_pago: item.metodo
                  }),
                });
              }
            }
          }

          // 5.b. Registrar abono por Saldo a Favor
          if (abonoSaldoFavor) {
            const abonoExistRes = await fetch(
              `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.consumo_credito&select=id`,
              { headers }
            );
            const abonoExist = await abonoExistRes.json();
            if (!Array.isArray(abonoExist) || abonoExist.length === 0) {
              const saldoRes = await fetch(
                `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_pendiente,saldo_a_favor`,
                { headers }
              );
              const [clienteSaldo] = await saldoRes.json();
              const saldoFavorActual = Number(clienteSaldo?.saldo_a_favor || 0);
              const nuevoSaldoFavor = Math.max(0, saldoFavorActual - abonoSaldoFavor.monto);

              await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
                method: 'POST', headers,
                body: JSON.stringify({
                  cliente_id: clienteCxCId,
                  despacho_id: despachoId,
                  tipo: 'consumo_credito',
                  monto_usd: abonoSaldoFavor.monto,
                  saldo_usd: nuevoSaldoFavor,
                  forma_pago_abono: 'Saldo a favor',
                  referencia: `Despacho #${cot ? cot.numero : despachoId}`,
                  descripcion: `Pago con Saldo a Favor (${abonoSaldoFavor.origen.toUpperCase()})`,
                  registrado_por: user.operator_id
                }),
              });
            }
          }

          // 5.c. Registrar crédito por vuelto/excedente a Saldo a Favor
          const totalAsignado = fps.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
          const excedente = totalAsignado - Number(desp.total_usd || 0);
          const tieneVueltoAFavor = fps.some(f => f.vuelto_a_favor === true);

          if (excedente > 0.015 && tieneVueltoAFavor) {
            const creditoExistRes = await fetch(
              `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.credito&select=id`,
              { headers }
            );
            const creditoExist = await creditoExistRes.json();
            if (!Array.isArray(creditoExist) || creditoExist.length === 0) {
              const saldoRes = await fetch(
                `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_pendiente`,
                { headers }
              );
              const [clienteSaldo] = await saldoRes.json();
              const saldoActual = Number(clienteSaldo?.saldo_pendiente || 0);

              await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
                method: 'POST', headers,
                body: JSON.stringify({
                  cliente_id: clienteCxCId,
                  despacho_id: despachoId,
                  tipo: 'credito',
                  monto_usd: Math.round(excedente * 100) / 100,
                  saldo_usd: saldoActual,
                  referencia: `Despacho #${cot ? cot.numero : despachoId}`,
                  descripcion: `Excedente de pago en Despacho #${cot ? cot.numero : despachoId}`,
                  registrado_por: user.operator_id
                }),
              });
            }
          }

          // Recalcular saldo del cliente una sola vez al final
          await recalcularSaldoPendienteCliente(clienteCxCId, env, headers);
        }
      } catch (cxcErr) {
        console.error('[CXC] Error al registrar CxC al aprobar:', cxcErr?.message);
        /* no crítico — no bloquear aprobación por error CxC */
      }
    }

    // 5b. Calcular comisión al aprobar o entregar
    if (!entregaAtomica && !reversaAtomica && (nuevoEstado === 'despachada' || nuevoEstado === 'entregada')) {
      try {
        const vendedorIdComision = await obtenerVendedorComisionId(desp, headers, env);
        const vendRolRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${vendedorIdComision}&select=rol,markup_pct`,
          { headers }
        );
        const [vendRol] = await vendRolRes.json();
        console.log('[COMISION] rol vendedor:', vendRol?.rol, 'markup:', vendRol?.markup_pct);

        const esDonacion = pagoEsDonacion(desp.forma_pago_cliente, desp.forma_pago)

        if (!esDonacion && !['jefe', 'logistica', 'administracion', 'desarrollador'].includes(vendRol?.rol) && (vendRol?.rol !== 'vendedor_sin_comision' || parseFloat(vendRol?.markup_pct || 0) > 0)) {
          if (pagoMixtoRequiereRevision(desp.total_usd, desp.forma_pago_cliente, desp.forma_pago)) {
            console.warn('[COMISION] Pago mixto sin montos explícitos; queda para revisión manual.', { despachoId })
          } else {
            const comRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calcularcomisiondespacho_238b`, {
              method: 'POST', headers,
              body: JSON.stringify({ p_despachoid: despachoId }),
            });
            if (!comRes.ok) {
              const comErr = await comRes.text();
              console.error('[COMISION] Error al calcular:', comErr);
            } else {
              const comisionId = await comRes.json();
              console.log('[COMISION] Creada con id:', comisionId);
            }
          }
        } else {
          console.log('[COMISION] Vendedor sin comisión, rol administrativo o donación, se omite el cálculo.');
        }
      } catch (comEx) {
        console.error('[COMISION] Error al calcular:', comEx?.message);
      }
    }

    // 6. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'ACTUALIZAR_DESPACHO',
      entidadTipo: 'nota_despacho', entidadId: despachoId,
      meta: { estado_anterior: desp.estado, estado_nuevo: nuevoEstado, cotizacion_id: desp.cotizacion_id }, ip,
    });

    return json({
      ok: true,
      nuevoEstado,
      idempotency_key: idempotencyKey,
      inventario_atomico: Boolean(entregaAtomica || reversaAtomica),
      finanzas_atomicas: Boolean(entregaAtomica?.finanzas_atomicas || reversaAtomica),
      frontera_financiera: entregaAtomica ? 'sql_atomic' : null,
      // Release 06: contadores para el toast/UX de reversión consciente de devoluciones.
      abonos_devolucion_anulados: reversaAtomica?.abonos_devolucion_anulados ?? null,
      credito_anulado_usd: reversaAtomica?.credito_anulado_usd ?? null,
    }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al actualizar despacho', 500, request);
  }
}

export async function handleReciclarDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { despachoId } = body;
  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);

  try {
    // 1. Obtener despacho
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=*`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);
    if (desp.estado !== 'anulada') return jsonError('Solo se pueden reciclar despachos anulados', 400, request);

    const rolOp = operador.rol;
    const esVendedorPropio = ['vendedor', 'vendedor_sin_comision'].includes(rolOp) && desp.vendedor_id === operador.id;
    if (!['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(rolOp) && !esVendedorPropio) {
      return jsonError('No tiene permiso para reciclar despachos', 403, request);
    }

    // 2. Obtener cotización original
    const cotRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${desp.cotizacion_id}&select=*`, { headers });
    const [cotOrig] = await cotRes.json();
    if (!cotOrig) return jsonError('Cotización original no encontrada', 404, request);

    // 3. Crear nueva cotización borrador
    const nuevaRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id,numero`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        version: 1,
        cliente_id: cotOrig.cliente_id,
        vendedor_id: cotOrig.vendedor_id,
        transportista_id: cotOrig.transportista_id,
        estado: 'borrador',
        subtotal_usd: cotOrig.subtotal_usd,
        descuento_global_pct: cotOrig.descuento_global_pct,
        descuento_usd: cotOrig.descuento_usd,
        costo_envio_usd: cotOrig.costo_envio_usd,
        total_usd: cotOrig.total_usd,
        notas_cliente: cotOrig.notas_cliente,
        notas_internas: cotOrig.notas_internas,
      }),
    });
    if (!nuevaRes.ok) return jsonError('Error al crear cotización', 500, request);
    const [nueva] = await nuevaRes.json();

    // 4. Copiar items
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${desp.cotizacion_id}&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden`,
      { headers }
    );
    const items = await itemsRes.json();
    if (items.length > 0) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST', headers,
        body: JSON.stringify(items.map(it => ({ ...it, cotizacion_id: nueva.id }))),
      });
    }

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'RECICLAR_DESPACHO',
      entidadTipo: 'cotizacion', entidadId: nueva.id,
      meta: { despacho_id: despachoId, cotizacion_original_id: desp.cotizacion_id, total_usd: cotOrig.total_usd }, ip,
    });

    return json({ id: nueva.id, numero: nueva.numero }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al reciclar despacho', 500, request);
  }
}

export async function handleEditarItemsDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  // ── 1. Roles autorizados para edición profunda ─────────────────────────────
  // La edición profunda queda reservada a administración, jefatura y desarrollo.
  // El estado se valida nuevamente abajo y en el RPC.
  if (!['administracion', 'jefe', 'desarrollador'].includes(operador.rol)) {
    return jsonError('No tienes permiso para editar profundamente el despacho', 403, request);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Body inválido', 400, request); }

  const { despachoId, items, pagos } = body;
  // items: [{ producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, descuento_pct, orden }]
  // pagos: string (JSON stringified array of payments)

  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);
  if (!Array.isArray(items) || items.length === 0) return jsonError('items no puede estar vacío', 400, request);

  // Rechazar duplicados comerciales antes de tocar Supabase. Dos líneas del
  // mismo producto solo son válidas si difieren en precio, descuento, origen o
  // modalidad venta/préstamo.
  const clavesItems = new Set()
  for (const item of items) {
    if (!Number.isFinite(Number(item?.cantidad)) || Number(item.cantidad) <= 0) {
      return jsonError('Cantidad inválida en los ítems del despacho', 400, request)
    }
    if (!Number.isFinite(Number(item?.precio_unit_usd)) || Number(item.precio_unit_usd) < 0) {
      return jsonError('Precio inválido en los ítems del despacho', 400, request)
    }
    const clave = [
      item?.producto_id ?? '',
      Number(item?.precio_unit_usd ?? 0).toFixed(4),
      Number(item?.descuento_pct ?? 0).toFixed(4),
      item?.origen || 'inventario',
      item?.es_prestamo || item?.esPrestamo ? 'prestamo' : 'venta',
    ].join('|')
    if (clavesItems.has(clave)) {
      return jsonError('El despacho contiene líneas duplicadas. Actualiza el modal y deja una sola línea por producto y condición comercial.', 400, request)
    }
    clavesItems.add(clave)
  }

  try {
    const despachoRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}&select=id,cuenta_id,estado,total_usd,flete_usd,corte_usd,descuento_total_usd,forma_pago,forma_pago_cliente`,
      { headers },
    )
    if (!despachoRes.ok) return jsonError('Error al verificar despacho', 500, request)
    const [despachoActual] = await despachoRes.json()
    if (!despachoActual) return jsonError('Despacho no encontrado', 404, request)
    if (despachoActual.estado !== 'pendiente') {
      return jsonError('La edición profunda solo está permitida para despachos pendientes', 400, request)
    }

    const comisionAntes = await obtenerComisionExistente(despachoId, headers, env)
    const totalItemsPosterior = items.reduce((sum, item) => {
      if (item?.es_prestamo || item?.esPrestamo) return sum
      const cantidad = Number(item?.cantidad || 0)
      const precio = Number(item?.precio_unit_usd ?? item?.precioUnitUsd ?? 0)
      const descuento = Number(item?.descuento_pct || 0)
      return sum + Math.max(0, cantidad * precio * (1 - descuento / 100))
    }, 0)
    const totalPosterior = totalItemsPosterior
      + Number(despachoActual.flete_usd || 0)
      + Number(despachoActual.corte_usd || 0)
      - Number(despachoActual.descuento_total_usd || 0)
    if (esComisionNueva238b(comisionAntes)
      && pagoMixtoRequiereRevision(
        totalPosterior,
        pagos !== undefined ? pagos : despachoActual.forma_pago_cliente,
        pagos !== undefined ? pagos : despachoActual.forma_pago,
      )) {
      return jsonError('Pago mixto sin montos explícitos: complete los montos de CxC y del método no-CxC antes de editar el despacho.', 400, request)
    }

    if (pagos) {
      try {
        const fps = typeof pagos === 'string' ? JSON.parse(pagos) : pagos;
        if (Array.isArray(fps)) {
          const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
          if (cxc) {
            const dias = parseInt(cxc.diasVencimiento, 10);
            if (isNaN(dias) || dias <= 0) {
              return jsonError('Los días de vencimiento son obligatorios para cuentas por cobrar', 400, request);
            }
          }
        }
      } catch { /* pagos malformados; se ignoran */ }
    }

    // ── 2. Llamar al RPC que maneja la transacción e inventario ────────────────
    console.log('[DEEP_EDIT][WORKER_BEFORE_RPC]', {
      despachoId,
      workerItemCount: items.length,
      workerItems: items,
      operadorId: operador.id,
      operadorRol: operador.rol,
      supabaseUrl: env.SUPABASE_URL
    })
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/editar_despacho_profundidad`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        p_despacho_id:    despachoId,
        p_nuevos_items:   items,
        p_usuario_id:     operador.id,
        p_usuario_nombre: operador.nombre,
        p_usuario_rol:    operador.rol,
        p_forma_pago:     pagos || null
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[DEEP_EDIT][WORKER_RPC_ERROR]', { status: res.status, body: err, despachoId })
      let msg = 'Error al editar despacho';
      if (err.includes('STOCK_INSUFICIENTE')) msg = err.split(': ')[1] || err;
      if (err.includes('ESTADO_INVALIDO')) msg = 'El despacho no se puede editar en su estado actual';
      return jsonError(msg, 400, request);
    }

    console.log('[DEEP_EDIT][WORKER_AFTER_RPC]', { despachoId, status: res.status, sentItemCount: items.length })

    // ── 2b. Sincronizar Cuentas por Cobrar ────────────────────────────────────
    // La edición profunda solo llega aquí para despachos pendientes. Esta rama
    // conserva la compatibilidad de pagos, pero no habilita edición post-aprobación.
    try {
      const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=estado,cliente_id,cliente_factura_id,cotizacion_id,total_usd,forma_pago,forma_pago_cliente`, { headers });
      const despList = await dRes.json();
      if (Array.isArray(despList) && despList.length > 0) {
        const updatedDesp = despList[0];
        
        if (updatedDesp.estado === 'despachada') {
          const fpRaw = updatedDesp.forma_pago_cliente || updatedDesp.forma_pago || '[]';
          let itemsCargos = [];
          let targetAbono = null;
          try {
            const fps = typeof fpRaw === 'string' ? JSON.parse(fpRaw) : fpRaw;
            if (Array.isArray(fps)) {
              const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
              const cod = fps.find(f => f.metodo === 'Cobro a destino');
              const sf = fps.find(f => f.metodo === 'Saldo a Favor');
              if (cxc && Number(cxc.monto) > 0) {
                itemsCargos.push({
                  monto: Number(cxc.monto),
                  dias: cxc.diasVencimiento ? parseInt(cxc.diasVencimiento, 10) : null,
                  metodo: 'cxc',
                  desc: ' (Crédito)'
                });
              }
              if (cod && Number(cod.monto) > 0) {
                itemsCargos.push({
                  monto: Number(cod.monto),
                  dias: cod.diasVencimiento ? parseInt(cod.diasVencimiento, 10) : null,
                  metodo: 'cod',
                  desc: ' (COD)'
                });
              }
              if (sf && Number(sf.monto) > 0) {
                targetAbono = {
                  monto: Number(sf.monto),
                  origen: sf.forma_pago_origen || 'Crédito'
                };
              }
            }
          } catch {
            if (fpRaw === 'Cta por cobrar' && Number(updatedDesp.total_usd) > 0) {
              itemsCargos.push({
                monto: Number(updatedDesp.total_usd),
                dias: null,
                metodo: 'cxc',
                desc: ' (Crédito)'
              });
            }
          }

          // Buscar cargos y abonos existentes en CxC para este despacho
          const cxcExistRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&select=id,monto_usd,cliente_id,tipo,metodo_pago,forma_pago_abono`,
            { headers }
          );
          const cxcExist = await cxcExistRes.json();
          const dbMovimientos = Array.isArray(cxcExist) ? cxcExist : [];

          const cotRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${updatedDesp.cotizacion_id}&select=cliente_id,numero`,
            { headers }
          );
          const [cot] = await cotRes.json();
          const clienteCxCId = updatedDesp.cliente_factura_id || updatedDesp.cliente_id || (cot ? cot.cliente_id : null);

          if (clienteCxCId) {
            // Sincronizar cargos (tipo 'cargo')
            const metodos = ['cxc', 'cod'];
            const dbCargos = dbMovimientos.filter(m => m.tipo === 'cargo');
            for (const met of metodos) {
              const target = itemsCargos.find(it => it.metodo === met);
              const existing = dbCargos.find(c => c.metodo_pago === met);

              if (existing) {
                if (!target) {
                  // Si ya no existe este método de pago, eliminamos el cargo de CxC
                  await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${existing.id}`, {
                    method: 'DELETE', headers,
                  });
                  console.log(`[CXC-DEEP-EDIT] Cargo CxC (${met}) eliminado en edición profunda por quedar en $0.`);
                } else {
                  // Si existe y cambió el monto, actualizamos
                  const diff = target.monto - Number(existing.monto_usd);
                  if (diff !== 0) {
                    await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${existing.id}`, {
                      method: 'PATCH',
                      headers: { ...headers, Prefer: 'return=minimal' },
                      body: JSON.stringify({ monto_usd: Math.round(target.monto * 10000) / 10000 }),
                    });
                    console.log(`[CXC-DEEP-EDIT] Ajustado cargo (${met}) de despacho ${despachoId} a $${target.monto}.`);
                  }
                }
              } else if (target) {
                // Si no existía pero ahora sí requiere uno
                let fecha_vencimiento = null;
                if (target.dias && !isNaN(target.dias)) {
                  const date = new Date();
                  date.setDate(date.getDate() + target.dias);
                  fecha_vencimiento = date.toISOString().split('T')[0];
                }

                await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
                  method: 'POST', headers,
                  body: JSON.stringify({
                    cliente_id: clienteCxCId,
                    despacho_id: despachoId,
                    tipo: 'cargo',
                    monto_usd: target.monto,
                    saldo_usd: target.monto,
                    descripcion: `Orden de despacho #${cot ? cot.numero : despachoId}${target.desc} (Creado en edición profunda)`,
                    registrado_por: user.operator_id,
                    fecha_vencimiento: fecha_vencimiento,
                    metodo_pago: target.metodo
                  }),
                });
                console.log(`[CXC-DEEP-EDIT] Cargo CxC (${met}) creado en edición profunda por monto $${target.monto}.`);
              }
            }

            // Sincronizar Abono Saldo a Favor
            const existingAbono = dbMovimientos.find(m => m.tipo === 'abono' && m.forma_pago_abono === 'Saldo a favor');
            if (existingAbono) {
              if (!targetAbono) {
                // Si ya no existe, eliminamos el abono
                await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${existingAbono.id}`, {
                  method: 'DELETE', headers,
                });
                console.log(`[CXC-DEEP-EDIT] Abono Saldo a Favor eliminado en edición profunda.`);
              } else {
                // Si existe y cambió el monto, actualizamos
                const diff = targetAbono.monto - Number(existingAbono.monto_usd);
                if (diff !== 0) {
                  await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${existingAbono.id}`, {
                    method: 'PATCH',
                    headers: { ...headers, Prefer: 'return=minimal' },
                    body: JSON.stringify({ monto_usd: Math.round(targetAbono.monto * 10000) / 10000 }),
                  });
                  console.log(`[CXC-DEEP-EDIT] Ajustado abono Saldo a Favor de despacho ${despachoId} a $${targetAbono.monto}.`);
                }
              }
            } else if (targetAbono) {
              // Si no existía pero ahora sí, lo creamos
              const saldoRes = await fetch(
                `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_pendiente`,
                { headers }
              );
              const [clienteSaldo] = await saldoRes.json();
              const saldoActual = Number(clienteSaldo?.saldo_pendiente || 0);
              const nuevoSaldo = Math.max(0, saldoActual - targetAbono.monto);

              await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
                method: 'POST', headers,
                body: JSON.stringify({
                  cliente_id: clienteCxCId,
                  despacho_id: despachoId,
                  tipo: 'abono',
                  monto_usd: targetAbono.monto,
                  saldo_usd: nuevoSaldo,
                  forma_pago_abono: 'Saldo a favor',
                  referencia: `Despacho #${cot ? cot.numero : despachoId}`,
                  descripcion: `Pago con Saldo a Favor (${targetAbono.origen.toUpperCase()}) (Creado en edición profunda)`,
                  registrado_por: user.operator_id
                }),
              });
            }

            // Sincronizar Crédito (tipo 'credito' - Vuelto/Excedente a Saldo a Favor)
            const fps = typeof fpRaw === 'string' ? JSON.parse(fpRaw) : fpRaw;
            const totalAsignado = Array.isArray(fps) ? fps.reduce((acc, f) => acc + (Number(f.monto) || 0), 0) : 0;
            const excedente = totalAsignado - Number(updatedDesp.total_usd || 0);
            const tieneVueltoAFavor = Array.isArray(fps) ? fps.some(f => f.vuelto_a_favor === true) : false;
            const targetCreditoMonto = (excedente > 0.015 && tieneVueltoAFavor) ? excedente : 0;

            const existingCredito = dbMovimientos.find(m => m.tipo === 'credito');
            if (existingCredito) {
              if (targetCreditoMonto <= 0.015) {
                // Si ya no hay excedente o no se quiere vuelto a favor, eliminamos el crédito
                await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${existingCredito.id}`, {
                  method: 'DELETE', headers,
                });
                console.log(`[CXC-DEEP-EDIT] Crédito (vuelto/excedente) eliminado en edición profunda.`);
              } else {
                // Si cambió el monto, actualizamos
                const diff = targetCreditoMonto - Number(existingCredito.monto_usd);
                if (diff !== 0) {
                  await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${existingCredito.id}`, {
                    method: 'PATCH',
                    headers: { ...headers, Prefer: 'return=minimal' },
                    body: JSON.stringify({ monto_usd: Math.round(targetCreditoMonto * 10000) / 10000 }),
                  });
                  console.log(`[CXC-DEEP-EDIT] Ajustado crédito (vuelto/excedente) a $${targetCreditoMonto}.`);
                }
              }
            } else if (targetCreditoMonto > 0.015) {
              // Si no existía pero ahora sí, lo creamos
              const saldoRes = await fetch(
                `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_pendiente`,
                { headers }
              );
              const [clienteSaldo] = await saldoRes.json();
              const saldoActual = Number(clienteSaldo?.saldo_pendiente || 0);

              await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
                method: 'POST', headers,
                body: JSON.stringify({
                  cliente_id: clienteCxCId,
                  despacho_id: despachoId,
                  tipo: 'credito',
                  monto_usd: Math.round(targetCreditoMonto * 100) / 100,
                  saldo_usd: saldoActual,
                  referencia: `Despacho #${cot ? cot.numero : despachoId}`,
                  descripcion: `Excedente de pago en Despacho #${cot ? cot.numero : despachoId} (Creado en edición profunda)`,
                  registrado_por: user.operator_id
                }),
              });
              console.log(`[CXC-DEEP-EDIT] Crédito (vuelto/excedente) creado en edición profunda.`);
            }

            // Al final recalculamos una sola vez el saldo
            await recalcularSaldoPendienteCliente(clienteCxCId, env, headers);
          }
        }
      }
    } catch (cxcErr) {
      console.error('[CXC-DEEP-EDIT] Error al sincronizar CxC en edición profunda:', cxcErr?.message);
    }


    // Recalcular solo comisiones nuevas 238b; el histórico legacy queda intacto.
    const comRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}&select=id,calculo_version`, { headers });
    const comEntries = await comRes.json();
    if (Array.isArray(comEntries) && comEntries.some(row => row.calculo_version === '238b')) {
      const dResCheck = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=vendedor_id,cliente_id`,
        { headers }
      );
      const [despCheck] = await dResCheck.json();
      const vendedorIdComision = await obtenerVendedorComisionId(despCheck, headers, env);
      const vendRolRes4 = await fetch(
        `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${vendedorIdComision}&select=rol,markup_pct`,
        { headers }
      );
      const [vendRol4] = await vendRolRes4.json();
      console.log('[COMISION][EDITAR_ITEMS] rol vendedor:', vendRol4?.rol, 'markup:', vendRol4?.markup_pct);

      if (!['jefe', 'logistica', 'administracion', 'desarrollador'].includes(vendRol4?.rol) && (vendRol4?.rol !== 'vendedor_sin_comision' || parseFloat(vendRol4?.markup_pct || 0) > 0)) {
        const recalcRes = await recalcularComision238b(despachoId, headers, env)
        if (!recalcRes.ok) console.error('[COMISION] Error al recalcular 238b:', await recalcRes.text())
      }
    }

    return json({ ok: true }, 200, request);
  } catch (e) {
    console.error('[EDITAR_ITEMS] Error:', e);
    return jsonError(e.message || 'Error interno al procesar el cambio', 500, request);
  }
}

export async function handleGuardarDescuentos(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // Solo administración o desarrollador
  if (!['administracion', 'jefe', 'desarrollador'].includes(operador.rol)) {
    return jsonError('Solo administración puede aplicar descuentos', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { despachoId, descuentos } = body;
  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);
  if (!Array.isArray(descuentos)) return jsonError('descuentos debe ser un array', 400, request);

  try {
    // 1. Obtener despacho
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=id,estado,cotizacion_id,total_usd`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);
    if (!['pendiente', 'despachada'].includes(desp.estado)) {
      return jsonError('Solo se pueden aplicar descuentos a despachos pendientes o despachados', 400, request);
    }

    // 2. Obtener ítems del despacho para validar
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/notas_despacho_items?despacho_id=eq.${despachoId}&select=id,total_linea_usd,precio_unit_usd,cantidad`,
      { headers }
    );
    const items = await itemsRes.json();
    const itemMap = Object.fromEntries(items.map(i => [i.id, i]));

    // 3. Validar y calcular cada descuento
    const descuentosValidos = [];
    for (const d of descuentos) {
      // Soportar despachoItemId (nuevo) o cotizacionItemId (legacy temporal)
      const itemId = d.despachoItemId || d.cotizacionItemId;
      if (!itemId || !isValidUuid(itemId)) continue;
      
      const item = itemMap[itemId];
      if (!item) continue;

      const tipo = d.tipo === 'monto' ? 'monto' : d.tipo === 'monto_unitario' ? 'monto_unitario' : 'porcentaje';
      const valor = Math.max(0, Number(d.valor) || 0);
      if (valor <= 0) continue;

      let montoUsd;
      if (tipo === 'porcentaje') {
        if (valor > 100) continue;
        montoUsd = Number(item.total_linea_usd) * valor / 100;
      } else if (tipo === 'monto_unitario') {
        montoUsd = valor * Number(item.cantidad);
        if (montoUsd > Number(item.total_linea_usd)) continue;
      } else {
        montoUsd = valor;
        if (montoUsd > Number(item.total_linea_usd)) continue;
      }
      montoUsd = Math.round(montoUsd * 10000) / 10000;

      descuentosValidos.push({
        despacho_id: despachoId,
        despacho_item_id: itemId,
        tipo,
        valor,
        monto_usd: montoUsd,
        aplicado_por: user.operator_id,
      });
    }

    // 4. Eliminar descuentos existentes del despacho
    await fetch(`${env.SUPABASE_URL}/rest/v1/despacho_descuentos?despacho_id=eq.${despachoId}`, {
      method: 'DELETE', headers,
    });

    // 5. Insertar nuevos descuentos (si hay)
    if (descuentosValidos.length > 0) {
      const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/despacho_descuentos`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(descuentosValidos),
      });
      if (!insRes.ok) {
        const err = await insRes.text();
        return jsonError('Error al guardar descuentos: ' + err, 500, request);
      }
    }

    // 6. Calcular y actualizar descuento_total_usd en notas_despacho
    const descuentoTotal = descuentosValidos.reduce((sum, d) => sum + d.monto_usd, 0);
    const descTotalRounded = Math.round(descuentoTotal * 10000) / 10000;
    const descuentoPrevio = Number(desp.descuento_total_usd || 0);

    await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ descuento_total_usd: descTotalRounded }),
    });

    // 7. Ajustar CxC si existe un cargo para este despacho
    const diffDescuento = descTotalRounded - descuentoPrevio;
    if (diffDescuento !== 0) {
      const cxcRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.cargo&select=id,monto_usd,cliente_id,metodo_pago`,
        { headers }
      );
      const cxcEntries = await cxcRes.json();
      if (Array.isArray(cxcEntries) && cxcEntries.length > 0) {
        const cxc = cxcEntries.find(c => c.metodo_pago === 'cxc') || cxcEntries[0];
        const nuevoMontoCxc = Math.max(0, Number(cxc.monto_usd) - diffDescuento);
        // Actualizar monto del cargo CxC
        await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${cxc.id}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ monto_usd: Math.round(nuevoMontoCxc * 10000) / 10000 }),
        });
        // Recalcular saldo pendiente de forma unificada para evitar drifts de coma flotante
        await recalcularSaldoPendienteCliente(cxc.cliente_id, env, headers);
      }

        // 8. Si existe una comisión 238b, recalcularla; las legacy no se tocan.
      const comRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}&select=id,calculo_version`, { headers });
      const comEntries = await comRes.json();
      if (Array.isArray(comEntries) && comEntries.some(row => row.calculo_version === '238b')) {
        const vendedorIdComision = await obtenerVendedorComisionId(desp, headers, env);
        const vendRolRes3 = await fetch(
          `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${vendedorIdComision}&select=rol,markup_pct`,
          { headers }
        );
        const [vendRol3] = await vendRolRes3.json();
        console.log('[COMISION][DESCUENTOS] rol vendedor:', vendRol3?.rol, 'markup:', vendRol3?.markup_pct);

        if (!['jefe'].includes(vendRol3?.rol) && (vendRol3?.rol !== 'vendedor_sin_comision' || parseFloat(vendRol3?.markup_pct || 0) > 0)) {
          const row238b = comEntries.find(row => row.calculo_version === '238b')
          await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${row238b.id}`, {
            method: 'DELETE', headers,
          });
          const recalcRes = await recalcularComision238b(despachoId, headers, env)
          if (!recalcRes.ok) console.error('[COMISION][DESCUENTOS] Error al recalcular 238b:', await recalcRes.text())
        }
      }
    }

    // 9. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'DESPACHO', accion: 'APLICAR_DESCUENTO',
      entidadTipo: 'nota_despacho', entidadId: despachoId,
      meta: { descuento_total_usd: descTotalRounded, items_con_descuento: descuentosValidos.length }, ip,
    });

    return json({ ok: true, descuento_total_usd: descTotalRounded, descuentos: descuentosValidos.length }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al guardar descuentos', 500, request);
  }
}

export async function handleObtenerDescuentos(request, env, url) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { headers } = v;

  // Extraer despachoId de /api/despachos/:id/descuentos
  const parts = url.pathname.split('/');
  const despachoId = parts[3];
  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/despacho_descuentos?despacho_id=eq.${despachoId}&select=id,despacho_item_id,cotizacion_item_id,tipo,valor,monto_usd,aplicado_por,creado_en`,
      { headers }
    );
    const descuentos = await res.json();
    return json(descuentos, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al obtener descuentos', 500, request);
  }
}

export async function handleDevolucionParcialDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  if (!['administracion', 'logistica', 'desarrollador', 'jefe'].includes(operador.rol)) {
    return jsonError('No tienes permiso para realizar una devolución parcial', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const {
    despachoId,
    items,
    motivo,
    generarReemplazo,
    exchangeItems,
    pagosDiferencia,
    destinoSaldo = 'saldo_a_favor',
    pagosReembolso,
    reembolsoMetodo,
    reembolsoReferencia,
    reembolsoMonto
  } = body || {};
  const idempotencyKey = resolverIdempotencyKey(request, body);

  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido o ausente', 400, request);
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request);
  if (!Array.isArray(items) || items.length === 0) return jsonError('items debe ser un array no vacío', 400, request);
  if (!motivo || motivo.trim() === '') return jsonError('El motivo es requerido', 400, request);

    const processedExchangeItems = [];
    let totalIntercambioUsd = 0;

    if (Array.isArray(exchangeItems) && exchangeItems.length > 0) {
      for (const it of exchangeItems) {
        const { producto_id, cantidad, precio_unit_usd } = it;
        if (!producto_id || !isValidUuid(producto_id)) {
          return jsonError(`producto_id inválido en el intercambio`, 400, request);
        }
        const qty = Number(cantidad);
        if (isNaN(qty) || qty <= 0) {
          return jsonError(`Cantidad inválida para producto de intercambio`, 400, request);
        }
        const price = Number(precio_unit_usd);
        if (isNaN(price) || price < 0) {
          return jsonError(`Precio inválido para producto de intercambio`, 400, request);
        }

        const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${producto_id}&cuenta_id=eq.${operador.cuenta_id}&select=nombre,codigo,unidad,stock_actual,activo`, { headers });
        const [prod] = await pRes.json();
        if (!prod) {
          return jsonError(`Producto de intercambio no encontrado`, 404, request);
        }
        if (!prod.activo) {
          return jsonError(`Producto de intercambio "${prod.nombre}" está inactivo`, 400, request);
        }

        const stockActual = Number(prod.stock_actual || 0);
        const nuevoStock = stockActual - qty;

        const lineTotal = Math.round((price * qty) * 10000) / 10000;
        totalIntercambioUsd += lineTotal;

        processedExchangeItems.push({
          producto_id,
          nombre_snap: prod.nombre,
          codigo_snap: prod.codigo,
          unidad_snap: prod.unidad || 'und',
          cantidad: qty,
          precio_unit_usd: price,
          total_usd: lineTotal,
          stock_actual: stockActual,
          nuevo_stock: nuevoStock
        });
      }
    }
    totalIntercambioUsd = Math.round(totalIntercambioUsd * 10000) / 10000;

  try {
    // 1. Obtener despacho dentro del tenant del operador
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}&select=*`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);
    const clienteCxCId = desp.cliente_factura_id || desp.cliente_id;

    if (desp.estado !== 'entregada') {
      return jsonError('El despacho debe estar en estado entregada para registrar una devolución parcial', 400, request);
    }

    // 2. Obtener ítems originales e intercambios previos
    const [diRes, intPrevRes] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho_items?despacho_id=eq.${despachoId}&select=*`, { headers }),
      fetch(`${env.SUPABASE_URL}/rest/v1/despacho_devolucion_intercambios?despacho_id=eq.${despachoId}&select=*`, { headers })
    ]);
    const originalItems = (await diRes.json()) || [];
    const exchangeItemsPrev = (await intPrevRes.json()) || [];

    const origItemMap = Object.fromEntries(originalItems.map(i => [i.id, i]));
    const exchangeItemMap = Object.fromEntries(exchangeItemsPrev.map(i => [i.id, i]));

    // 3. Obtener devoluciones previas
    const prevDevRes = await fetch(`${env.SUPABASE_URL}/rest/v1/despacho_devoluciones?despacho_id=eq.${despachoId}&select=despacho_item_id,producto_id,cantidad_devuelta`, { headers });
    const prevDevoluciones = (await prevDevRes.json()) || [];

    const returnedQtyMap = {};
    const returnedExchangeQtyMap = {};
    if (Array.isArray(prevDevoluciones)) {
      prevDevoluciones.forEach(d => {
        if (d.despacho_item_id) {
          returnedQtyMap[d.despacho_item_id] = (returnedQtyMap[d.despacho_item_id] || 0) + Number(d.cantidad_devuelta);
        } else if (d.producto_id) {
          returnedExchangeQtyMap[d.producto_id] = (returnedExchangeQtyMap[d.producto_id] || 0) + Number(d.cantidad_devuelta);
        }
      });
    }

    // 4. Validar ítems y cantidades (originales o de intercambio)
    const processedItems = [];
    let totalDevueltoUsd = 0;

    for (const it of items) {
      const { despacho_item_id, producto_id, cantidad_devuelta, es_intercambio, intercambio_id } = it;
      const qty = Number(cantidad_devuelta);

      const isExchange = Boolean(es_intercambio) || es_intercambio === 'true' || !despacho_item_id || despacho_item_id === 'null' || despacho_item_id === 'undefined';

      if (isExchange) {
        const intKey = (intercambio_id && intercambio_id !== 'null' && intercambio_id !== 'undefined') ? intercambio_id : (exchangeItemsPrev.find(x => x.producto_id === producto_id)?.id);
        const intItem = (intKey ? exchangeItemMap[intKey] : null) || exchangeItemsPrev.find(x => x.producto_id === producto_id);
        if (!intItem) {
          return jsonError(`Producto de intercambio previo no encontrado`, 400, request);
        }

        if (isNaN(qty) || qty <= 0) {
          return jsonError(`Cantidad a devolver inválida para el producto: ${intItem.nombre_snap}`, 400, request);
        }

        const alreadyReturned = returnedExchangeQtyMap[intItem.producto_id] || 0;
        const maxReturnable = Number(intItem.cantidad) - alreadyReturned;

        if (qty > maxReturnable) {
          return jsonError(`La cantidad a devolver (${qty}) supera el saldo disponible (${maxReturnable}) para el producto de intercambio: ${intItem.nombre_snap}`, 400, request);
        }

        const unitPrice = Number(intItem.precio_unit_usd);
        const lineTotalRefund = Math.round((unitPrice * qty) * 10000) / 10000;

        totalDevueltoUsd += lineTotalRefund;

        processedItems.push({
          despacho_item_id: null,
          producto_id: intItem.producto_id,
          nombre_snap: intItem.nombre_snap,
          codigo_snap: intItem.codigo_snap,
          unidad_snap: intItem.unidad_snap,
          cantidad_devuelta: qty,
          precio_unit_usd: unitPrice,
          total_devuelto_usd: lineTotalRefund,
          origen: 'intercambio'
        });
      } else {
        if (!despacho_item_id || !origItemMap[despacho_item_id]) {
          return jsonError(`Ítem con ID ${despacho_item_id} no pertenece a este despacho`, 400, request);
        }

        const origItem = origItemMap[despacho_item_id];
        if (isNaN(qty) || qty <= 0) {
          return jsonError(`Cantidad a devolver inválida para el producto: ${origItem.nombre_snap}`, 400, request);
        }

        const alreadyReturned = returnedQtyMap[despacho_item_id] || 0;
        const maxReturnable = Number(origItem.cantidad) - alreadyReturned;

        if (qty > maxReturnable) {
          return jsonError(`La cantidad a devolver (${qty}) supera el saldo disponible (${maxReturnable}) para el producto: ${origItem.nombre_snap}`, 400, request);
        }

        const unitPriceAfterDiscount = Number(origItem.precio_unit_usd) * (1 - Number(origItem.descuento_pct || 0) / 100);
        const lineTotalRefund = Math.round((unitPriceAfterDiscount * qty) * 10000) / 10000;

        totalDevueltoUsd += lineTotalRefund;

        processedItems.push({
          despacho_item_id,
          producto_id: origItem.producto_id,
          nombre_snap: origItem.nombre_snap,
          codigo_snap: origItem.codigo_snap,
          unidad_snap: origItem.unidad_snap,
          cantidad_devuelta: qty,
          precio_unit_usd: origItem.precio_unit_usd,
          total_devuelto_usd: lineTotalRefund,
          origen: origItem.origen || 'inventario'
        });
      }
    }

    totalDevueltoUsd = Math.round(totalDevueltoUsd * 10000) / 10000;

    // P0-C: la RPC neutral compone inventario, Kardex, documentos de
    // devolución, CxC, comisión y, si corresponde, la cotización de reemplazo.
    // La misma clave reserva el replay; no se deja una ruta REST alternativa.
    const reemplazoPayload = generarReemplazo ? {
      cliente_id: desp.cliente_id,
      vendedor_id: desp.vendedor_id,
      transportista_id: desp.transportista_id || null,
      total_usd: totalDevueltoUsd,
      notas_cliente: `Reemplazo por devolución en Despacho #${desp.numero}`,
      notas_internas: `Generada automáticamente por devolución parcial de Despacho #${desp.numero}. Motivo: ${motivo}`,
      items: processedItems.map((item, idx) => ({
        producto_id: item.producto_id,
        nombre_snap: item.nombre_snap,
        codigo_snap: item.codigo_snap,
        unidad_snap: item.unidad_snap || 'und',
        cantidad: item.cantidad_devuelta,
        precio_unit_usd: item.precio_unit_usd,
        descuento_pct: 0,
        total_linea_usd: item.total_devuelto_usd,
        orden: idx,
        origen: item.origen || 'inventario',
      })),
    } : null;

    // Cobro de la diferencia en intercambio (Opción A): el cliente puede pagar
    // parte o toda la diferencia con uno o varios métodos. Sin pagos, el
    // comportamiento es el histórico: el cargo completo queda como deuda.
    const balanceNetoParaCobro = Math.round((totalIntercambioUsd - totalDevueltoUsd) * 10000) / 10000;
    let pagosDiferencia = null;
    let pagadoDiferenciaUsd = 0;
    if (Array.isArray(body.pagosDiferencia) && body.pagosDiferencia.length > 0) {
      if (balanceNetoParaCobro <= 0) {
        return jsonError('pagosDiferencia solo aplica cuando el intercambio supera lo devuelto', 400, request);
      }
      if (!(desp.cliente_factura_id || desp.cliente_id)) {
        return jsonError('El despacho no tiene cliente de facturación para registrar el cobro de la diferencia', 400, request);
      }
      const METODOS_COBRO_DIFERENCIA = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT', 'Cruce'];
      const pagosLimpios = [];
      let sumaPagos = 0;
      for (const p of body.pagosDiferencia) {
        if (!p || typeof p !== 'object') return jsonError('Pago de diferencia inválido', 400, request);
        const metodo = String(p.metodo || '').trim();
        if (!METODOS_COBRO_DIFERENCIA.includes(metodo)) {
          return jsonError(`Método de pago no permitido para la diferencia: ${metodo || '(vacío)'}`, 400, request);
        }
        const monto = Math.round(Number(p.monto) * 10000) / 10000;
        if (!Number.isFinite(monto) || monto <= 0) {
          return jsonError(`Monto inválido para el pago ${metodo}`, 400, request);
        }
        let referencia = p.referencia === undefined || p.referencia === null ? '' : String(p.referencia).trim();
        if (metodo === 'Transf. / Pago Móvil' && !referencia) {
          return jsonError('La referencia es obligatoria para Transf. / Pago Móvil', 400, request);
        }
        if (referencia.length > 160) return jsonError('Referencia demasiado larga', 400, request);
        sumaPagos += monto;
        pagosLimpios.push({ metodo, monto, referencia: referencia || null });
      }
      if (pagosLimpios.length > 12) return jsonError('Máximo 12 pagos por diferencia', 400, request);
      sumaPagos = Math.round(sumaPagos * 10000) / 10000;
      if (sumaPagos > balanceNetoParaCobro + 0.01) {
        return jsonError(`La suma de los pagos ($${sumaPagos.toFixed(2)}) supera la diferencia a cobrar ($${balanceNetoParaCobro.toFixed(2)})`, 400, request);
      }
      pagosDiferencia = pagosLimpios;
      pagadoDiferenciaUsd = sumaPagos;
    }

    // Validación temprana de pagos de reembolso (cuando el balance neto favorece al cliente)
    const balanceNetoDevolucion = Math.round((totalIntercambioUsd - totalDevueltoUsd) * 10000) / 10000;
    const METODOS_REEMBOLSO = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT'];
    const REFERENCIA_REQUERIDA_REEMBOLSO = ['Transf. / Pago Móvil', 'Zelle', 'USDT'];
    const pagosReembolsoLimpios = [];
    let totalReembolsoUsd = 0;

    if (balanceNetoDevolucion < 0 && destinoSaldo === 'reembolso') {
      const montoAFavorMaximo = Math.abs(balanceNetoDevolucion);

      if (Array.isArray(pagosReembolso) && pagosReembolso.length > 0) {
        if (pagosReembolso.length > 12) return jsonError('Máximo 12 pagos de reembolso permitidos', 400, request);
        const metodosUsados = new Set();
        for (const p of pagosReembolso) {
          if (!p || typeof p !== 'object') return jsonError('Pago de reembolso inválido', 400, request);
          const metodo = String(p.metodo || '').trim();
          if (!METODOS_REEMBOLSO.includes(metodo)) {
            return jsonError(`Método de reembolso no permitido: ${metodo || '(vacío)'}`, 400, request);
          }
          if (metodosUsados.has(metodo)) {
            return jsonError(`El método de reembolso "${metodo}" no puede repetirse`, 400, request);
          }
          metodosUsados.add(metodo);
          const monto = Math.round(Number(p.monto) * 10000) / 10000;
          if (!Number.isFinite(monto) || monto <= 0) {
            return jsonError(`Monto inválido para el reembolso por ${metodo}`, 400, request);
          }
          let referencia = p.referencia === undefined || p.referencia === null ? '' : String(p.referencia).trim();
          if (REFERENCIA_REQUERIDA_REEMBOLSO.includes(metodo) && !referencia) {
            return jsonError(`La referencia es obligatoria para el reembolso por ${metodo}`, 400, request);
          }
          if (referencia.length > 160) return jsonError('Referencia de reembolso demasiado larga', 400, request);
          pagosReembolsoLimpios.push({ metodo, monto, referencia: referencia || null });
          totalReembolsoUsd += monto;
        }
      } else if (reembolsoMetodo) {
        const metodo = String(reembolsoMetodo).trim();
        if (!METODOS_REEMBOLSO.includes(metodo)) {
          return jsonError(`Método de reembolso no permitido: ${metodo}`, 400, request);
        }
        const monto = Math.round(Number(reembolsoMonto || montoAFavorMaximo) * 10000) / 10000;
        if (!Number.isFinite(monto) || monto <= 0) {
          return jsonError('Monto de reembolso inválido', 400, request);
        }
        let referencia = reembolsoReferencia ? String(reembolsoReferencia).trim() : '';
        if (REFERENCIA_REQUERIDA_REEMBOLSO.includes(metodo) && !referencia) {
          return jsonError(`La referencia es obligatoria para el reembolso por ${metodo}`, 400, request);
        }
        pagosReembolsoLimpios.push({ metodo, monto, referencia: referencia || null });
        totalReembolsoUsd += monto;
      } else {
        return jsonError('Debe especificar al menos un método de pago para el reembolso', 400, request);
      }

      totalReembolsoUsd = Math.round(totalReembolsoUsd * 10000) / 10000;
      if (totalReembolsoUsd > montoAFavorMaximo + 0.01) {
        return jsonError(`La suma de los reembolsos ($${totalReembolsoUsd.toFixed(2)}) supera el saldo a favor disponible ($${montoAFavorMaximo.toFixed(2)})`, 400, request);
      }
    }

    const atomicRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/registrar_devolucion_parcial_cobro_idempotente`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_cuenta_id: operador.cuenta_id,
        p_despacho_id: despachoId,
        p_idempotency_key: idempotencyKey,
        p_devoluciones: processedItems,
        p_intercambios: processedExchangeItems,
        p_motivo: motivo.trim(),
        p_usuario_id: user.operator_id,
        p_usuario_nombre: operador.nombre,
        p_usuario_color: operador.color || null,
        p_cotizacion_reemplazo_id: null,
        p_total_devuelto_usd: totalDevueltoUsd,
        p_total_intercambio_usd: totalIntercambioUsd,
        p_reemplazo: reemplazoPayload,
        p_pagos_diferencia: pagosDiferencia,
        // Fase 3: destino del balance + reembolso atómico (filas
        // devolucion_credito y metadatos dentro de la transacción de la RPC).
        p_destino_saldo: balanceNetoDevolucion < 0 ? destinoSaldo : 'saldo_a_favor',
        p_pagos_reembolso: (balanceNetoDevolucion < 0 && destinoSaldo === 'reembolso' && pagosReembolsoLimpios.length > 0)
          ? pagosReembolsoLimpios
          : null,
      }),
    });
    const atomicText = await atomicRes.text();
    let atomicResult = null;
    try { atomicResult = atomicText ? JSON.parse(atomicText) : null; } catch { atomicResult = null; }
    if (!atomicRes.ok) {
      return jsonError(`No se pudo registrar la devolución atómica: ${atomicResult?.message || atomicText || `HTTP ${atomicRes.status}`}`, 400, request);
    }
    if (!atomicResult?.ok) return jsonError('La RPC no confirmó la devolución atómica', 500, request);
    if (atomicResult.transaccion_atomica !== true) return jsonError('La RPC no confirmó una transacción atómica', 500, request);
    if (atomicResult.idempotent === true) {
      return json({
        ...atomicResult,
        ok: true,
        cotizacionReemplazoId: atomicResult.cotizacion_reemplazo_id || null,
        totalDevueltoUsd,
        totalIntercambioUsd,
        balanceNetoUsd: balanceNetoDevolucion,
        idempotency_key: idempotencyKey,
        idempotent: true,
      }, 200, request);
    }

    // Reembolso atómico: las filas devolucion_credito y los metadatos de
    // reembolso los inserta la RPC dentro de su transacción (release
    // principal/05). El Worker ya no hace INSERT REST post-transacción.

    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id,
        usuarioNombre: operador.nombre,
        usuarioRol: operador.rol,
        categoria: 'DESPACHO',
        accion: 'DEVOLUCION_PARCIAL',
        descripcion: `Devolución parcial atómica en despacho #${desp.numero}. Motivo: ${motivo}${destinoSaldo === 'reembolso' && totalReembolsoUsd > 0 ? `. Reembolso: $${totalReembolsoUsd.toFixed(2)} (${pagosReembolsoLimpios.map(p => p.metodo).join(', ')})` : ''}`,
        entidadTipo: 'nota_despacho',
        entidadId: despachoId,
        meta: {
          idempotency_key: idempotencyKey,
          cotizacion_reemplazo_id: atomicResult.cotizacion_reemplazo_id || null,
          total_devuelto_usd: totalDevueltoUsd,
          total_intercambio_usd: totalIntercambioUsd,
          balance_neto_usd: balanceNetoDevolucion,
          pagos_diferencia: Array.isArray(pagosDiferencia) ? pagosDiferencia.length : 0,
          pagado_diferencia_usd: pagadoDiferenciaUsd,
          destino_saldo: balanceNetoDevolucion < 0 ? destinoSaldo : 'saldo_a_favor',
          pagos_reembolso: pagosReembolsoLimpios,
          total_reembolso_usd: totalReembolsoUsd,
        },
        ip,
      });
    } catch (auditErr) {
      console.warn('[DEVOLUCION] Auditoría atómica no registrada:', auditErr?.message);
    }

    if (atomicResult.transaccion_atomica === true) {
      return json({
        ...atomicResult,
        ok: true,
        cotizacionReemplazoId: atomicResult.cotizacion_reemplazo_id || null,
        totalDevueltoUsd,
        totalIntercambioUsd,
        balanceNetoUsd: balanceNetoDevolucion,
        destinoSaldo: balanceNetoDevolucion < 0 ? destinoSaldo : 'saldo_a_favor',
        pagosReembolso: pagosReembolsoLimpios,
        reembolsoTotalUsd: totalReembolsoUsd,
        idempotency_key: idempotencyKey,
        idempotent: false,
      }, 200, request);
    }

    // 5. Devolver stock e insertar movimientos Kardex
    const loteId = crypto.randomUUID();
    const movimientos = [];
    for (const item of processedItems) {
      if (item.producto_id && (item.origen === 'inventario' || item.origen === 'intercambio')) {
        const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}&select=stock_actual,nombre`, { headers });
        const [prod] = await pRes.json();
        if (prod) {
          const stockAnterior = Number(prod.stock_actual);
          const nuevoStock = stockAnterior + item.cantidad_devuelta;

          await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ stock_actual: nuevoStock }),
          });

          movimientos.push({
            lote_id: loteId,
            tipo: 'ingreso',
            motivo: `Devolución parcial de despacho #${desp.numero}`,
            motivo_tipo: 'devolucion',
            producto_id: item.producto_id,
            producto_nombre: item.nombre_snap || prod.nombre,
            cantidad: item.cantidad_devuelta,
            stock_anterior: stockAnterior,
            stock_nuevo: nuevoStock,
            usuario_id: user.operator_id,
            usuario_nombre: operador.nombre,
            usuario_color: operador.color || null,
          });
        }
      }
    }

    // Devolver stock de intercambio e insertar movimientos Kardex
    for (const item of processedExchangeItems) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ stock_actual: item.nuevo_stock }),
      });

      movimientos.push({
        lote_id: loteId,
        tipo: 'egreso',
        motivo: `Entrega por intercambio en devolución parcial — Despacho #${desp.numero}`,
        motivo_tipo: 'devolucion',
        producto_id: item.producto_id,
        producto_nombre: item.nombre_snap,
        cantidad: item.cantidad,
        stock_anterior: item.stock_actual,
        stock_nuevo: item.nuevo_stock,
        usuario_id: user.operator_id,
        usuario_nombre: operador.nombre,
        usuario_color: operador.color || null,
      });
    }

    if (movimientos.length > 0) {
      const kardexRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
        method: 'POST',
        headers,
        body: JSON.stringify(movimientos),
      });
      if (!kardexRes.ok) {
        const kardexErr = await kardexRes.text();
        console.error('[DEVOLUCION] Error al insertar Kardex:', kardexErr);
        return jsonError(`Error crítico al registrar Kardex de devolución: ${kardexErr}`, 500, request);
      }
    }

    // 6. Generar cotización de reemplazo si se solicita
    let cotizacionReemplazoId = null;
    if (generarReemplazo) {
      const cotBody = {
        version: 1,
        cliente_id: desp.cliente_id,
        vendedor_id: desp.vendedor_id,
        transportista_id: desp.transportista_id || null,
        estado: 'borrador',
        subtotal_usd: totalDevueltoUsd,
        descuento_global_pct: 0,
        descuento_usd: 0,
        costo_envio_usd: 0,
        total_usd: totalDevueltoUsd,
        notas_cliente: `Reemplazo por devolución en Despacho #${desp.numero}`,
        notas_internas: `Generada automáticamente por devolución parcial de Despacho #${desp.numero}. Motivo: ${motivo}`
      };

      const newCotRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(cotBody),
      });

      if (newCotRes.ok) {
        const [newCot] = await newCotRes.json();
        cotizacionReemplazoId = newCot.id;

        const cotItems = processedItems.map((item, idx) => ({
          cotizacion_id: cotizacionReemplazoId,
          producto_id: item.producto_id,
          nombre_snap: item.nombre_snap,
          codigo_snap: item.codigo_snap,
          unidad_snap: item.unidad_snap,
          origen: item.origen || 'inventario',
          cantidad: item.cantidad_devuelta,
          precio_unit_usd: item.precio_unit_usd,
          descuento_pct: 0,
          total_linea_usd: item.total_devuelto_usd,
          orden: idx
        }));

        const insItemsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
          method: 'POST',
          headers,
          body: JSON.stringify(cotItems)
        });

        if (!insItemsRes.ok) {
          console.error('[DEVOLUCION] Error al insertar ítems de cotización de reemplazo:', await insItemsRes.text());
        }
      } else {
        console.error('[DEVOLUCION] Error al crear cotización de reemplazo:', await newCotRes.text());
      }
    }

    // 7. Guardar registros en despacho_devoluciones
    const devolucionesRows = processedItems.map(item => ({
      despacho_id: despachoId,
      despacho_item_id: item.despacho_item_id,
      producto_id: item.producto_id,
      nombre_snap: item.nombre_snap,
      codigo_snap: item.codigo_snap,
      unidad_snap: item.unidad_snap,
      cantidad_devuelta: item.cantidad_devuelta,
      precio_unit_usd: item.precio_unit_usd,
      total_devuelto_usd: item.total_devuelto_usd,
      motivo: motivo,
      registrado_por: user.operator_id,
      registrado_por_nombre: operador.nombre,
      cotizacion_reemplazo_id: cotizacionReemplazoId,
      destino_saldo: netBalanceUsd < 0 ? destinoSaldo : 'saldo_a_favor',
      reembolso_metodo: (netBalanceUsd < 0 && destinoSaldo === 'reembolso') ? (pagosReembolsoLimpios.map(p => `${p.metodo}: $${p.monto.toFixed(2)}`).join(' | ') || 'Efectivo $') : null,
      reembolso_referencia: (netBalanceUsd < 0 && destinoSaldo === 'reembolso') ? (pagosReembolsoLimpios.map(p => p.referencia).filter(Boolean).join(' | ') || null) : null,
      reembolso_monto: (netBalanceUsd < 0 && destinoSaldo === 'reembolso') ? totalReembolsoUsd : 0
    }));

    const devInsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/despacho_devoluciones`, {
      method: 'POST',
      headers,
      body: JSON.stringify(devolucionesRows)
    });

    if (!devInsRes.ok) {
      const devInsErr = await devInsRes.text();
      return jsonError(`Error al registrar devoluciones en BD: ${devInsErr}`, 500, request);
    }

    // 8. Actualizar flag y total_usd neto en notas_despacho
    const totalOriginalCabecera = Number(desp.total_usd || 0);
    const nuevoTotalUsd = Math.round((totalOriginalCabecera - totalDevueltoUsd + totalIntercambioUsd) * 10000) / 10000;
    await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ tiene_devoluciones: true, total_usd: nuevoTotalUsd })
    });

    // 8.5 Guardar registros en despacho_devolucion_intercambios si existen
    if (processedExchangeItems.length > 0) {
      const intercambioRows = processedExchangeItems.map(item => ({
        despacho_id: despachoId,
        producto_id: item.producto_id,
        nombre_snap: item.nombre_snap,
        codigo_snap: item.codigo_snap,
        unidad_snap: item.unidad_snap,
        cantidad: item.cantidad,
        precio_unit_usd: item.precio_unit_usd,
        total_usd: item.total_usd,
        registrado_por: user.operator_id
      }));

      const intRes = await fetch(`${env.SUPABASE_URL}/rest/v1/despacho_devolucion_intercambios`, {
        method: 'POST',
        headers,
        body: JSON.stringify(intercambioRows)
      });

      if (!intRes.ok) {
        const intErr = await intRes.text();
        console.error('[DEVOLUCION] Error al registrar intercambios en BD:', intErr);
      }
    }

    // 9. Ajuste Financiero en CxC según Balance Neto
    let abonoRegistrado = false;
    let abonoMonto = 0;
    let creditoRegistrado = false;
    let creditoMonto = 0;
    let cargoRegistrado = false;
    let cargoMonto = 0;

    const netBalanceUsd = Math.round((totalIntercambioUsd - totalDevueltoUsd) * 10000) / 10000;

    if (netBalanceUsd > 0) {
      // El cliente debe pagar la diferencia
      cargoMonto = netBalanceUsd;
      const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_pendiente`, { headers });
      const [cliente] = await cRes.json();
      const saldoActual = Number(cliente?.saldo_pendiente || 0);
      const nuevoSaldo = Math.round((saldoActual + cargoMonto) * 10000) / 10000;

      const cargoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          cliente_id: clienteCxCId,
          despacho_id: despachoId,
          tipo: 'cargo',
          monto_usd: cargoMonto,
          saldo_usd: nuevoSaldo,
          descripcion: `Cargo por diferencia en intercambio — Despacho #${desp.numero}`,
          registrado_por: user.operator_id
        })
      });

      if (cargoRes.ok) {
        cargoRegistrado = true;
        await recalcularSaldoPendienteCliente(clienteCxCId, env, headers);
      } else {
        console.error('[DEVOLUCION] Error al registrar cargo CxC:', await cargoRes.text());
      }
    } else if (netBalanceUsd < 0) {
      // El cliente tiene saldo a favor
      const refundAmount = Math.abs(netBalanceUsd);

      // Calcular deuda pendiente específica de este despacho
      const cxcDespRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&select=tipo,monto_usd`, { headers });
      const cxcDesp = await cxcDespRes.json();
      let despachoPendiente = 0;
      if (Array.isArray(cxcDesp)) {
        cxcDesp.forEach(tx => {
          if (tx.tipo === 'cargo') despachoPendiente += Number(tx.monto_usd);
          else if (tx.tipo === 'abono') despachoPendiente -= Number(tx.monto_usd);
        });
      }
      despachoPendiente = Math.max(0, despachoPendiente);

      abonoMonto = Math.min(refundAmount, despachoPendiente);
      abonoMonto = Math.round(abonoMonto * 10000) / 10000;

      const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_pendiente,saldo_a_favor`, { headers });
      const [cliente] = await cRes.json();
      const saldoPendienteActual = Number(cliente?.saldo_pendiente || 0);
      const saldoFavorActual = Number(cliente?.saldo_a_favor || 0);

      if (abonoMonto > 0) {
        const nuevoSaldoPendiente = Math.max(0, Math.round((saldoPendienteActual - abonoMonto) * 10000) / 10000);
        const abonoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({
            cliente_id: clienteCxCId,
            despacho_id: despachoId,
            tipo: 'abono',
            monto_usd: abonoMonto,
            forma_pago_abono: 'Devolución',
            referencia: `Despacho #${desp.numero}`,
            saldo_usd: nuevoSaldoPendiente,
            descripcion: `Abono por devolución/intercambio — Despacho #${desp.numero}`,
            registrado_por: user.operator_id
          })
        });
        if (abonoRes.ok) {
          abonoRegistrado = true;
        } else {
          console.error('[DEVOLUCION] Error al registrar abono CxC:', await abonoRes.text());
        }
      }

      const creditRemainder = refundAmount - abonoMonto;
      creditoMonto = Math.round(creditRemainder * 10000) / 10000;

      if (creditoMonto > 0) {
        if (destinoSaldo === 'reembolso' && pagosReembolsoLimpios.length > 0) {
          // Destino: Reembolso / Pago multi-método al cliente
          // 1. Registramos 'credito' por el excedente neto devuelto
          // 2. Registramos 'devolucion_credito' por cada método entregado al cliente
          // De esta forma queda auditado cada egreso en CxC y en el reporte de ventas.
          // Si el reembolso es parcial, el restante queda intacto como saldo a favor.
          const nuevoSaldoFavor = Math.round((saldoFavorActual + creditoMonto) * 10000) / 10000;
          await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              cliente_id: clienteCxCId,
              despacho_id: despachoId,
              tipo: 'credito',
              monto_usd: creditoMonto,
              forma_pago_abono: 'Devolución',
              referencia: `Despacho #${desp.numero}`,
              saldo_usd: nuevoSaldoFavor,
              descripcion: `Crédito por devolución de mercancía — Despacho #${desp.numero}`,
              registrado_por: user.operator_id
            })
          });

          for (const p of pagosReembolsoLimpios) {
            const devCredRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
              method: 'POST',
              headers: { ...headers, Prefer: 'return=minimal' },
              body: JSON.stringify({
                cliente_id: clienteCxCId,
                despacho_id: despachoId,
                tipo: 'devolucion_credito',
                monto_usd: p.monto,
                forma_pago_abono: p.metodo,
                referencia: p.referencia || `Despacho #${desp.numero}`,
                saldo_usd: saldoFavorActual,
                descripcion: `Reembolso por devolución entregado al cliente — Despacho #${desp.numero} (${p.metodo})`,
                registrado_por: user.operator_id
              })
            });

            if (devCredRes.ok) {
              creditoRegistrado = true;
            } else {
              console.error('[DEVOLUCION] Error al registrar egreso devolucion_credito CxC:', await devCredRes.text());
            }
          }
        } else {
          // Destino: Saldo a Favor (comportamiento estándar)
          const nuevoSaldoFavor = Math.round((saldoFavorActual + creditoMonto) * 10000) / 10000;
          const creditoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              cliente_id: clienteCxCId,
              despacho_id: despachoId,
              tipo: 'credito',
              monto_usd: creditoMonto,
              forma_pago_abono: 'Devolución',
              referencia: `Despacho #${desp.numero}`,
              saldo_usd: nuevoSaldoFavor,
              descripcion: `Saldo a favor por excedente en devolución/intercambio — Despacho #${desp.numero}`,
              registrado_por: user.operator_id
            })
          });
          if (creditoRes.ok) {
            creditoRegistrado = true;
          } else {
            console.error('[DEVOLUCION] Error al registrar crédito/saldo a favor CxC:', await creditoRes.text());
          }
        }
      }

      if (abonoRegistrado || creditoRegistrado) {
        await recalcularSaldoPendienteCliente(clienteCxCId, env, headers);
      }
    }

    // Las comisiones 238b no se ajustan proporcionalmente por REST. La RPC
    // futura debe recomputar el despacho con sus líneas netas y preservar la
    // política no-CxC/exclusiones. Las filas legacy se dejan intactas.
    try {
      const comRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}&select=id,calculo_version`, { headers });
      if (comRes.ok) {
        const [comRow] = await comRes.json();
        if (comRow?.calculo_version === '238b') {
          const recalcRes = await recalcularComision238b(despachoId, headers, env)
          if (!recalcRes.ok) console.error('[DEVOLUCION] Error recalculando comisión 238b:', await recalcRes.text());
        }
      }
    } catch (comErr) {
      console.error('[DEVOLUCION] Error al recalcular comisión 238b:', comErr.message);
    }

    // 10. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id,
        usuarioNombre: operador.nombre,
        usuarioRol: operador.rol,
        categoria: 'DESPACHO',
        accion: 'DEVOLUCION_PARCIAL',
        descripcion: `Devolución parcial con intercambio en despacho #${desp.numero}. Motivo: ${motivo}. Devuelto: $${totalDevueltoUsd.toFixed(2)}, Intercambio: $${totalIntercambioUsd.toFixed(2)}, Balance Neto: $${netBalanceUsd.toFixed(2)}`,
        entidadTipo: 'nota_despacho',
        entidadId: despachoId,
        meta: {
          despacho_id: despachoId,
          items_devueltos: processedItems.map(i => ({ producto: i.nombre_snap, cantidad: i.cantidad_devuelta })),
          items_intercambio: processedExchangeItems.map(i => ({ producto: i.nombre_snap, cantidad: i.cantidad })),
          total_devuelto_usd: totalDevueltoUsd,
          total_intercambio_usd: totalIntercambioUsd,
          balance_neto_usd: netBalanceUsd,
          cotizacion_reemplazo_id: cotizacionReemplazoId,
          abono_cxc_registrado: abonoRegistrado,
          abono_cxc_monto: abonoMonto,
          credito_cxc_registrado: creditoRegistrado,
          credito_cxc_monto: creditoMonto,
          cargo_cxc_registrado: cargoRegistrado,
          cargo_cxc_monto: cargoMonto
        },
        ip
      });
    } catch (auditErr) {
      console.error('[DEVOLUCION] Error al registrar auditoría:', auditErr.message);
    }

    return json({
      ok: true,
      cotizacionReemplazoId,
      totalDevueltoUsd,
      totalIntercambioUsd,
      balanceNetoUsd: netBalanceUsd,
      abonoRegistrado,
      abonoMonto,
      creditoRegistrado,
      creditoMonto,
      cargoRegistrado,
      cargoMonto
    }, 200, request);

  } catch (e) {
    console.error('[DEVOLUCION] Error unhandled:', e);
    return jsonError(e.message || 'Error interno al registrar devolución parcial', 500, request);
  }
}

