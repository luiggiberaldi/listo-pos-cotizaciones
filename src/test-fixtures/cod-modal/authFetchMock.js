const INITIAL_COD_USD = 200.01

function ledgerState() {
  window.__codLedger ||= { payments: [] }
  return window.__codLedger
}

export async function authFetch(path, options = {}) {
  if (path === '/api/despachos/resumen-financiero') {
    const paid = ledgerState().payments.reduce((total, request) =>
      total + request.pagos.reduce((subtotal, payment) => subtotal + payment.monto, 0), 0)
    const deuda = Math.max(0, Math.round((INITIAL_COD_USD - paid + Number.EPSILON) * 100) / 100)
    return new Response(JSON.stringify({
      resumen: {
        cod: { estado: deuda > 0 ? (paid > 0 ? 'parcial' : 'pendiente') : 'cobrado', revisar: false },
        ledger: { deuda_cod_usd: deuda, cargo_cod_usd: INITIAL_COD_USD, abono_cod_usd: paid, compensado_usd: 0 },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (path === '/api/despachos/conciliar-cod') {
    const body = JSON.parse(options.body)
    window.__codRequests.push(body)
    ledgerState().payments.push(body)
    return new Response(JSON.stringify({ ok: true, pago_usd: body.pagos.reduce((sum, payment) => sum + payment.monto, 0) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  throw new Error(`Ruta de prueba inesperada: ${path}`)
}
