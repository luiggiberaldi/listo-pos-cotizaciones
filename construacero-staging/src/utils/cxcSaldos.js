// src/utils/cxcSaldos.js
// OP-2026-057 (M1): saldo de cada línea del historial calculado AL MOSTRARLO, con los movimientos que
// existen hoy. Antes se mostraba el saldo "foto" guardado al registrar (saldo_usd), que queda viejo
// si después se anula o corrige un movimiento anterior.
// Misma fórmula que el disparador de la base (trg_recalcular_saldo_pendiente):
//   deuda       = Σ cargos − Σ abonos                      (nunca menor que 0)
//   saldo favor = Σ créditos − Σ abonos con "Saldo a favor" − Σ devoluciones de saldo − Σ consumos (nunca menor que 0)

const n = (v) => Number(v || 0)

/** Devuelve un Map id → { deuda, favor } con los saldos acumulados hasta cada movimiento (orden cronológico). */
export function saldosCorridos(movimientos = []) {
  const orden = [...movimientos].sort((a, b) => {
    const ta = new Date(a.creado_en).getTime(), tb = new Date(b.creado_en).getTime()
    if (ta !== tb) return ta - tb
    return String(a.id).localeCompare(String(b.id))
  })
  let deuda = 0
  let favor = 0
  const out = new Map()
  for (const m of orden) {
    const monto = n(m.monto_usd)
    if (m.tipo === 'cargo') deuda += monto
    else if (m.tipo === 'abono') {
      deuda -= monto
      if (m.forma_pago_abono === 'Saldo a favor') favor -= monto
    } else if (m.tipo === 'credito') favor += monto
    else if (m.tipo === 'devolucion_credito' || m.tipo === 'consumo_credito') favor -= monto
    out.set(m.id, {
      deuda: Math.max(0, Math.round(deuda * 100) / 100),
      favor: Math.max(0, Math.round(favor * 100) / 100),
    })
  }
  return out
}

/** Saldo a mostrar en una línea del historial según su tipo. */
export function saldoDeLinea(mov, mapa) {
  const s = mapa?.get(mov.id)
  if (!s) return n(mov.saldo_usd)
  return ['credito', 'devolucion_credito', 'consumo_credito'].includes(mov.tipo) ? s.favor : s.deuda
}
