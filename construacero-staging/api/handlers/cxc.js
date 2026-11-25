import { json, jsonError, isValidUuid, isSameOriginRequest } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { recalcularSaldoPendienteCliente } from '../lib/cxcUtils.js'

// OP-2026-050 (N9) — Monto: debe ser un número mayor que cero, con mensaje claro si no.
export function leerMontoAbono(monto, etiqueta = 'El monto del abono') {
  const n = typeof monto === 'number' ? monto
    : (typeof monto === 'string' && monto.trim() !== '' ? Number(monto.trim()) : NaN);
  if (!Number.isFinite(n)) return { error: `${etiqueta} debe ser un número (llegó: "${String(monto ?? '').slice(0, 30)}").` };
  const redondeado = Math.round(n * 100) / 100;
  if (redondeado <= 0) return { error: `${etiqueta} debe ser mayor que cero.` };
  if (redondeado > 10_000_000) return { error: `${etiqueta} es demasiado grande. Revisa la cifra.` };
  return { monto: redondeado };
}

// OP-2026-050 (N8) — Detalle de formas de pago: si viene como lista, cada línea debe tener
// un monto válido y la suma debe ser igual al monto del abono (tolerancia de 1 centavo).
// Si viene como texto simple ("Zelle"), no hay detalle que comparar.
export function validarDetallePago(formaPago, monto) {
  if (formaPago == null || formaPago === '') return { ok: true };
  let lista = null;
  if (Array.isArray(formaPago)) lista = formaPago;
  else if (typeof formaPago === 'string' && formaPago.trim().startsWith('[')) {
    try { lista = JSON.parse(formaPago); } catch { return { error: 'El detalle de formas de pago está dañado. Vuelve a escribir las formas de pago.' }; }
    if (!Array.isArray(lista)) return { error: 'El detalle de formas de pago está dañado. Vuelve a escribir las formas de pago.' };
  } else return { ok: true };
  if (lista.length === 0) return { error: 'Falta el detalle de formas de pago.' };
  let suma = 0;
  for (const [i, l] of lista.entries()) {
    const m = Number(l?.monto);
    if (!Number.isFinite(m) || m < 0) return { error: `La forma de pago ${i + 1} (${l?.metodo || 'sin método'}) no tiene un monto válido.` };
    if (!l?.metodo || typeof l.metodo !== 'string') return { error: `La forma de pago ${i + 1} no dice el método (Zelle, efectivo, etc.).` };
    suma += m;
  }
  suma = Math.round(suma * 100) / 100;
  if (Math.abs(suma - monto) > 0.01) {
    return { error: `Las formas de pago suman $${suma.toFixed(2)} pero el abono es de $${monto.toFixed(2)}. Corrige los montos para que coincidan.` };
  }
  return { ok: true };
}

