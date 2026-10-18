/**
 * F0.2 — Tests unitarios de scripts/lib/invariantes.mjs (lógica pura R1–R5).
 *
 * Regresión ancla: caso DES-03368 (Romel Rivas, escenario A, cerrado 24-sep-2026).
 *   · cargo COD (flete) $270
 *   · devolución 12×FLANCHE $96 → COMPENSACIÓN, bucket OTROS (flanche no es cabilla)
 *   · cierre: abonos $170 Transferencia + $4 Pago móvil aplicados al cargo COD
 *   · comisión bruta $63.14 → neta $61.22 (cabilla $14.40 + otros $46.82)
 *
 * Regresión de semántica: saldo a favor (crédito → consumo) verificado contra
 * producción con los casos Héctor Jordan, Ferrechuros 2025 y Manuel Veliz.
 */
import { describe, expect, it } from 'vitest'
import {
  TOLERANCIA_USD,
  TOLERANCIA_COMISION,
  round2,
  esCompensacionForma,
  esConsumoSaldoFavor,
  replayCliente,
  clasificarDeudaCod,
  estadoCodDerivado,
  clasificarBucketItem,
  comisionNetaPorBucket,
  desfaseComision,
  invarianteFlagVsLedger,
  invarianteSaldoVsReplay,
} from '../invariantes.mjs'

const DES = 'e746f381-96f6-4de7-8caf-a9387137cd27'

// ANTES del cierre: cargo 270 − compensación devolución 96 = deuda 174 sin cobrar
const LEDGER_3368_ANTES = [
  { tipo: 'cargo', monto_usd: 270, forma_pago_abono: null, despacho_id: DES },
  { tipo: 'abono', monto_usd: 96, forma_pago_abono: 'Devolución mercancía', despacho_id: DES },
]

// DESPUÉS del cierre (escenario A): solvente, $0.00
const LEDGER_3368_DESPUES = [
  ...LEDGER_3368_ANTES,
  { tipo: 'abono', monto_usd: 170, forma_pago_abono: 'Transferencia', despacho_id: DES },
  { tipo: 'abono', monto_usd: 4, forma_pago_abono: 'Pago móvil', despacho_id: DES },
]

// Mercancía 3,156.77: cabilla 719.80 + otros 2,436.97 brutos; 12×FLANCHE 96 en OTROS
const FIX_3368_COMISION = {
  items: [
    { bucket: 'cabilla', monto: 719.8 },
    { bucket: 'otros', monto: 2436.97 },
  ],
  devoluciones: [{ bucket: 'otros', monto: 96 }],
}

describe('regresión DES-03368 (escenario A)', () => {
  it('el ledger ANTES del cierre reproduce la deuda fantasma que abrió el expediente', () => {
    const r = replayCliente(LEDGER_3368_ANTES)
    expect(r.deuda).toBe(174)
    expect(r.compensadoUsd).toBe(96)
    expect(r.cobradoUsd).toBe(0)
    // I1: con el flag COD pagado esto era clase A → fail (exactamente el bug 3368)
    const i1 = invarianteFlagVsLedger({ codPagado: true, deudaDesp: r.deuda, abonosSinVinculo: 0 })
    expect(i1.estado).toBe('fail')
    expect(clasificarDeudaCod({ deudaDesp: 174, abonosSinVinculo: 0 })).toBe('A')
  })

  it('el ledger DESPUÉS del cierre cuadra a $0 y el estado derivado es cobrado', () => {
    const r = replayCliente(LEDGER_3368_DESPUES)
    expect(r.deuda).toBe(0)
    expect(r.cargo).toBe(270)
    expect(r.abono).toBe(270)
    expect(r.cobradoUsd).toBe(174)
    expect(r.compensadoUsd).toBe(96)
    const est = estadoCodDerivado({
      tieneCargoCod: true,
      deudaCargo: r.deuda,
      cobradoUsd: r.cobradoUsd,
      compensadoUsd: r.compensadoUsd,
    })
    expect(est).toEqual({ estado: 'cobrado', revisar: false, reembolsado: false })
    const i1 = invarianteFlagVsLedger({ codPagado: true, deudaDesp: r.deuda, abonosSinVinculo: 0 })
    expect(i1.estado).toBe('ok')
  })

  it('la comisión neta por bucket reproduce los $61.22 almacenados en el cierre', () => {
    const c = comisionNetaPorBucket(FIX_3368_COMISION)
    expect(c.bases).toEqual({ cabilla: 719.8, otros: 2340.97, externo: 0 })
    expect(c.comisionCabilla).toBe(14.4) // 2% de 719.80
    expect(c.comisionOtros).toBe(46.82) // 2% de 2340.97
    expect(c.total).toBe(61.22)
  })

  it('la comisión bruta coincide con los $63.14 previos al cierre (otros 48.74 intactos)', () => {
    const c = comisionNetaPorBucket({ ...FIX_3368_COMISION, devoluciones: [] })
    expect(c.comisionCabilla).toBe(14.4)
    expect(c.comisionOtros).toBe(48.74) // 2% de 2436.97 — lo que estaba almacenado antes
    expect(c.total).toBe(63.14)
    expect(c.totalBruta).toBe(63.14)
  })

  it('ambos modelos concuerdan: neto por bucket == escalado E1 sobre la bruta', () => {
    const c = comisionNetaPorBucket(FIX_3368_COMISION)
    const factorMercancia = (3156.77 - 96) / 3156.77 // E1: (total−devolución)/total_original
    expect(c.total).toBe(61.22)
    expect(round2(63.14 * factorMercancia)).toBe(61.22)
  })
})

