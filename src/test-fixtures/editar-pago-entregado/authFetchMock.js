// Mock local de authFetch para la prueba del modal EditarPagoEntregado:
// registra cada body enviado a /api/despachos/editar-pago en window.__pagosRequests y
// simula el estado real de CxC que trae /api/despachos/resumen-financiero.
// El cuadre automático (paso 2) registra sus abonos en window.__pagosAbonos y sus
// reverisiones de cargo en window.__pagosReversiones.
// No usa Supabase ni ninguna red real.
window.__pagosAbonos = []
window.__pagosReversiones = []

export async function authFetch(path, options = {}) {
  if (path === '/api/despachos/resumen-financiero') {
    const { despachoId } = JSON.parse(options.body)
    // Solo el despacho "fixture-cxc-1" tiene deuda en cuentas por cobrar.
    const ledger = despachoId === 'fixture-cxc-1'
      ? { cargo_cxc_usd: 350, abono_cxc_usd: 100, deuda_cxc_usd: 250, cargo_cod_usd: 200, deuda_cod_usd: 200 }
      : { cargo_cxc_usd: 0, abono_cxc_usd: 0, deuda_cxc_usd: 0, cargo_cod_usd: 300, deuda_cod_usd: 300 }
    return new Response(JSON.stringify({ resumen: { cod: { estado: 'pendiente' }, ledger } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (path === '/api/despachos/editar-pago') {
    const body = JSON.parse(options.body)
    window.__pagosRequests.push(body)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (path === '/api/cxc/abono') {
    const body = JSON.parse(options.body)
    window.__pagosAbonos.push(body)
    return new Response(JSON.stringify({ id: 'abono-fixture', nuevoSaldo: 50 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (path === '/api/cxc/revertir-cargo') {
    const body = JSON.parse(options.body)
    window.__pagosReversiones.push(body)
    return new Response(JSON.stringify({ ok: true, montoAnterior: 350, montoNuevo: body.montoNuevo }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  throw new Error(`Ruta de prueba inesperada: ${path}`)
}
