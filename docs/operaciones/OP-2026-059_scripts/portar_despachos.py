# OP-2026-059 — Lleva a api/handlers/despachos.js (producción) los cambios de CxC hechos en
# construacero-staging/api/handlers/despachos.js (OP-2026-042, 052, 053, 054, 055).
# El archivo de producción es distinto al de staging (otra ruta de reversión, otros nombres), por
# eso se aplican los cambios uno por uno, con anclas exactas; si un ancla no aparece, se detiene.
# Uso: python portar_despachos.py   (se corre UNA sola vez sobre el archivo de producción sin portar)
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
P = os.path.join(ROOT, 'api', 'handlers', 'despachos.js')
s = open(P, encoding='utf-8').read()
assert 'OP-2026-052' not in s, 'despachos.js ya tiene el porte; no se vuelve a aplicar'


def r(viejo, nuevo, n=1):
    global s
    c = s.count(viejo)
    assert c == n, f'ancla encontrada {c} veces (esperaba {n}): {viejo[:90]!r}'
    s = s.replace(viejo, nuevo)


# 1) Importaciones (reglas compartidas con la pantalla)
r("import { guardarVehiculoHabitual, validarVehiculoDeCuenta } from './vehiculos.js'\n",
  "import { guardarVehiculoHabitual, validarVehiculoDeCuenta } from './vehiculos.js'\n"
  "import { pendienteDeDespacho, pendienteSoloEnlazado, abonosQueCubrenDespacho, abonoAnulableEnDevolucion } from '../../src/utils/cxcReparto.js'\n"
  "import { valorDevolucionAcreditable } from '../../src/utils/donacionDevolucion.js'\n"
  "import { errorCruceSinExplicacion } from '../../src/utils/formaPagoReglas.js'\n")

# 2) Crear despacho: el Cruce debe decir contra qué se cruzó (N3)
r("  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);\n",
  "  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);\n"
  "  // OP-2026-055 (N3): el Cruce debe decir contra qué se cruzó\n"
  "  const errCruceCrear = errorCruceSinExplicacion(formaPago);\n"
  "  if (errCruceCrear) return jsonError(errCruceCrear, 400, request);\n")

# 3) Editar pago: mismo control (los Cruces viejos sin cambios se respetan)
r("  const despacho = despachos[0];\n  // Solo la RPC atómica puede cambiar el estado financiero de un COD.\n",
  "  const despacho = despachos[0];\n\n"
  "  // OP-2026-055 (N3): un Cruce nuevo o cambiado debe decir contra qué se cruzó (los viejos sin cambios se respetan)\n"
  "  const errCruceEditar = errorCruceSinExplicacion(formaPago, despacho.forma_pago) || errorCruceSinExplicacion(formaPagoCliente, despacho.forma_pago_cliente);\n"
  "  if (errCruceEditar) return jsonError(errCruceEditar, 400, request);\n\n"
  "  // Solo la RPC atómica puede cambiar el estado financiero de un COD.\n")

# 4) Cambiar estado: el guardarraíl de abonos reales se reemplaza por la decisión sobre los pagos
#    (OP-2026-052). Diferencia con staging: para un despacho APROBADO ('despachada') que se devuelve o
#    anula, se mantiene el bloqueo de siempre, porque esa ruta borra los movimientos del despacho y
#    no tiene paso de decisión (en staging ese bloqueo se quitó sin reemplazo).
ini = s.index("    // Guardarrail: Bloquear si existen abonos REALES en CxC para este despacho.")
fin = s.index("    // 2f. Revertir entrega (entregada→despachada)")
bloque_viejo = s[ini:fin]
assert "if (['pendiente', 'anulada'].includes(nuevoEstado) && ['despachada', 'entregada'].includes(desp.estado)) {" in bloque_viejo
bloque_despachada = bloque_viejo.replace(
    "    // Guardarrail: Bloquear si existen abonos REALES en CxC para este despacho.\n",
    "    // Guardarrail (solo despacho APROBADO 'despachada'): bloquear si existen abonos REALES en CxC.\n"
    "    // OP-2026-059: un despacho ENTREGADO ya no se bloquea: pasa por la decisión de pagos (abajo).\n"
    "    // Para 'despachada' se mantiene el bloqueo porque esa ruta borra los movimientos del despacho.\n"
    "    // Guardarrail original: Bloquear si existen abonos REALES en CxC para este despacho.\n").replace(
    "if (['pendiente', 'anulada'].includes(nuevoEstado) && ['despachada', 'entregada'].includes(desp.estado)) {",
    "if (['pendiente', 'anulada'].includes(nuevoEstado) && desp.estado === 'despachada') {")