export async function handleRegistrarAbono(request, env) {
  if (!isSameOriginRequest(request)) return jsonError('Origen de la petición no permitido', 403, request);
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  let body = {};
  let bodyOk = true;
  try { body = await request.json(); } catch { bodyOk = false; }
  const { clienteId, monto, formaPago, referencia, descripcion, despachoId, idempotencyKey, confirmarDuplicado } = body || {};
  const idemKey = (typeof idempotencyKey === 'string' ? idempotencyKey : request.headers.get('Idempotency-Key') || '').trim().slice(0, 120);

  // OP-2026-050: todo intento rechazado queda anotado en la auditoría (ABONO_RECHAZADO),
  // con el motivo y lo que se intentó guardar. Así un abono "que no aparece" deja rastro.
  const rechazar = async (mensaje, status, extra = {}) => {
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: 'ABONO_RECHAZADO',
        descripcion: `Abono NO guardado: ${mensaje}`,
        entidadTipo: 'cliente', entidadId: isValidUuid(clienteId) ? clienteId : null,
        meta: {
          motivo: mensaje, status, monto_intentado: monto ?? null,
          forma_pago: typeof formaPago === 'string' ? formaPago.slice(0, 500) : (formaPago ?? null),
          referencia: referencia ?? null, despacho_id: despachoId || null,
          ...(idemKey ? { idempotency_key: idemKey } : {}), ...extra,
        },
        ip,
      });
    } catch {}
    return extra.code ? json({ error: mensaje, ...extra }, status, request) : jsonError(mensaje, status, request);
  };

  const ROLES_ABONO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_ABONO.includes(operador.rol)) {
    return rechazar('Solo administración, jefe o desarrollador pueden registrar abonos', 403);
  }
  if (!bodyOk) return rechazar('Los datos del abono llegaron incompletos. Vuelve a intentar.', 400);
  if (!clienteId || !isValidUuid(clienteId)) return rechazar('No se indicó un cliente válido.', 400);
  const lectura = leerMontoAbono(monto);
  if (lectura.error) return rechazar(lectura.error, 400);
  const montoNum = lectura.monto;
  const detalle = validarDetallePago(formaPago, montoNum);
  if (detalle.error) return rechazar(detalle.error, 400);
  if (despachoId != null && despachoId !== '' && !isValidUuid(despachoId)) return rechazar('El despacho indicado no es válido.', 400);

  try {
    // OP-2026-042: si el abono se enlaza a un despacho (selector de la ficha),
    // el despacho debe ser de este cliente y de esta cuenta.
    if (despachoId) {
      const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}&select=cliente_id,cliente_factura_id`, { headers });
      const [despAbono] = dRes.ok ? await dRes.json() : [];
      if (!despAbono) return rechazar('El despacho indicado no existe', 400);
      if (despAbono.cliente_id !== clienteId && despAbono.cliente_factura_id !== clienteId) {
        return rechazar('El despacho indicado no pertenece a este cliente', 400);
      }
    }

    // OP-2026-052 (M6): antes, si el despacho elegido no tenía deuda, se inventaba un cargo COD
    // ("auto-sanación"). Ahora se rechaza con un mensaje claro: un abono no crea deudas.
    if (despachoId) {
      const cargoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.cargo&select=id&limit=1`, { headers });
      const cargos = cargoRes.ok ? await cargoRes.json() : [];
      if (!Array.isArray(cargos) || cargos.length === 0) {
        return rechazar('Ese despacho no tiene deuda registrada. Registra el abono sin elegir despacho o revisa el despacho con administración.', 400);
      }
    }

    // OP-2026-050 (I2): abono + anotación de auditoría en UN SOLO PASO dentro de la base
    // (función cxc_registrar_abono_atomico, migración 302). Incluye el turno por cliente,
    // la huella única (G4), el aviso de abono igual reciente y el control de la deuda.
    const rpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/cxc_registrar_abono_atomico`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_cliente_id: clienteId,
        p_monto: montoNum,
        p_forma_pago: formaPago ?? null,
        p_referencia: referencia ?? null,
        p_descripcion: descripcion || 'Abono recibido',
        p_despacho_id: despachoId || null,
        p_registrado_por: operador.id,
        p_usuario_nombre: operador.nombre,
        p_usuario_rol: operador.rol,
        p_idempotency_key: idemKey || null,
        p_confirmar_duplicado: confirmarDuplicado === true,
        p_ip: ip || null,
        p_meta: {},
      }),
    });
    if (!rpc.ok) {
      const txt = await rpc.text();
      let err = {};
      try { err = JSON.parse(txt); } catch {}
      const msg = String(err.message || txt || '');
      const supera = msg.match(/MONTO_SUPERA_SALDO:([\d.]+)/);
      if (supera) return rechazar(`El abono ($${montoNum.toFixed(2)}) es mayor que la deuda del cliente ($${Number(supera[1]).toFixed(2)}). Revisa el monto.`, 400, { code: 'MONTO_SUPERA_DEUDA', deuda: Number(supera[1]) });
      if (msg.includes('CLIENTE_NO_ENCONTRADO')) return rechazar('Cliente no encontrado', 404);
      if (msg.includes('CLAVE_DE_OTRO_CLIENTE')) return rechazar('La clave de operación ya se usó para otro cliente', 409);
      if (msg.includes('MONTO_INVALIDO')) return rechazar('El monto del abono debe ser mayor que cero.', 400);
      return rechazar(`Error al registrar abono: ${msg.slice(0, 200)}`, 500);
    }
    const r = await rpc.json();

    if (r?.posible_duplicado) {
      const igual = r.posible_duplicado;
      const minutos = Math.max(0, Math.round((Date.now() - new Date(igual.creado_en).getTime()) / 60000));
      const cuando = minutos === 0 ? 'hace menos de un minuto' : `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;
      const ref = igual.referencia ? ` (referencia "${String(igual.referencia).trim()}")` : '';
      return rechazar(
        `Ya se registró un abono de $${montoNum.toFixed(2)} para este cliente ${cuando}${ref}. Si es otro pago, confírmalo; si es el mismo, cancela.`,
        409,
        { code: 'POSIBLE_DUPLICADO', previo: { id: igual.id, creado_en: igual.creado_en, referencia: igual.referencia } },
      );
    }

    if (r?.idempotent) return json({ id: r.id, nuevoSaldo: Number(r.nuevo_saldo), idempotent: true }, 200, request);
    return json({ id: r.id, nuevoSaldo: Number(r.nuevo_saldo) }, 200, request);
  } catch (e) {
    return rechazar(e.message || 'Error al registrar abono', 500);
  }
}

