// src/utils/pesoDespacho.js
// Peso de un despacho (kg) y comparación con la capacidad del vehículo.
// El peso por unidad se carga a mano en cada producto (100 g = 0.1 kg). Solo ADVIERTE: nunca bloquea.

const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** "2.140 kg", "0,1 kg", "10,7 kg". Sin dato → '—'. */
export function formatPeso(kg) {
  const n = num(kg)
  if (n === null) return '—'
  return `${n.toLocaleString('es-VE', { maximumFractionDigits: 3 })} kg`
}

/**
 * Resumen de peso a partir de la fila de la vista despacho_pesos.
 * @returns {{ totalKg:number, sinPeso:number, incompleto:boolean, sinDatos:boolean }}
 */
export function resumenPeso(fila) {
  const totalKg = num(fila?.peso_total_kg) ?? 0
  const sinPeso = Math.max(0, Math.trunc(num(fila?.items_sin_peso) ?? 0))
  const itemsTotal = Math.max(0, Math.trunc(num(fila?.items_total) ?? 0))
  return { totalKg, sinPeso, incompleto: sinPeso > 0, sinDatos: itemsTotal > 0 && sinPeso >= itemsTotal }
}

/**
 * Compara el peso contra la capacidad del vehículo. Sin capacidad cargada → null (no se muestra nada).
 * @returns {null | { capacidadKg:number, pct:number, excede:boolean, libreKg:number }}
 */
export function comparaCapacidad(totalKg, capacidadKg) {
  const total = num(totalKg) ?? 0
  const cap = num(capacidadKg)
  if (cap === null || cap <= 0) return null
  return { capacidadKg: cap, pct: Math.round((total / cap) * 100), excede: total > cap, libreKg: Math.round((cap - total) * 1000) / 1000 }
}

/** Peso de una línea: cantidad × peso por unidad. Sin peso por unidad → null. */
export function pesoLinea(cantidad, pesoUnitKg) {
  const c = num(cantidad)
  const p = num(pesoUnitKg)
  if (c === null || p === null) return null
  return Math.round(c * p * 1000) / 1000
}