describe('round2 y tolerancias', () => {
  it('redondea a centavos sin artefactos de coma flotante', () => {
    expect(round2(14.396)).toBe(14.4)
    expect(round2(48.7394)).toBe(48.74)
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(63.1354)).toBe(63.14)
  })
  it('las tolerancias son las fijadas por el ADR', () => {
    expect(TOLERANCIA_USD).toBe(0.01)
    expect(TOLERANCIA_COMISION).toBe(0.02)
  })
})

describe('esCompensacionForma (R1: no todo abono es dinero entrado)', () => {
  it('detecta devoluciones, cruces, compensaciones y pagos con saldo a favor', () => {
    expect(esCompensacionForma('Devolución mercancía')).toBe(true)
    expect(esCompensacionForma('DEVOLUCION SALDO')).toBe(true)
    expect(esCompensacionForma('Cruce con nota de crédito')).toBe(true)
    expect(esCompensacionForma('Compensación saldo a favor')).toBe(true)
    expect(esCompensacionForma('Saldo a favor')).toBe(true)
    expect(esCompensacionForma('Pago con Saldo a Favor (CRÉDITO)')).toBe(true)
  })
  it('el dinero real no es compensación', () => {
    expect(esCompensacionForma('Transferencia')).toBe(false)
    expect(esCompensacionForma('Pago móvil')).toBe(false)
    expect(esCompensacionForma('Efectivo')).toBe(false)
    expect(esCompensacionForma('')).toBe(false)
    expect(esCompensacionForma(null)).toBe(false)
    expect(esCompensacionForma(undefined)).toBe(false)
  })
})

describe('esConsumoSaldoFavor (semántica verificada en producción)', () => {
  it('solo el pago con CRÉDITO consume saldo a favor', () => {
    expect(esConsumoSaldoFavor('Saldo a favor')).toBe(true)
    expect(esConsumoSaldoFavor('Pago con Saldo a Favor (CRÉDITO)')).toBe(true)
    expect(esConsumoSaldoFavor('Devolución mercancía')).toBe(false)
    expect(esConsumoSaldoFavor('Transferencia')).toBe(false)
    expect(esConsumoSaldoFavor(null)).toBe(false)
  })
})

