// api/lib/cxcUtils.js
// Función unificada y estandarizada para recálculo y sincronización de saldos de clientes
// OP-2026-057 (M5): si el recálculo falla, queda anotado en la auditoría (categoría SISTEMA,
// RECALCULO_SALDO_FALLIDO) en vez de perderse en la consola. La base además recalcula sola con su
// disparador (trg_recalcular_saldo_pendiente), así que un fallo aquí no deja el saldo mal.
import { registrarAuditoria } from './audit.js'

async function anotarFallo(env, headers, clienteId, paso, detalle) {
  try {
    await registrarAuditoria(env, headers, {
      usuarioId: null, usuarioNombre: 'Sistema', usuarioRol: 'sistema',
      categoria: 'SISTEMA', accion: 'RECALCULO_SALDO_FALLIDO',
      descripcion: `No se pudo recalcular el saldo del cliente ${clienteId} (${paso})`,
      entidadTipo: 'cliente', entidadId: clienteId,
      meta: { paso, detalle: String(detalle || '').slice(0, 500) },
    });
  } catch { /* la auditoría ya avisa en consola si falla */ }
}

export async function recalcularSaldoPendienteCliente(clienteId, env, headers) {
  if (!clienteId) return { saldoReal: 0, saldoFavor: 0 };

  try {
    const cxcRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?cliente_id=eq.${clienteId}&select=tipo,monto_usd,forma_pago_abono`,
      { headers }
    );

    if (!cxcRes.ok) {
      const txt = await cxcRes.text();
      console.error(`[RECALCULO-SALDO] Error leyendo cuentas_por_cobrar del cliente ${clienteId}:`, txt);
      await anotarFallo(env, headers, clienteId, 'leer movimientos', txt);
      return { saldoReal: 0, saldoFavor: 0 };
    }

    const cxcList = await cxcRes.json();

    let saldoReal = 0;
    let saldoFavor = 0;

    if (Array.isArray(cxcList)) {
      cxcList.forEach(item => {
        const monto = Number(item.monto_usd) || 0;
        if (item.tipo === 'cargo') {
          saldoReal += monto;
        } else if (item.tipo === 'abono') {
          saldoReal -= monto;
          if (item.forma_pago_abono === 'Saldo a favor') {
            saldoFavor -= monto;
          }
        } else if (item.tipo === 'credito') {
          saldoFavor += monto;
        } else if (item.tipo === 'devolucion_credito' || item.tipo === 'consumo_credito') {
          saldoFavor -= monto;
        }
      });
    }

    saldoReal = Math.max(0, Math.round(saldoReal * 10000) / 10000);
    saldoFavor = Math.max(0, Math.round(saldoFavor * 10000) / 10000);

    const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ saldo_pendiente: saldoReal, saldo_a_favor: saldoFavor }),
    });

    if (!patchRes.ok) {
      const patchTxt = await patchRes.text();
      console.error(`[RECALCULO-SALDO] Error al actualizar cliente ${clienteId}:`, patchTxt);
      await anotarFallo(env, headers, clienteId, 'guardar saldo', patchTxt);
    } else {
      console.log(`[RECALCULO-SALDO] Cliente ${clienteId} sincronizado -> Deuda: $${saldoReal}, Favor: $${saldoFavor}`);
    }

    return { saldoReal, saldoFavor };
  } catch (err) {
    console.error(`[RECALCULO-SALDO] Excepción recalculando cliente ${clienteId}:`, err?.message);
    await anotarFallo(env, headers, clienteId, 'excepción', err?.message);
    return { saldoReal: 0, saldoFavor: 0 };
  }
}