decision = """    // OP-2026-052 (G2, N1): antes de reabrir un despacho entregado o anular uno pendiente se calcula
    // qué dinero está en juego (pagos anotados, abonos enlazados y lo que quedaría "pagado de más").
    // Si hay dinero en juego, el operador DEBE decidir qué pasa con él; nada se borra ni se esconde.
    const esReabrirEntregada = desp.estado === 'entregada' && ['pendiente', 'despachada'].includes(nuevoEstado);
    const esAnularPendiente = desp.estado === 'pendiente' && nuevoEstado === 'anulada';
    const destinoPagos = typeof body.destinoPagos === 'string' ? body.destinoPagos : null;
    const destinoPagoAnotado = typeof body.destinoPagoAnotado === 'string' ? body.destinoPagoAnotado : null;
    let pagosEnJuego = null;
    if (esReabrirEntregada || esAnularPendiente) {
      const juegoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/cxc_pagos_en_juego_despacho`, {
        method: 'POST', headers, body: JSON.stringify({ p_despacho_id: despachoId }),
      });
      if (!juegoRes.ok) return jsonError('No se pudo revisar los pagos del despacho. Vuelve a intentar.', 500, request);
      pagosEnJuego = await juegoRes.json();
      const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
      if (esReabrirEntregada && pagosEnJuego?.requiere_decision_reabrir && !['mantener', 'saldo_favor'].includes(destinoPagos)) {
        return json({
          error: `Este despacho tiene pagos (${[
            Number(pagosEnJuego.total_enlazado) > 0 ? `${fmt(pagosEnJuego.total_enlazado)} en abonos registrados a este despacho` : null,
            Number(pagosEnJuego.pagado_de_mas_nuevo) > 0 ? `${fmt(pagosEnJuego.pagado_de_mas_nuevo)} que quedarían sin deuda al reabrirlo` : null,
          ].filter(Boolean).join(' y ')}). Elige qué hacer con ese dinero antes de reabrirlo.`,
          code: 'DECISION_PAGOS_REQUERIDA', pagos: pagosEnJuego,
        }, 409, request);
      }
      if (esAnularPendiente && pagosEnJuego?.requiere_decision_anular) {
        if (!['saldo_favor', 'otro_despacho', 'no_cobrado'].includes(destinoPagoAnotado)) {
          return json({
            error: `Este despacho tiene ${fmt(pagosEnJuego.total_anotado)} en pagos anotados. Elige qué pasó con ese dinero antes de anularlo.`,
            code: 'DECISION_PAGOS_REQUERIDA', pagos: pagosEnJuego,
          }, 409, request);
        }
        if (String(body.motivo_anulacion || '').trim().length < 10) {
          return jsonError('Escribe el motivo de la anulación (mínimo 10 caracteres).', 400, request);
        }
      }
    }

"""
s = s[:ini] + bloque_despachada + decision + s[fin:]

# 5) Reversión de un despacho ENTREGADO: reabrir con la decisión sobre los pagos (una transacción).
#    Las repeticiones (mismo estado) siguen por la función de siempre.
r("""    if (reversalCandidate) {
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
""", """    if (reversalCandidate) {
      // OP-2026-052 (G2): reabrir un ENTREGADO con la decisión sobre los pagos; desenlaza abonos reales
      // (no los borra), pasa el sobrante a saldo a favor si se eligió, revierte (revertir_entrega_finanzas_
      // idempotente, dentro de la misma transacción) y anota todo en la auditoría.
      const usarReabrir = desp.estado === 'entregada'
      const rpcRes = usarReabrir
        ? await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/reabrir_despacho_con_pagos`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_despacho_id: despachoId,
            p_nuevo_estado: nuevoEstado,
            p_usuario_id: user.operator_id,
            p_usuario_nombre: operador.nombre,
            p_usuario_rol: operador.rol,
            p_usuario_color: operador.color || null,
            p_idempotency_key: idempotencyKey,
            p_destino_pagos: destinoPagos,
            p_motivo: body.motivo_devolucion || null,
          }),
        })
        : await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/revertir_entrega_finanzas_idempotente`, {
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
        if (String(rpcText).includes('DECISION_PAGOS_REQUERIDA')) {
          return json({ error: 'Este despacho tiene pagos. Elige qué hacer con ese dinero antes de reabrirlo.', code: 'DECISION_PAGOS_REQUERIDA', pagos: pagosEnJuego }, 409, request)
        }
        return jsonError(`No se pudo revertir la entrega atómica: ${result?.message || rpcText || `HTTP ${rpcRes.status}`}`, 400, request)
      }
""")