describe('replayCliente (R1: el ledger manda)', () => {
  it('deuda = cargo − abono y saldo a favor = crédito − devolución de crédito', () => {
    const r = replayCliente([
      { tipo: 'cargo', monto_usd: 100, despacho_id: 'd1' },
      { tipo: 'abono', monto_usd: 30, forma_pago_abono: 'Efectivo', despacho_id: 'd1' },
      { tipo: 'credito', monto_usd: 50 },
      { tipo: 'devolucion_credito', monto_usd: 20 },
    ])
    expect(r.deuda).toBe(70)
    expect(r.saldoAFavor).toBe(30)
  })

  it('los abonos "Saldo a favor" CONSUMEN el crédito (caso Héctor Jordan)', () => {
    // producción: credito 9.57 ("Saldo a favor por excedente en intercamb…") +
    // abono 9.57 forma "Saldo a favor" ("Pago con Saldo a Favor (CRÉDITO)")
    const r = replayCliente([
      { tipo: 'credito', monto_usd: 9.57, forma_pago_abono: 'Devolución' },
      { tipo: 'abono', monto_usd: 9.57, forma_pago_abono: 'Saldo a favor', despacho_id: 'd-1922' },
    ])
    expect(r.consumoSaldoFavor).toBe(9.57)
    expect(r.saldoAFavor).toBe(0) // casó con clientes.saldo_a_favor = 0
    expect(r.compensadoUsd).toBe(9.57) // no entró dinero nuevo
    expect(r.cobradoUsd).toBe(0)
  })

  it('crédito grande con consumos parciales (caso Ferrechuros 2025)', () => {
    // producción: creditos 815, devoluciones de crédito 5, consumos 810 → saldo_a_favor 0
    const r = replayCliente([
      { tipo: 'credito', monto_usd: 815 },
      { tipo: 'devolucion_credito', monto_usd: 5 },
      { tipo: 'abono', monto_usd: 810, forma_pago_abono: 'Saldo a favor', despacho_id: 'd1' },
    ])
    expect(r.saldoAFavor).toBe(0)
  })

  it('consumo parcial deja remanente (caso Manuel Veliz)', () => {
    // producción: creditos 3.40, consumo 3.38 → clientes.saldo_a_favor = 0.02
    const r = replayCliente([
      { tipo: 'credito', monto_usd: 3.4 },
      { tipo: 'abono', monto_usd: 3.38, forma_pago_abono: 'Saldo a favor', despacho_id: 'd1' },
    ])
    expect(r.saldoAFavor).toBe(0.02)
  })

  it('separa abonos sin vínculo, cobrado y compensado', () => {
    const r = replayCliente([
      { tipo: 'cargo', monto_usd: 200, despacho_id: 'd1' },
      { tipo: 'abono', monto_usd: 40, forma_pago_abono: 'Transferencia' }, // sin despacho_id
      { tipo: 'abono', monto_usd: 60, forma_pago_abono: 'Transferencia', despacho_id: 'd1' },
      { tipo: 'abono', monto_usd: 25, forma_pago_abono: 'Devolución', despacho_id: 'd1' },
    ])
    expect(r.abonosSinVinculo).toBe(40)
    expect(r.cobradoUsd).toBe(60)
    expect(r.compensadoUsd).toBe(25)
    expect(r.deuda).toBe(75)
  })

  it('tolera montos con signo y entradas basura', () => {
    const r = replayCliente([
      { tipo: 'cargo', monto_usd: -100, despacho_id: 'd1' },
      { tipo: 'abono', monto_usd: '10.5', forma_pago_abono: 'Efectivo', despacho_id: 'd1' },
      { tipo: 'otra_cosa', monto_usd: 999 },
      { monto_usd: null },
    ])
    expect(r.cargo).toBe(100)
    expect(r.abono).toBe(10.5)
    expect(r.deuda).toBe(89.5)
  })

  it('vacío cuadra en cero', () => {
    expect(replayCliente()).toEqual({
      deuda: 0, cargo: 0, abono: 0, credito: 0, devolucionCredito: 0,
      abonosSinVinculo: 0, cobradoUsd: 0, compensadoUsd: 0, consumoSaldoFavor: 0, saldoAFavor: 0,
    })
  })
})

