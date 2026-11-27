// src/utils/formaPagoReglas.js
// OP-2026-055 (N3): un "Cruce" en la forma de pago de un despacho debe decir contra qué se cruzó
// (campo referencia, mínimo 5 caracteres), igual que en los abonos (OP-2026-042).
// Un Cruce que ya existía sin explicación y no cambia de monto se respeta (despachos viejos),
// para no trabar correcciones de otros datos.

const MIN = 5

function aLista(formaPago) {
  if (!formaPago) return []
  if (Array.isArray(formaPago)) return formaPago
  if (typeof formaPago === 'string') {
    try { const j = JSON.parse(formaPago); return Array.isArray(j) ? j : [] } catch { return [] }
  }
  return []
}

const esCruce = (f) => String(f?.metodo || '').trim().toLowerCase() === 'cruce'
const explicado = (f) => String(f?.referencia || f?.nota || '').trim().length >= MIN

/** Devuelve el mensaje de error si hay un Cruce nuevo o cambiado sin explicación; si no, null. */
export function errorCruceSinExplicacion(formaPago, formaPagoAnterior = null) {
  const anteriores = aLista(formaPagoAnterior).filter(f => esCruce(f) && !explicado(f)).map(f => Math.round(Number(f.monto || 0) * 100))
  for (const f of aLista(formaPago)) {
    if (!esCruce(f)) continue
    const monto = Number(f?.monto || 0)
    if (!(monto > 0) || explicado(f)) continue
    const i = anteriores.indexOf(Math.round(monto * 100))
    if (i >= 0) { anteriores.splice(i, 1); continue }   // Cruce viejo sin cambios: se respeta
    return `El pago con "Cruce" de $${monto.toFixed(2)} debe decir contra qué se cruzó (escríbelo en el campo del Cruce, mínimo ${MIN} caracteres).`
  }
  return null
}