# 6) Anular un PENDIENTE con pagos anotados: aplicar la decisión en una transacción (N1)
r("""    // 4. Actualizar estado
    const updateData = { estado: nuevoEstado };
""", """    // OP-2026-052 (N1): anular un pendiente con pagos anotados aplica la decisión (saldo a favor,
    // otro despacho o no cobrado), cambia el estado y anota en la auditoría, todo en una transacción.
    let anulacionConPagos = null;
    if (esAnularPendiente && pagosEnJuego?.requiere_decision_anular) {
      const anRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/anular_despacho_con_pagos`, {
        method: 'POST', headers,
        body: JSON.stringify({
          p_despacho_id: despachoId,
          p_usuario_id: user.operator_id,
          p_usuario_nombre: operador.nombre,
          p_usuario_rol: operador.rol,
          p_destino: destinoPagoAnotado,
          p_motivo: String(body.motivo_anulacion || '').trim(),
        }),
      });
      if (!anRes.ok) {
        const t = await anRes.text();
        if (t.includes('MOTIVO_REQUERIDO')) return jsonError('Escribe el motivo de la anulación (mínimo 10 caracteres).', 400, request);
        if (t.includes('DECISION_PAGOS_REQUERIDA')) return json({ error: 'Elige qué pasó con los pagos anotados antes de anular.', code: 'DECISION_PAGOS_REQUERIDA', pagos: pagosEnJuego }, 409, request);
        return jsonError(`No se pudo anular el despacho: ${t.slice(0, 200)}`, 400, request);
      }
      anulacionConPagos = await anRes.json();
    }

    // 4. Actualizar estado
    const updateData = { estado: nuevoEstado };
    if (esAnularPendiente && body.motivo_anulacion) updateData.motivo_anulacion = String(body.motivo_anulacion).trim();
""")

# 7) Respuesta: qué pasó con los pagos
r("""      credito_anulado_usd: reversaAtomica?.credito_anulado_usd ?? null,
    }, 200, request);""", """      credito_anulado_usd: reversaAtomica?.credito_anulado_usd ?? null,
      // OP-2026-052: qué pasó con los pagos al reabrir o anular
      pagos_reabrir: reversaAtomica?.pagos ?? null,
      pagos_anular: anulacionConPagos,
    }, 200, request);""")

# 8) Edición profunda: artículos + cuenta del cliente en UNA transacción (OP-2026-053)
r("""  const { despachoId, items, pagos } = body;
  // items:""", """  const { despachoId, items, pagos } = body;
  // OP-2026-053: si la edición deja pagos del cliente sin deuda, el operador decide: 'mantener' | 'saldo_favor'
  const destinoPagos = ['mantener', 'saldo_favor'].includes(body.destinoPagos) ? body.destinoPagos : null;
  // items:""")
r("""  if (!Array.isArray(items) || items.length === 0) return jsonError('items no puede estar vacío', 400, request);

  // Rechazar duplicados comerciales""", """  if (!Array.isArray(items) || items.length === 0) return jsonError('items no puede estar vacío', 400, request);
  // OP-2026-055 (N3): un Cruce nuevo o cambiado debe decir contra qué se cruzó
  if (pagos) {
    const prevRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=forma_pago`, { headers });
    const [prevFp] = prevRes.ok ? await prevRes.json() : [];
    const errCruceItems = errorCruceSinExplicacion(pagos, prevFp?.forma_pago);
    if (errCruceItems) return jsonError(errCruceItems, 400, request);
  }

  // Rechazar duplicados comerciales""")
