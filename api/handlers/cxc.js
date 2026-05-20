// api/handlers/cxc.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

async function recalcularSaldoPendienteCliente(clienteId, env, headers) {
  try {
    const cxcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?cliente_id=eq.${clienteId}&select=tipo,monto_usd`, { headers });
    if (!cxcRes.ok) return;
    const cxcList = await cxcRes.json();
    
    let saldoReal = 0;
    if (Array.isArray(cxcList)) {
      cxcList.forEach(item => {
        const monto = Number(item.monto_usd) || 0;
        if (item.tipo === 'cargo') {
          saldoReal += monto;
        } else {
          saldoReal -= monto;
        }
      });
    }
    
    saldoReal = Math.max(0, Math.round(saldoReal * 10000) / 10000);
    
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ saldo_pendiente: saldoReal }),
    });
    
    console.log(`[RECALCULO-SALDO] Cliente ${clienteId} saldo sincronizado a $${saldoReal}`);
  } catch (err) {
    console.error(`[RECALCULO-SALDO] Error al recalcular saldo para cliente ${clienteId}:`, err?.message);
  }
}

export async function handleRegistrarAbono(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_ABONO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_ABONO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden registrar abonos', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { clienteId, monto, formaPago, referencia, descripcion, despachoId } = body;
  if (!clienteId || !isValidUuid(clienteId)) return jsonError('clienteId inválido', 400, request);
  if (!monto || monto <= 0) return jsonError('Monto inválido', 400, request);

  try {
    // 1. Obtener cliente y su saldo actual
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=saldo_pendiente`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado', 404, request);

    let saldoActual = Number(cliente.saldo_pendiente || 0);

    // Auto-sanación para despachos COD heredados (anteriores a la actualización de cargos automáticos)
    if (despachoId) {
      const cargoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.cargo&select=id`, { headers });
      const cargos = await cargoRes.json();
      if (Array.isArray(cargos) && cargos.length === 0) {
        console.log(`[AUTO-HEAL] Creando cargo CxC faltante para despacho COD heredado: ${despachoId}`);
        
        // Obtener el despacho y su forma_pago para extraer el monto de "Cobro a destino" correcto
        const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=forma_pago,total_usd`, { headers });
        const despachos = await dRes.json();
        let montoCargo = Number(monto); // Fallback al monto del abono si no se puede leer el despacho
        
        if (Array.isArray(despachos) && despachos.length > 0) {
          const desp = despachos[0];
          try {
            const fps = typeof desp.forma_pago === 'string' ? JSON.parse(desp.forma_pago) : desp.forma_pago;
            if (Array.isArray(fps)) {
              const cod = fps.find(f => f.metodo === 'Cobro a destino');
              if (cod && cod.monto) {
                montoCargo = Number(cod.monto);
              }
            }
          } catch (err) {
            console.error('[AUTO-HEAL] Error parseando forma_pago del despacho:', err);
          }
        }

        // 1.1 Crear el cargo CxC faltante
        const cargoBody = {
          cliente_id: clienteId,
          despacho_id: despachoId,
          tipo: 'cargo',
          monto_usd: montoCargo,
          saldo_usd: saldoActual + montoCargo,
          descripcion: `Cargo COD auto-generado (Legacy DES)`,
          registrado_por: operador.id
        };

        const postCargo = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify(cargoBody)
        });

        if (postCargo.ok) {
          // 1.2 Actualizar saldo actual en memoria y en base de datos
          saldoActual += montoCargo;
          await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ saldo_pendiente: saldoActual })
          });
        }
      }
    }

    // Ajustar por diferencias infinitesimales de coma flotante si es para saldar
    let montoAbonar = Number(monto);
    const roundedMonto = Math.round(montoAbonar * 100) / 100;
    const roundedSaldo = Math.round(saldoActual * 100) / 100;

    if (roundedMonto === roundedSaldo) {
      // Si redondeados a centavos son iguales, forzar el monto del abono al saldo exacto de base de datos
      // para saldar la cuenta al 100% sin dejar saldos residuales decimales como 0.0001
      montoAbonar = saldoActual;
    } else if (roundedMonto > roundedSaldo) {
      // Si excede por una fracción menor a 1.5 centavos, ajustar al saldo real
      const diff = montoAbonar - saldoActual;
      if (diff > 0 && diff < 0.015) {
        montoAbonar = saldoActual;
      } else {
        return jsonError(`El abono ($${monto}) supera el saldo pendiente ($${saldoActual.toFixed(4)})`, 400, request);
      }
    }

    const nuevoSaldo = Math.max(0, Math.round((saldoActual - montoAbonar) * 10000) / 10000);

    // 2. Registrar abono
    const aRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cliente_id: clienteId,
        despacho_id: despachoId || null,
        tipo: 'abono',
        monto_usd: montoAbonar,
        forma_pago_abono: formaPago,
        referencia,
        saldo_usd: nuevoSaldo,
        descripcion: descripcion || 'Abono recibido',
        registrado_por: operador.id
      }),
    });
    if (!aRes.ok) {
      const err = await aRes.text();
      return jsonError(`Error al registrar abono: ${err}`, 500, request);
    }
    const [abono] = await aRes.json();

    // 3. Recalcular saldo pendiente real del cliente de forma unificada desde la base de datos
    await recalcularSaldoPendienteCliente(clienteId, env, headers);

    // 4. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: 'REGISTRAR_ABONO', descripcion: `Abono de $${montoAbonar} registrado para cliente ${clienteId}`,
        entidadTipo: 'cliente', entidadId: clienteId, meta: { monto: montoAbonar, forma_pago: formaPago, saldo_anterior: saldoActual, saldo_nuevo: nuevoSaldo }, ip,
      });
    } catch {}

    return json({ id: abono.id, nuevoSaldo }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al registrar abono', 500, request);
  }
}