// OP-2026-055 (I3): "Revertir" = ANULAR con motivo obligatorio, en un solo paso dentro de la base
// (cxc_anular_movimiento_staging, migración 307): valida, guarda la copia completa en el archivo de
// movimientos borrados, borra y anota en la auditoría. Los movimientos de una devolución no se anulan sueltos.
export async function handleRevertirAbono(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  const ROLES_REVERTIR = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_REVERTIR.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden revertir abonos o saldos a favor', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { abonoId, motivo } = body || {};
  if (!abonoId || !isValidUuid(abonoId)) return jsonError('abonoId inválido', 400, request);
  const motivoTxt = String(motivo || '').trim();
  if (motivoTxt.length < 10) return jsonError('Escribe el motivo de la anulación (mínimo 10 caracteres).', 400, request);

  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/cxc_anular_movimiento_staging`, {
      method: 'POST', headers,
      body: JSON.stringify({
        p_movimiento_id: abonoId,
        p_cuenta_id: operador.cuenta_id,
        p_usuario_id: operador.id,
        p_usuario_nombre: operador.nombre,
        p_usuario_rol: operador.rol,
        p_motivo: motivoTxt,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      if (t.includes('MOVIMIENTO_NO_ENCONTRADO')) return jsonError('La transacción no existe', 404, request);
      if (t.includes('TIPO_NO_ANULABLE')) return jsonError('Solo se pueden revertir abonos, saldos a favor, consumos o devoluciones de saldo', 400, request);
      if (t.includes('MOVIMIENTO_DE_DEVOLUCION')) return jsonError('Este movimiento viene de una devolución de mercancía. Corrígelo desde la devolución del despacho, no desde la ficha.', 400, request);
      if (t.includes('CONSUMO_CONCILIADO')) return jsonError('CONSUMO_CONCILIADO: no se puede revertir el consumo de saldo a favor después de conciliar el despacho', 400, request);
      if (t.includes('CREDITO_YA_USADO')) return jsonError('No se puede revertir este crédito porque ya ha sido consumido parcial o totalmente.', 400, request);
      if (t.includes('MOTIVO_REQUERIDO')) return jsonError('Escribe el motivo de la anulación (mínimo 10 caracteres).', 400, request);
      return jsonError(`Error al revertir la transacción: ${t.slice(0, 200)}`, 500, request);
    }
    const res = await r.json();
    return json({ success: true, tipo: res.tipo, monto: Number(res.monto) }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al revertir la transacción', 500, request);
  }
}

// OP-2026-055: movimientos anulados o borrados de un cliente (archivo cxc_movimientos_borrados), para la ficha.
export async function handleMovimientosBorradosCliente(request, env, url) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers } = v;
  if (!['administracion', 'jefe', 'desarrollador'].includes(operador.rol)) {
    return jsonError('No tienes permiso para ver los movimientos anulados', 403, request);
  }
  const clienteId = url.searchParams.get('clienteId');
  if (!clienteId || !isValidUuid(clienteId)) return jsonError('clienteId inválido', 400, request);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/cxc_movimientos_borrados?cliente_id=eq.${clienteId}&cuenta_id=eq.${operador.cuenta_id}&select=id,movimiento_id,tipo,monto_usd,motivo,borrado_por_nombre,origen,borrado_en,fila&order=borrado_en.desc&limit=200`, { headers });
  if (!r.ok) return jsonError('No se pudieron leer los movimientos anulados', 500, request);
  return json(await r.json(), 200, request);
}