r("""    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/editar_despacho_profundidad`, {
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
""", """    // OP-2026-053: la función edita los artículos (editar_despacho_profundidad) y ajusta SOLO los
    // movimientos propios del despacho (cargos, consumo de saldo a favor y vuelto) en la MISMA
    // transacción. No toca créditos de devolución ni abonos reales; si quedarían pagos sin deuda exige
    // la decisión, y anota el antes y el después en la auditoría (EDICION_PROFUNDA_CXC).
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/editar_despacho_profundidad_con_cxc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_despacho_id:    despachoId,
        p_nuevos_items:   items,
        p_usuario_id:     operador.id,
        p_usuario_nombre: operador.nombre,
        p_usuario_rol:    operador.rol,
        p_forma_pago:     pagos || null,
        p_destino_pagos:  destinoPagos,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[DEEP_EDIT][WORKER_RPC_ERROR]', { status: res.status, body: err, despachoId })
      const decision = err.match(/DECISION_PAGOS_REQUERIDA:([\\d.]+)/);
      if (decision) {
        const monto = Number(decision[1]);
        return json({
          error: `Con este cambio, $${monto.toFixed(2)} que el cliente ya pagó quedarían sin deuda. Elige qué hacer con ese dinero.`,
          code: 'DECISION_PAGOS_REQUERIDA', pagos: { pagado_de_mas_nuevo: monto },
        }, 409, request);
      }
      const sinFavor = err.match(/SALDO_FAVOR_INSUFICIENTE:([\\d.]+)/);
      if (sinFavor) return jsonError(`El cliente solo tiene $${Number(sinFavor[1]).toFixed(2)} de saldo a favor disponible. Ajusta el pago con saldo a favor.`, 400, request);
      const vueltoUsado = err.match(/VUELTO_YA_USADO:([\\d.]+)/);
      if (vueltoUsado) return jsonError(`El vuelto que quedó como saldo a favor ya se usó (disponible: $${Number(vueltoUsado[1]).toFixed(2)}). No se puede quitar o reducir.`, 400, request);
""")
r("""    console.log('[DEEP_EDIT][WORKER_AFTER_RPC]', { despachoId, status: res.status, sentItemCount: items.length })
""", """    console.log('[DEEP_EDIT][WORKER_AFTER_RPC]', { despachoId, status: res.status, sentItemCount: items.length })
    let edicionCxc = null;
    try { edicionCxc = await res.json(); } catch { edicionCxc = null; }
""")
ini = s.index("    // ── 2b. Sincronizar Cuentas por Cobrar ────────────────────────────────────")
fin_txt = "      console.error('[CXC-DEEP-EDIT] Error al sincronizar CxC en edición profunda:', cxcErr?.message);\n    }\n"
fin = s.index(fin_txt, ini) + len(fin_txt)
s = s[:ini] + "    // ── 2b. (OP-2026-053) La cuenta del cliente ya se ajustó dentro de la transacción de arriba.\n" + s[fin:]
r("    return json({ ok: true, devoluciones_retiradas: devolucionesRetiradas }, 200, request);",
  "    return json({ ok: true, devoluciones_retiradas: devolucionesRetiradas, cxc: edicionCxc }, 200, request);")

# 9) Devolución parcial: abono confirmado (OP-2026-042) y mercancía donada (OP-2026-054)
r("""    reembolsoMonto
  } = body || {};
  const idempotencyKey = resolverIdempotencyKey(request, body);
""", """    reembolsoMonto,
    anularAbonoId,
    acreditarDonacion,
    motivoAcreditarDonacion
  } = body || {};
  const idempotencyKey = resolverIdempotencyKey(request, body);
""")
r("""  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request);
  if (!Array.isArray(items) || items.length === 0)""", """  // OP-2026-042: abono manual que el operador confirma que era esta misma devolución
  if (anularAbonoId != null && anularAbonoId !== '' && !isValidUuid(anularAbonoId)) {
    return jsonError('anularAbonoId inválido', 400, request);
  }
  if (anularAbonoId && destinoSaldo === 'reembolso') {
    return jsonError('Solo se puede anular un abono cuando el balance va a saldo a favor', 400, request);
  }
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request);
  if (!Array.isArray(items) || items.length === 0)""")
r("""    totalDevueltoUsd = Math.round(totalDevueltoUsd * 10000) / 10000;
""", """    totalDevueltoUsd = Math.round(totalDevueltoUsd * 10000) / 10000;

    // OP-2026-054 (N2): la parte DONADA de lo devuelto vuelve al inventario pero no da crédito ni
    // reembolso. Solo administración/jefe/desarrollador pueden autorizar dar crédito, con motivo.
    const autorizaDonacion = acreditarDonacion === true;
    const donacion = valorDevolucionAcreditable(totalDevueltoUsd, desp.forma_pago_cliente || desp.forma_pago, { autorizado: autorizaDonacion });
    if (autorizaDonacion && donacion.fraccion > 0) {
      if (!['administracion', 'jefe', 'desarrollador'].includes(operador.rol)) {
        return jsonError('Solo administración, jefe o desarrollador pueden autorizar crédito por mercancía donada', 403, request);
      }
      if (String(motivoAcreditarDonacion || '').trim().length < 10) {
        return jsonError('Escribe por qué se da crédito por mercancía donada (mínimo 10 caracteres).', 400, request);
      }
    }
    const totalAcreditableUsd = donacion.acreditable;
""")
r("    const balanceNetoParaCobro = Math.round((totalIntercambioUsd - totalDevueltoUsd) * 10000) / 10000;",
  "    const balanceNetoParaCobro = Math.round((totalIntercambioUsd - totalAcreditableUsd) * 10000) / 10000;")
