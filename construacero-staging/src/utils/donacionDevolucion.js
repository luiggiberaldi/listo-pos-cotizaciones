// src/utils/donacionDevolucion.js
// OP-2026-054 (N2): devolver mercancía DONADA no da crédito ni reembolso.
// Regla única, usada por la pantalla de devolución y por el Worker:
//   - parte donada del despacho = monto "Donación" ÷ suma de montos de su forma de pago;
//   - de lo que se devuelve, esa parte vuelve al inventario pero NO cuenta como dinero del cliente;
//   - solo con autorización explícita (rol administración/jefe/desarrollador + motivo) se acredita todo.
// Si la forma de pago no permite saber qué parte fue donada, se considera 0 % donado.

const esDonacion = (metodo) => {
  const m = String(metodo || '').trim().toLowerCase()
  return m === 'donación' || m === 'donacion'
}

function aLista(formaPago) {
  if (!formaPago) return []
  if (Array.isArray(formaPago)) return formaPago
  if (typeof formaPago === 'string') {
    const t = formaPago.trim()
    if (esDonacion(t)) return [{ metodo: t, monto: 1 }]   // texto simple "Donación" = todo donado
    try { const j = JSON.parse(t); return Array.isArray(j) ? j : [] } catch { return [] }
  }
  return []
}

/** Fracción del despacho que fue donada (0 a 1). */
export function fraccionDonada(formaPago) {
  const lista = aLista(formaPago)
  let total = 0
  let donado = 0
  for (const f of lista) {
    const m = Number(f?.monto)
    if (!Number.isFinite(m) || m <= 0) continue
    total += m
    if (esDonacion(f?.metodo)) donado += m
  }
  if (total <= 0 || donado <= 0) return 0
  return Math.min(1, Math.round((donado / total) * 1e6) / 1e6)
}

/**
 * Reparte el valor devuelto entre la parte que da crédito y la parte donada.
 * @returns {{ fraccion: number, acreditable: number, donado: number }}
 */
export function valorDevolucionAcreditable(totalDevuelto, formaPago, { autorizado = false } = {}) {
  const total = Math.round(Number(totalDevuelto || 0) * 10000) / 10000
  const fraccion = fraccionDonada(formaPago)
  if (autorizado || fraccion <= 0) return { fraccion, acreditable: total, donado: 0 }
  const donado = Math.round(total * fraccion * 10000) / 10000
  return { fraccion, acreditable: Math.round((total - donado) * 10000) / 10000, donado }
}