// Reversión (parcial o total) del cargo CxC de un despacho: deja el cargo en
// `montoNuevo`. Usado por el "cuadre automático" de la corrección de métodos de
// pago cuando la parte a crédito era un error de captura (no hubo dinero de por
// medio). Es idempotente por diseño: un reintento con el mismo montoNuevo no
// vuelve a aplicar.
export async function handleRevertirCargoCxc(request, env) {
  if (!isSameOriginRequest(request)) return jsonError('Origen de la petición no permitido', 403, request);
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  const ROLES_REVERSION = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_REVERSION.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden revertir cargos de CxC', 403, request);
  }
  if (!isValidUuid(operador.cuenta_id)) return jsonError('Cuenta del operador no disponible', 403, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { despachoId, montoNuevo, motivo } = body || {};
  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);
  const objetivo = Number(montoNuevo);
  if (!Number.isFinite(objetivo) || objetivo < 0) return jsonError('montoNuevo inválido', 400, request);
  const motivoTxt = typeof motivo === 'string' ? motivo.trim() : '';
  if (motivoTxt.length < 4) return jsonError('El motivo de la reversión es obligatorio (mínimo 4 caracteres)', 400, request);

  try {
    // Cargo CxC del despacho (mismo criterio que la edición profunda: metodo_pago
    // 'cxc'; los cargos COD no se tocan por esta vía).
    const cRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}&tipo=eq.cargo&metodo_pago=eq.cxc&select=id,monto_usd,cliente_id`,
      { headers },
    );
    const cargos = await cRes.json();
    if (!Array.isArray(cargos) || cargos.length === 0) {
      return jsonError('No hay cargo en cuentas por cobrar (CxC) para este despacho', 404, request);
    }
    const cargo = cargos[0];
    const montoAnterior = Number(cargo.monto_usd) || 0;
    const montoObjetivo = Math.round(objetivo * 10000) / 10000;
    if (montoObjetivo > montoAnterior + 0.0001) {
      return jsonError('La reversión solo puede reducir el cargo', 400, request);
    }

    if (montoObjetivo === montoAnterior) {
      // Reintento de una reversión ya aplicada: no se vuelve a escribir.
      return json({ ok: true, montoAnterior, montoNuevo: montoObjetivo, idempotent: true }, 200, request);
    }

    if (montoObjetivo <= 0) {
      const delRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${cargo.id}`, {
        method: 'DELETE', headers,
      });
      if (!delRes.ok) return jsonError('Error al revertir el cargo', 500, request);
    } else {
      const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${cargo.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ monto_usd: montoObjetivo }),
      });
      if (!patchRes.ok) return jsonError('Error al revertir el cargo', 500, request);
    }

    // Recalcular el saldo del cliente desde los movimientos (mismo mecanismo que
    // la edición profunda y los abonos).
    await recalcularSaldoPendienteCliente(cargo.cliente_id, env, headers);

    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: 'REVERTIR_CARGO_CXC',
        descripcion: `Reversión de cargo CxC del despacho ${despachoId.slice(0, 8)}: ${motivoTxt}`,
        entidadTipo: 'despacho', entidadId: despachoId,
        meta: { monto_anterior: montoAnterior, monto_nuevo: montoObjetivo, motivo: motivoTxt },
        ip,
      });
    } catch { /* auditoría best-effort */ }

    return json({ ok: true, montoAnterior, montoNuevo: montoObjetivo }, 200, request);
  } catch (e) {
    return jsonError('Error al revertir el cargo: ' + (e?.message || e), 500, request);
  }
}