r("    const balanceNetoDevolucion = Math.round((totalIntercambioUsd - totalDevueltoUsd) * 10000) / 10000;",
  "    const balanceNetoDevolucion = Math.round((totalIntercambioUsd - totalAcreditableUsd) * 10000) / 10000;")
r("""    const atomicRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/registrar_devolucion_parcial_cobro_idempotente`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_cuenta_id: operador.cuenta_id,""", """    // OP-2026-054: con mercancía donada, la devolución pasa por la función que además ajusta el total y la
    // "Donación" del despacho y anota la regla en la auditoría (misma transacción).
    const conDonacion = donacion.fraccion > 0;
    const atomicRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${conDonacion ? 'devolucion_con_donacion' : 'registrar_devolucion_parcial_cobro_idempotente'}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(conDonacion ? {
          p_usuario_rol: operador.rol,
          p_total_devuelto_real: totalDevueltoUsd,
          p_valor_donado: donacion.donado,
          p_fraccion_donada: donacion.fraccion,
          p_acreditar_donacion: autorizaDonacion,
          p_motivo_donacion: autorizaDonacion ? String(motivoAcreditarDonacion).trim() : null,
        } : { p_cotizacion_reemplazo_id: null }),
        p_cuenta_id: operador.cuenta_id,""")
r("""        p_usuario_color: operador.color || null,
        p_cotizacion_reemplazo_id: null,
        p_total_devuelto_usd: totalDevueltoUsd,
""", """        p_usuario_color: operador.color || null,
        p_total_devuelto_usd: totalAcreditableUsd,
""")
r("""          ? pagosReembolsoLimpios
          : null,
      }),
    });
    const atomicText = await atomicRes.text();""", """          ? pagosReembolsoLimpios
          : null,
        // OP-2026-042: la RPC anula este abono en la misma transacción (o falla todo)
        p_anular_abono_id: anularAbonoId || null,
      }),
    });
    const atomicText = await atomicRes.text();""")
r("""          total_reembolso_usd: totalReembolsoUsd,
        },
        ip,
      });
    } catch (auditErr) {
      console.warn('[DEVOLUCION] Auditoría atómica no registrada:', auditErr?.message);""", """          total_reembolso_usd: totalReembolsoUsd,
          // OP-2026-042: copia completa del abono anulado, para que no se pierda el rastro
          abono_anulado: atomicResult.abono_anulado || null,
        },
        ip,
      });
      if (atomicResult.abono_anulado) {
        const an = atomicResult.abono_anulado;
        await registrarAuditoria(env, headers, {
          usuarioId: user.operator_id,
          usuarioNombre: operador.nombre,
          usuarioRol: operador.rol,
          categoria: 'FINANZAS',
          accion: 'ANULAR_ABONO_POR_DEVOLUCION',
          descripcion: `Abono de $${Number(an.monto_usd).toFixed(2)} (${an.referencia || an.descripcion || 'sin referencia'}) anulado al registrar la devolución del despacho #${desp.numero}: el operador confirmó que era la misma devolución`,
          entidadTipo: 'cliente',
          entidadId: an.cliente_id,
          meta: { despacho_id: despachoId, abono: an, idempotency_key: idempotencyKey },
          ip,
        });
      }
    } catch (auditErr) {
      console.warn('[DEVOLUCION] Auditoría atómica no registrada:', auditErr?.message);""")
r("""        balanceNetoUsd: balanceNetoDevolucion,
        destinoSaldo: balanceNetoDevolucion < 0 ? destinoSaldo : 'saldo_a_favor',
        pagosReembolso: pagosReembolsoLimpios,""", """        balanceNetoUsd: balanceNetoDevolucion,
        // OP-2026-054: parte donada de lo devuelto que no dio crédito
        totalAcreditableUsd,
        valorDonadoSinCreditoUsd: donacion.donado,
        fraccionDonada: donacion.fraccion,
        destinoSaldo: balanceNetoDevolucion < 0 ? destinoSaldo : 'saldo_a_favor',
        pagosReembolso: pagosReembolsoLimpios,""")

# 10) Rutas nuevas de solo lectura (copiadas de staging)
STG = open(os.path.join(ROOT, 'construacero-staging', 'api', 'handlers', 'despachos.js'), encoding='utf-8').read().replace('\r\n', '\n')
ini = STG.index('// ─── OP-2026-042: vista previa de cómo afecta una devolución a la deuda')
nuevas = STG[ini:].rstrip('\n') + '\n'
assert '_staging' not in nuevas
s = s.rstrip('\n') + '\n\n\n' + nuevas

open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('despachos.js portado')
