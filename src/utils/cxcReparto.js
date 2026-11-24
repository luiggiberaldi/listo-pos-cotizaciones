// src/utils/cxcReparto.js
// OP-2026-042: una sola fórmula para saber qué despacho está pagado.
//
// Regla (la misma que usaba la pantalla de CxC y que ahora usa también la
// devolución, vía la función SQL `cxc_reparto_cliente`):
//   Fase 1: cada abono ENLAZADO a un despacho paga los cargos de ese despacho,
//           primero el de su mismo tipo (crédito / cobro a destino) (OP-2026-057).
//   Fase 2: lo que sobra de cada abono (y los abonos sueltos) paga los cargos
//           del más viejo al más nuevo.
// Solo cuentan los movimientos de tipo 'cargo' y 'abono'. Los demás tipos
// (credito, consumo_credito, devolucion_credito) son del saldo a favor.
//
// Orden: creado_en ascendente y, si empatan, id ascendente (igual que el SQL).

const r4 = n => Math.round(Number(n || 0) * 10000) / 10000
const r2 = n => Math.round(Number(n || 0) * 100) / 100

// Las fechas llegan de la base en un mismo formato (UTC); compararlas como
// texto conserva los microsegundos, que Date() perdería.
const claveFecha = v => String(v || '').replace(' ', 'T')
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0)

function ordenar(movs) {
  return [...(movs || [])].sort((a, b) =>
    cmp(claveFecha(a.creado_en), claveFecha(b.creado_en)) || cmp(String(a.id || ''), String(b.id || '')))
}

/**
 * Reparte los abonos de UN cliente sobre sus cargos.
 * @returns {{ cargos: Array, abonos: Array }}
 *   cargos[i].saldo_pendiente_cargo → lo que falta por pagar de ese cargo
 *   abonos[i].monto_restante        → lo que no encontró cargo (pagado de más)
 *   abonos[i].aplicaciones          → [{ cargoId, despacho_id, monto }]
 */
export function repartirCxC(movs) {
  const ord = ordenar(movs)
  const cargos = []
  const abonos = []
  for (const t of ord) {
    if (t.tipo === 'cargo') cargos.push({ ...t, saldo_pendiente_cargo: r4(t.monto_usd) })
    else if (t.tipo === 'abono') abonos.push({ ...t, monto_restante: r4(t.monto_usd), aplicaciones: [] })
  }

  const aplicar = (abono, cargo) => {
    const monto = Math.min(cargo.saldo_pendiente_cargo, abono.monto_restante)
    if (monto <= 0) return
    cargo.saldo_pendiente_cargo = r4(cargo.saldo_pendiente_cargo - monto)
    abono.monto_restante = r4(abono.monto_restante - monto)
    abono.aplicaciones.push({ cargoId: cargo.id, despacho_id: cargo.despacho_id || null, monto: r4(monto) })
  }

  // Fase 1: abonos enlazados → cargos de SU despacho.
  // OP-2026-057 (M3): en un despacho con dos deudas (crédito y cobro a destino), el abono paga primero la
  // deuda de su mismo tipo (metodo_pago 'cod' con 'cod', el resto con 'cxc') y después la otra del mismo
  // despacho; solo lo que sobre pasa a la fase 2. Antes pagaba solo el primer cargo del despacho.
  for (const abono of abonos) {
    if (!abono.despacho_id) continue
    const metodoAbono = abono.metodo_pago === 'cod' ? 'cod' : 'cxc'
    const delDespacho = cargos.filter(c => c.despacho_id === abono.despacho_id)
    const ordenados = [
      ...delDespacho.filter(c => (c.metodo_pago === 'cod' ? 'cod' : 'cxc') === metodoAbono),
      ...delDespacho.filter(c => (c.metodo_pago === 'cod' ? 'cod' : 'cxc') !== metodoAbono),
    ]
    for (const cargo of ordenados) {
      if (abono.monto_restante <= 0) break
      if (cargo.saldo_pendiente_cargo > 0) aplicar(abono, cargo)
    }
  }

  // Fase 2: resto, del cargo más viejo al más nuevo
  for (const abono of abonos) {
    if (abono.monto_restante <= 0) continue
    for (const cargo of cargos) {
      if (cargo.saldo_pendiente_cargo > 0) aplicar(abono, cargo)
      if (abono.monto_restante <= 0) break
    }
  }

  return { cargos, abonos }
}

/** Lo que falta por pagar de un despacho (suma de sus cargos), según el reparto. */
export function pendienteDeDespacho(movs, despachoId) {
  const { cargos } = repartirCxC(movs)
  return r4(cargos.filter(c => c.despacho_id === despachoId)
    .reduce((s, c) => s + c.saldo_pendiente_cargo, 0))
}

/** Lo que falta por pagar de un despacho contando SOLO lo enlazado (la regla vieja). */
export function pendienteSoloEnlazado(movs, despachoId) {
  const s = (movs || []).filter(m => m.despacho_id === despachoId)
    .reduce((acc, m) => acc + (m.tipo === 'cargo' ? Number(m.monto_usd || 0) : m.tipo === 'abono' ? -Number(m.monto_usd || 0) : 0), 0)
  return r4(Math.max(0, s))
}

/**
 * Abonos que, según el reparto, están pagando el despacho indicado.
 * Sirve para avisar en una devolución: "este despacho ya lo cubrió tal abono".
 */
export function abonosQueCubrenDespacho(movs, despachoId) {
  const { abonos } = repartirCxC(movs)
  return abonos
    .map(a => ({
      id: a.id,
      monto_usd: r4(a.monto_usd),
      aplicado: r4(a.aplicaciones.filter(x => x.despacho_id === despachoId).reduce((s, x) => s + x.monto, 0)),
      enlazado: a.despacho_id === despachoId,
      despacho_id: a.despacho_id || null,
      forma_pago_abono: a.forma_pago_abono ?? null,
      referencia: a.referencia ?? null,
      descripcion: a.descripcion ?? null,
      creado_en: a.creado_en ?? null,
    }))
    .filter(a => a.aplicado > 0)
}

/** Cargos con algo pendiente (para el selector de despacho al registrar un abono). */
export function cargosPendientes(movs) {
  const { cargos } = repartirCxC(movs)
  return cargos
    .filter(c => c.saldo_pendiente_cargo > 0.005)
    .map(c => ({
      id: c.id,
      despacho_id: c.despacho_id || null,
      monto_usd: r4(c.monto_usd),
      pendiente: r4(c.saldo_pendiente_cargo),
      descripcion: c.descripcion ?? null,
      creado_en: c.creado_en ?? null,
      fecha_vencimiento: c.fecha_vencimiento ?? null,
    }))
}

/**
 * Pagado de más: lo que los abonos superan a los cargos. El saldo del cliente
 * nunca baja de 0, así que este exceso no se veía en ningún lado (falla G3).
 */
export function pagadoDeMas(movs) {
  let s = 0
  for (const m of movs || []) {
    if (m.tipo === 'abono') s += Number(m.monto_usd || 0)
    else if (m.tipo === 'cargo') s -= Number(m.monto_usd || 0)
  }
  return r2(Math.max(0, s))
}

/** ¿Este abono se puede anular como parte de una devolución? (mismo criterio que el SQL) */
export function abonoAnulableEnDevolucion(abono, despachoId) {
  if (!abono) return false
  if (abono.despacho_id && abono.despacho_id !== despachoId) return false
  const forma = String(abono.forma_pago_abono || '')
  if (forma === 'Devolución' || forma === 'Saldo a favor') return false
  return true
}