describe('clasificarDeudaCod (clases A/B/C/D)', () => {
  it('D: cuadra (dentro de tolerancia)', () => {
    expect(clasificarDeudaCod({ deudaDesp: 0 })).toBe('D')
    expect(clasificarDeudaCod({ deudaDesp: 0.005, abonosSinVinculo: 0 })).toBe('D')
  })
  it('A: deuda fantasma real (el bug 3368)', () => {
    expect(clasificarDeudaCod({ deudaDesp: 174, abonosSinVinculo: 0 })).toBe('A')
  })
  it('B: abonos sin vínculo que cubren la deuda (falta aplicar)', () => {
    expect(clasificarDeudaCod({ deudaDesp: 100, abonosSinVinculo: 120 })).toBe('B')
    expect(clasificarDeudaCod({ deudaDesp: 100, abonosSinVinculo: 99.995 })).toBe('B')
  })
  it('C: parcial — algo sin aplicar y resto sin cobro', () => {
    expect(clasificarDeudaCod({ deudaDesp: 100, abonosSinVinculo: 50 })).toBe('C')
  })
})

describe('estadoCodDerivado (R2: nunca del flag)', () => {
  it('sin_cargo cuando no hay cargo COD', () => {
    expect(estadoCodDerivado({ tieneCargoCod: false })).toEqual({
      estado: 'sin_cargo', revisar: false, reembolsado: false,
    })
  })
  it('pendiente: hay deuda y nada aplicable', () => {
    const e = estadoCodDerivado({ deudaCargo: 100 })
    expect(e.estado).toBe('pendiente')
    expect(e.revisar).toBe(false)
  })
  it('pendiente con revisar=true si quedó algo sin aplicar (clase C parcial)', () => {
    const e = estadoCodDerivado({ deudaCargo: 100, abonosSinVinculo: 20 })
    expect(e.estado).toBe('pendiente')
    expect(e.revisar).toBe(true)
  })
  it('parcial: algo cobrado pero queda deuda', () => {
    const e = estadoCodDerivado({ deudaCargo: 50, cobradoUsd: 200, compensadoUsd: 0 })
    expect(e.estado).toBe('parcial')
  })
  it('manual_review: la deuda la cubren abonos sin vínculo (clase B)', () => {
    const e = estadoCodDerivado({ deudaCargo: 100, abonosSinVinculo: 150 })
    expect(e).toEqual({ estado: 'manual_review', revisar: true, reembolsado: false })
  })
  it('cobrado: deuda ≤ 0.01 y entró dinero real', () => {
    const e = estadoCodDerivado({ deudaCargo: 0, cobradoUsd: 174, compensadoUsd: 96 })
    expect(e.estado).toBe('cobrado')
    expect(e.revisar).toBe(false)
  })
  it('compensado: deuda cubierta solo con compensaciones (devolución/cruce/saldo a favor)', () => {
    const e = estadoCodDerivado({ deudaCargo: 0, cobradoUsd: 0, compensadoUsd: 96 })
    expect(e.estado).toBe('compensado')
    expect(e.revisar).toBe(false)
  })
  it('manual_review: flag pagado sin NINGÚN movimiento que lo respalde (bug D8)', () => {
    const e = estadoCodDerivado({ deudaCargo: 0, cobradoUsd: 0, compensadoUsd: 0 })
    expect(e).toEqual({ estado: 'manual_review', revisar: true, reembolsado: false })
  })
  it('propaga el reembolso', () => {
    const e = estadoCodDerivado({ tieneCargoCod: false, reembolsadoUsd: 50 })
    expect(e.reembolsado).toBe(true)
  })
})

describe('clasificarBucketItem (R4: semántica del motor SQL)', () => {
  it('préstamos quedan excluidos de comisión', () => {
    expect(clasificarBucketItem({ es_prestamo: true, nombre: 'Cabilla 3/4' })).toBe('excluido')
    expect(clasificarBucketItem({ esPrestamo: 1, nombre: 'x' })).toBe('excluido')
  })
  it('externos: origen externo o id manual-/ext-, menos corte (excluido)', () => {
    expect(clasificarBucketItem({ origen: 'externo', nombre: 'Alquiler grúa' })).toBe('externo')
    expect(clasificarBucketItem({ producto_id: 'manual-42', nombre: 'Tornillos' })).toBe('externo')
    expect(clasificarBucketItem({ productoId: 'ext-7', nombre: 'Flete' })).toBe('externo')
    expect(clasificarBucketItem({ origen: 'externo', nombre: 'Corte de varilla' })).toBe('excluido')
  })
  it('cabilla por categoría del producto o por nombre', () => {
    expect(clasificarBucketItem({ nombre: 'X' }, { categoria: 'CABILLA' })).toBe('cabilla')
    expect(clasificarBucketItem({ nombre_snap: 'Cabilla 3/4 Corrugada' })).toBe('cabilla')
  })
  it('el resto es otros, y la categoría configurable del ADR respeta config', () => {
    expect(clasificarBucketItem({ nombre: 'Flanche 2"' }, { categoria: 'Tubería' })).toBe('otros')
    expect(
      clasificarBucketItem({ nombre: 'Varilla x' }, { categoria: 'VARILLA' }, { comision_categoria_cabilla: 'varilla' }),
    ).toBe('cabilla')
  })
})

