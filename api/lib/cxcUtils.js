// api/lib/cxcUtils.js
// Función unificada y estandarizada para recálculo y sincronización de saldos de clientes

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
        } else if (item.tipo === 'devolucion_credito') {
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
    } else {
      console.log(`[RECALCULO-SALDO] Cliente ${clienteId} sincronizado -> Deuda: $${saldoReal}, Favor: $${saldoFavor}`);
    }

    return { saldoReal, saldoFavor };
  } catch (err) {
    console.error(`[RECALCULO-SALDO] Excepción recalculando cliente ${clienteId}:`, err?.message);
    return { saldoReal: 0, saldoFavor: 0 };
  }
}