// ─── OP-2026-051: saldo a favor (cargar, devolver, cruzar) en UN SOLO PASO ──────────
// Las tres operaciones usan la función de la base cxc_saldo_favor_atomico (migración 303):
// turno por cliente, huella única, aviso de movimiento repetido (carga y devolución),
// control de saldos y la anotación de auditoría dentro del mismo paso. Todo rechazo
// queda anotado en la auditoría con su motivo.
const OPERACIONES_SALDO_FAVOR = {
  credito: {
    nombre: 'el saldo a favor', permiso: 'registrar saldo a favor', accionRechazo: 'SALDO_FAVOR_RECHAZADO',
    descripcion: 'Saldo a favor registrado', duplicado: 'una carga de saldo a favor',
  },
  devolucion_credito: {
    nombre: 'la devolución de saldo a favor', permiso: 'registrar devoluciones de saldo a favor', accionRechazo: 'DEVOLUCION_SALDO_RECHAZADA',
    descripcion: 'Devolución de saldo a favor registrada', duplicado: 'una devolución de saldo a favor',
  },
  cruce: {
    nombre: 'el cruce de saldo a favor', permiso: 'cruzar saldo a favor', accionRechazo: 'CRUCE_SALDO_FAVOR_RECHAZADO',
    descripcion: 'Cruce de saldo a favor contra deuda', duplicado: 'un cruce',
  },
};