describe('comisionNetaPorBucket (R4: mercancía neta, clamp y redondeo por bucket)', () => {
  it('descuenta devoluciones por bucket e ignora excluidos', () => {
    const c = comisionNetaPorBucket({
      items: [
        { bucket: 'cabilla', monto: 100 },
        { bucket: 'otros', monto: 100 },
        { bucket: 'excluido', monto: 500 },
      ],
      devoluciones: [{ bucket: 'otros', monto: 20 }],
    })
    expect(c.bases).toEqual({ cabilla: 100, otros: 80, externo: 0 })
    expect(c.comisionCabilla).toBe(2)
    expect(c.comisionOtros).toBe(1.6)
    expect(c.total).toBe(3.6)
  })

  it('clamp ≥ 0 por bucket: una devolución mayor no genera comisión negativa', () => {
    const c = comisionNetaPorBucket({
      items: [{ bucket: 'cabilla', monto: 100 }],
      devoluciones: [{ bucket: 'cabilla', monto: 150 }],
    })
    expect(c.bases.cabilla).toBe(0)
    expect(c.comisionCabilla).toBe(0)
    expect(c.total).toBe(0)
  })

  it('los intercambios suman en su bucket, incluida cabilla', () => {
    const c = comisionNetaPorBucket({
      items: [
        { bucket: 'cabilla', monto: 100 },
        { bucket: 'otros', monto: 100 },
        { bucket: 'externo', monto: 40 },
      ],
      devoluciones: [
        { bucket: 'cabilla', monto: 20 },
        { bucket: 'otros', monto: 20 },
        { bucket: 'externo', monto: 10 },
      ],
      intercambios: [
        { bucket: 'cabilla', monto: 50 },
        { bucket: 'otros', monto: 50 },
        { bucket: 'externo', monto: 5 },
      ],
    })
    expect(c.bases).toEqual({ cabilla: 130, otros: 130, externo: 35 })
    expect(c.comisionCabilla).toBe(2.6)
    expect(c.comisionOtros).toBe(3.3)
  })

  it('la fracción escala (paridad con fraccion_no_cxc)', () => {
    const c = comisionNetaPorBucket({
      items: [{ bucket: 'cabilla', monto: 100 }, { bucket: 'otros', monto: 100 }],
      fraccion: 0.5,
    })
    expect(c.comisionCabilla).toBe(1)
    expect(c.comisionOtros).toBe(1)
    expect(c.total).toBe(2)
  })

  it('otros y externos se redondean JUNTOS (semántica del motor SQL)', () => {
    const c = comisionNetaPorBucket({
      items: [{ bucket: 'otros', monto: 2.51 }, { bucket: 'externo', monto: 2.51 }],
    })
    // 0.0502 + 0.0502 = 0.1004 → 0.10
    expect(c.comisionOtros).toBe(0.1)
    const c2 = comisionNetaPorBucket({
      items: [{ bucket: 'otros', monto: 2.51 }, { bucket: 'externo', monto: 5 }],
    })
    // 0.0502 + 0.10 = 0.1502 → 0.15
    expect(c2.comisionOtros).toBe(0.15)
  })

  it('pctExternos anula por separado', () => {
    const c = comisionNetaPorBucket({
      items: [{ bucket: 'otros', monto: 100 }, { bucket: 'externo', monto: 1000 }],
      pctExternos: 0,
    })
    expect(c.comisionOtros).toBe(2) // solo otros al 2%; externos al 0%
  })

  it('devoluciones e intercambios en buckets desconocidos o excluidos se ignoran', () => {
    const c = comisionNetaPorBucket({
      items: [{ bucket: 'otros', monto: 100 }],
      devoluciones: [{ bucket: 'excluido', monto: 50 }, { bucket: 'fantasma', monto: 50 }],
      intercambios: [{ bucket: 'excluido', monto: 50 }],
    })
    expect(c.bases.otros).toBe(100)
  })
})

