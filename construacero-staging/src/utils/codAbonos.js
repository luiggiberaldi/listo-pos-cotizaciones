// Resumen visual del Cobro a destino (COD) de un despacho, para mostrar abonos parciales.
//
// SOLO PARA MOSTRAR: no decide nada de dinero. La fuente de verdad del saldo COD es el
// libro contable (RPC resumen_financiero_despacho), que es lo que usa el modal de cobro.
// Aquí solo se leen los pagos que la RPC de cobro va acumulando en `metodos_pagados`
// del elemento "Cobro a destino" de forma_pago, mientras `cobro_destino_pagado` es false.
//
// Ojo: al devolver/anular un despacho, el servidor mueve `metodos_pagados` a
// `metodo_propuesto` y lo borra; por eso aquí NO se lee `metodo_propuesto`.

const round2 = n => Math.round(n * 100) / 100

export function resumenCod(f) {
  const monto = round2(Math.max(0, Number(f?.monto) || 0))
  if (f?.cobro_destino_pagado === true) {
    return { monto, abonado: monto, falta: 0, pagado: true, parcial: false }
  }
  const pagos = Array.isArray(f?.metodos_pagados) ? f.metodos_pagados : []
  const abonado = round2(pagos.reduce((sum, p) => {
    const m = Number(p?.monto)
    return Number.isFinite(m) && m > 0 ? sum + m : sum
  }, 0))
  // Solo es "parcial" si lo abonado está estrictamente entre 0 y el monto COD.
  // Si los datos no cuadran (abonado >= monto sin marca de pagado), se muestra como
  // pendiente completo: preferimos no anunciar un abono dudoso.
  if (abonado > 0.005 && abonado < monto - 0.005) {
    return { monto, abonado, falta: round2(monto - abonado), pagado: false, parcial: true }
  }
  return { monto, abonado: 0, falta: monto, pagado: false, parcial: false }
}