async function movimientoSaldoFavor(request, env, operacion) {
  const cfg = OPERACIONES_SALDO_FAVOR[operacion];
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  let body = {};
  let bodyOk = true;
  try { body = await request.json(); } catch { bodyOk = false; }
  const { clienteId, monto, formaPago, referencia, descripcion, idempotencyKey, confirmarDuplicado } = body || {};
  const idemKey = (typeof idempotencyKey === 'string' ? idempotencyKey : request.headers.get('Idempotency-Key') || '').trim().slice(0, 120);

  const rechazar = async (mensaje, status, extra = {}) => {
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: cfg.accionRechazo,
        descripcion: `No se guardó ${cfg.nombre}: ${mensaje}`,
        entidadTipo: 'cliente', entidadId: isValidUuid(clienteId) ? clienteId : null,
        meta: {
          operacion, motivo: mensaje, status, monto_intentado: monto ?? null,
          forma_pago: typeof formaPago === 'string' ? formaPago.slice(0, 500) : (formaPago ?? null),
          referencia: referencia ?? null, ...(idemKey ? { idempotency_key: idemKey } : {}), ...extra,
        },
        ip,
      });
    } catch {}
    return extra.code ? json({ error: mensaje, ...extra }, status, request) : jsonError(mensaje, status, request);
  };

  if (!['administracion', 'jefe', 'desarrollador'].includes(operador.rol)) {
    return rechazar(`Solo administración, jefe o desarrollador pueden ${cfg.permiso}`, 403);
  }
  if (!bodyOk) return rechazar('Los datos llegaron incompletos. Vuelve a intentar.', 400);
  if (!clienteId || !isValidUuid(clienteId)) return rechazar('No se indicó un cliente válido.', 400);
  const lectura = leerMontoAbono(monto, 'El monto');
  if (lectura.error) return rechazar(lectura.error, 400);
  const montoNum = lectura.monto;
  if (operacion !== 'cruce') {
    const detalle = validarDetallePago(formaPago, montoNum);
    if (detalle.error) return rechazar(detalle.error, 400);
  }

  try {
    const rpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/cxc_saldo_favor_atomico`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_operacion: operacion,
        p_cliente_id: clienteId,
        p_monto: montoNum,
        p_forma_pago: operacion === 'cruce' ? null : (formaPago || null),
        p_referencia: referencia || null,
        p_descripcion: descripcion || cfg.descripcion,
        p_registrado_por: operador.id,
        p_usuario_nombre: operador.nombre,
        p_usuario_rol: operador.rol,
        p_idempotency_key: idemKey || null,
        p_confirmar_duplicado: confirmarDuplicado === true,
        p_ip: ip || null,
      }),
    });
    if (!rpc.ok) {
      const txt = await rpc.text();
      let err = {};
      try { err = JSON.parse(txt); } catch {}
      const msg = String(err.message || txt || '');
      const superaFavor = msg.match(/MONTO_SUPERA_SALDO_FAVOR:([\d.]+)/);
      if (superaFavor) return rechazar(`El monto ($${montoNum.toFixed(2)}) es mayor que el saldo a favor del cliente ($${Number(superaFavor[1]).toFixed(2)}). Revisa el monto.`, 400, { code: 'MONTO_SUPERA_SALDO_FAVOR', saldoFavor: Number(superaFavor[1]) });
      const superaDeuda = msg.match(/MONTO_SUPERA_SALDO:([\d.]+)/);
      if (superaDeuda) return rechazar(`El monto ($${montoNum.toFixed(2)}) es mayor que la deuda del cliente ($${Number(superaDeuda[1]).toFixed(2)}). Revisa el monto.`, 400, { code: 'MONTO_SUPERA_DEUDA', deuda: Number(superaDeuda[1]) });
      if (msg.includes('SIN_SALDO_FAVOR')) return rechazar('El cliente no tiene saldo a favor disponible.', 400);
      if (msg.includes('SIN_DEUDA')) return rechazar('El cliente no tiene deuda pendiente para cruzar.', 400);
      if (msg.includes('CLIENTE_NO_ENCONTRADO')) return rechazar('Cliente no encontrado', 404);
      if (msg.includes('CLAVE_DE_OTRO_MOVIMIENTO')) return rechazar('La clave de operación ya se usó para otro movimiento', 409);
      if (msg.includes('MONTO_INVALIDO')) return rechazar('El monto debe ser mayor que cero.', 400);
      return rechazar(`Error al guardar ${cfg.nombre}: ${msg.slice(0, 200)}`, 500);
    }
    const r = await rpc.json();

    if (r?.posible_duplicado) {
      const igual = r.posible_duplicado;
      const minutos = Math.max(0, Math.round((Date.now() - new Date(igual.creado_en).getTime()) / 60000));
      const cuando = minutos === 0 ? 'hace menos de un minuto' : `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;
      const ref = igual.referencia ? ` (referencia "${String(igual.referencia).trim()}")` : '';
      return rechazar(
        `Ya se registró ${cfg.duplicado} de $${montoNum.toFixed(2)} para este cliente ${cuando}${ref}. Si es otro movimiento, confírmalo; si es el mismo, cancela.`,
        409,
        { code: 'POSIBLE_DUPLICADO', previo: { id: igual.id, creado_en: igual.creado_en, referencia: igual.referencia } },
      );
    }

    return json({
      id: r.id,
      nuevoSaldoFavor: Number(r.nuevo_saldo_favor),
      nuevoSaldoPendiente: Number(r.nuevo_saldo_pendiente),
      ...(r.idempotent ? { idempotent: true } : {}),
    }, 200, request);
  } catch (e) {
    return rechazar(e.message || `Error al guardar ${cfg.nombre}`, 500);
  }
}

export async function handleRegistrarSaldoFavor(request, env) {
  return movimientoSaldoFavor(request, env, 'credito');
}

export async function handleCruzarSaldoFavor(request, env) {
  return movimientoSaldoFavor(request, env, 'cruce');
}

export async function handleRegistrarDevolucionCredito(request, env) {
  return movimientoSaldoFavor(request, env, 'devolucion_credito');
}