describe('desfaseComision (I3)', () => {
  it('coincide dentro de tolerancia de $0.02', () => {
    expect(desfaseComision(61.22, 61.22)).toEqual({ coincide: true, delta: 0 })
    expect(desfaseComision(61.23, 61.22).coincide).toBe(true)
    expect(desfaseComision(61.21, 61.22).coincide).toBe(true)
    expect(desfaseComision(61.25, 61.22).coincide).toBe(false)
    expect(desfaseComision(63.14, 61.22)).toEqual({ coincide: false, delta: 1.92 })
  })
  it('acepta tolerancia propia', () => {
    expect(desfaseComision(61.3, 61.22, 0.5).coincide).toBe(true)
  })
})

describe('invarianteFlagVsLedger (I1)', () => {
  it('sin flag no exige nada', () => {
    expect(invarianteFlagVsLedger({ codPagado: false, deudaDesp: 999 }).estado).toBe('ok')
  })
  it('flag pagado y cuadrado → ok (3368 tras el cierre)', () => {
    expect(invarianteFlagVsLedger({ codPagado: true, deudaDesp: 0 }).estado).toBe('ok')
  })
  it('flag pagado con deuda fantasma → fail (3368 ANTES del cierre)', () => {
    const r = invarianteFlagVsLedger({ codPagado: true, deudaDesp: 174, abonosSinVinculo: 0 })
    expect(r.estado).toBe('fail')
  })
  it('flag pagado con abonos sin aplicar → warn', () => {
    const r = invarianteFlagVsLedger({ codPagado: true, deudaDesp: 50, abonosSinVinculo: 60 })
    expect(r.estado).toBe('warn')
  })
})

describe('invarianteSaldoVsReplay (I2)', () => {
  it('saldo denormalizado == replay → ok', () => {
    const replay = replayCliente(LEDGER_3368_DESPUES)
    const r = invarianteSaldoVsReplay({ saldoPendiente: 0, saldoAFavor: 0, replay })
    expect(r.ok).toBe(true)
    expect(r.deltaDeuda).toBe(0)
  })
  it('desfase de deuda o de saldo a favor → no ok, con delta medido', () => {
    const r = invarianteSaldoVsReplay({ saldoPendiente: 100, saldoAFavor: 5, replay: { deuda: 90, saldoAFavor: 0 } })
    expect(r.ok).toBe(false)
    expect(r.deltaDeuda).toBe(10)
    expect(r.deltaFavor).toBe(5)
  })
  it('replay negativo = excedente latente: saldo_pendiente 0 cuadra (caso Héctor/A_40)', () => {
    // producción: 16 clientes con replay negativo (abonos sin cargo en su cuenta)
    // y saldo_pendiente = 0 — no es deuda mal denormalizada
    const r = invarianteSaldoVsReplay({ saldoPendiente: 0, saldoAFavor: 0, replay: { deuda: -9.57, saldoAFavor: 0 } })
    expect(r.ok).toBe(true)
    expect(r.deltaDeuda).toBe(0)
  })
  it('acepta replay como número plano y omite saldoAFavor', () => {
    expect(invarianteSaldoVsReplay({ saldoPendiente: 42.5, replay: 42.5 }).ok).toBe(true)
  })
  it('respetó la tolerancia de un centavo', () => {
    expect(invarianteSaldoVsReplay({ saldoPendiente: 0.005, replay: 0 }).ok).toBe(true)
    expect(invarianteSaldoVsReplay({ saldoPendiente: 0.02, replay: 0 }).ok).toBe(false)
  })
})
