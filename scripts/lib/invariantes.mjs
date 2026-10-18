/**
 * Lógica PURA de las invariantes contables (R1–R5) — sin E/s, sin I/O.
 *
 * La usan: scripts/guardas-invariantes-readonly.mjs (detective), los auditores
 * read-only y los arneses. Los tests la fijan con el caso real DES-03368.
 *
 * Reglas duras (ver ADR/plan 2026-09-24):
 *  · R1 el ledger manda; el flag del COD y los saldos denormalizados son derivados
 *  · R2 estado del COD se DERIVA del ledger, nunca de un booleano
 *  · R4 la comisión se calcula sobre mercancía NETA por bucket (cabilla/otros/externos)
 *
 * Semántica del ledger (verificada contra producción 24-sep-2026):
 *  · tipo='credito'            → otorga saldo a favor
 *  · tipo='devolucion_credito' → reversa un crédito
 *  · abono forma 'Saldo a favor' → CONSUME el crédito (y paga el despacho)
 *  · saldo_a_favor = créditos − devoluciones_crédito − consumos
 */

export const TOLERANCIA_USD = 0.01
export const TOLERANCIA_COMISION = 0.02

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

/** ¿Un abono consume saldo a favor (pago con CRÉDITO)? */
export function esConsumoSaldoFavor(forma) {
  return String(forma ?? '').toLowerCase().includes('saldo a favor')
}

/** ¿Una forma de pago de abono es COMPENSACIÓN (no dinero entrado)? */
export function esCompensacionForma(forma) {
  const s = String(forma ?? '').toLowerCase()
  return s.includes('devoluci') || s.includes('cruce') || s.includes('compensa') || s.includes('saldo a favor')
}

/**
 * Replay del ledger del cliente desde sus filas de cuentas_por_cobrar.
 * Filas: { tipo: 'cargo'|'abono'|'credito'|'devolucion_credito', monto_usd,
 *          forma_pago_abono, despacho_id }
 */
export function replayCliente(filas = []) {
  let cargo = 0
  let abono = 0
  let credito = 0
  let devolucionCredito = 0
  let abonosSinVinculo = 0
  let cobradoUsd = 0
  let compensadoUsd = 0
  let consumoSaldoFavor = 0
  for (const f of filas) {
    const monto = Math.abs(Number(f.monto_usd) || 0)
    if (f.tipo === 'cargo') cargo += monto
    else if (f.tipo === 'abono') {
      abono += monto
      if (!f.despacho_id) abonosSinVinculo += monto
      if (esConsumoSaldoFavor(f.forma_pago_abono)) consumoSaldoFavor += monto
      if (esCompensacionForma(f.forma_pago_abono)) compensadoUsd += monto
      else if (f.despacho_id) cobradoUsd += monto
    } else if (f.tipo === 'credito') credito += monto
    else if (f.tipo === 'devolucion_credito') devolucionCredito += monto
  }
  return {
    deuda: round2(cargo - abono),
    cargo: round2(cargo),
    abono: round2(abono),
    credito: round2(credito),
    devolucionCredito: round2(devolucionCredito),
    abonosSinVinculo: round2(abonosSinVinculo),
    cobradoUsd: round2(cobradoUsd),
    compensadoUsd: round2(compensadoUsd),
    consumoSaldoFavor: round2(consumoSaldoFavor),
    // modelo verificado: los abonos "Saldo a favor" CONSUMEN el crédito
    saldoAFavor: round2(credito - devolucionCredito - consumoSaldoFavor),
  }
}

/**
 * Clasificación de un "COD marcado como pagado" que aún muestra deuda por despacho:
 *   A · sin registro de cobro (deuda fantasma real) → manual_review
 *   B · abonos sin vínculo que cubren la deuda (falta aplicar) → atribución
 *   C · parcial (algo sin aplicar + resto sin cobro) → manual_review
 *   D · cuadra
 */
export function clasificarDeudaCod({ deudaDesp = 0, abonosSinVinculo = 0 } = {}) {
  if (deudaDesp <= TOLERANCIA_USD) return 'D'
  if (abonosSinVinculo <= TOLERANCIA_USD) return 'A'
  if (abonosSinVinculo + TOLERANCIA_USD >= deudaDesp) return 'B'
  return 'C'
}

/**
 * Estado del COD DERIVADO del ledger (R2). Nunca del flag.
 * Devuelve { estado, revisar, reembolsado }.
 *   sin_cargo | pendiente | parcial | cobrado | compensado | manual_review
 */
export function estadoCodDerivado({
  tieneCargoCod = true,
  deudaCargo = 0,
  cobradoUsd = 0,
  compensadoUsd = 0,
  abonosSinVinculo = 0,
  reembolsadoUsd = 0,
} = {}) {
  const reembolsado = Number(reembolsadoUsd) > TOLERANCIA_USD
  if (!tieneCargoCod) return { estado: 'sin_cargo', revisar: false, reembolsado }
  if (deudaCargo > TOLERANCIA_USD) {
    if (cobradoUsd > TOLERANCIA_USD) return { estado: 'parcial', revisar: false, reembolsado }
    if (abonosSinVinculo + TOLERANCIA_USD >= deudaCargo) return { estado: 'manual_review', revisar: true, reembolsado }
    return { estado: 'pendiente', revisar: abonosSinVinculo > TOLERANCIA_USD, reembolsado }
  }
  if (cobradoUsd > TOLERANCIA_USD) return { estado: 'cobrado', revisar: false, reembolsado }
  if (compensadoUsd > TOLERANCIA_USD) return { estado: 'compensado', revisar: false, reembolsado }
  return { estado: 'manual_review', revisar: true, reembolsado }
}

/**
 * Clasificación de un ítem al bucket de comisión (misma semántica que el motor SQL
 * y que comision_238b_item_breakdown): cabilla | otros | externo | excluido.
 */
export function clasificarBucketItem(item = {}, producto = {}, config = {}) {
  const catCabilla = String(config.comision_categoria_cabilla || 'cabilla').trim().toLowerCase()
  const nombre = String(item.nombre_snap || item.nombreSnap || item.nombre || '').toLowerCase()
  const origen = String(item.origen || 'inventario').trim().toLowerCase()
  const prodId = String(item.producto_id || item.productoId || '')
  const cat = String(producto?.categoria || item.categoria || '').trim().toLowerCase()
  if (item.es_prestamo || item.esPrestamo) return 'excluido'
  if (origen === 'externo' || prodId.startsWith('manual-') || prodId.startsWith('ext-')) {
    return nombre.includes('corte') ? 'excluido' : 'externo'
  }
  if (cat === catCabilla || nombre.includes(catCabilla)) return 'cabilla'
  return 'otros'
}

/**
 * Comisión 238b sobre mercancía NETA por bucket (R4 / Release 14).
 * items/devoluciones/intercambios: [{ bucket: 'cabilla'|'otros'|'externo', monto }]
 *   · devoluciones y porciones 'excluido' se descuentan/ignoran
 *   · intercambios suman en su bucket
 *   · clamp ≥ 0 por bucket
 *   · redondeo por bucket (cabilla aparte; otros+externos juntos), como el motor SQL
 */
export function comisionNetaPorBucket({
  items = [],
  devoluciones = [],
  intercambios = [],
  pctCabilla = 2,
  pctOtros = 2,
  pctExternos = null,
  fraccion = 1,
} = {}) {
  const sumar = (arr) => arr.reduce((acc, x) => {
    if (x.bucket === 'excluido' || !(x.bucket in acc)) return acc
    acc[x.bucket] += Math.abs(Number(x.monto) || 0)
    return acc
  }, { cabilla: 0, otros: 0, externo: 0 })

  const brutas = sumar(items)
  const dev = sumar(devoluciones)
  const inter = sumar(intercambios)
  const netas = {
    cabilla: Math.max(0, round2(brutas.cabilla - dev.cabilla + inter.cabilla)),
    otros: Math.max(0, round2(brutas.otros - dev.otros + inter.otros)),
    externo: Math.max(0, round2(brutas.externo - dev.externo + inter.externo)),
  }
  const pctExt = Number(pctExternos ?? pctOtros)
  const comisionCabilla = round2(netas.cabilla * Number(pctCabilla) / 100 * fraccion)
  const comisionOtros = round2(
    (netas.otros * Number(pctOtros) / 100 + netas.externo * pctExt / 100) * fraccion,
  )
  const bruta = round2(
    brutas.cabilla * Number(pctCabilla) / 100 * fraccion
    + (brutas.otros * Number(pctOtros) / 100 + brutas.externo * pctExt / 100) * fraccion,
  )
  return {
    bases: netas,
    basesBrutas: brutas,
    devoluciones: dev,
    intercambios: inter,
    comisionCabilla,
    comisionOtros,
    total: round2(comisionCabilla + comisionOtros),
    totalBruta: bruta,
  }
}

/** I3: ¿la comisión almacenada coincide con la esperada? */
export function desfaseComision(almacenada, esperada, tolerancia = TOLERANCIA_COMISION) {
  const delta = round2(Number(almacenada) - Number(esperada))
  return { coincide: Math.abs(delta) <= tolerancia, delta }
}

/** I1: flag "cobrado" vs ledger del despacho. */
export function invarianteFlagVsLedger({ codPagado = false, deudaDesp = 0, abonosSinVinculo = 0 } = {}) {
  if (!codPagado) return { estado: 'ok', detalle: 'COD sin marcar pagado' }
  const clase = clasificarDeudaCod({ deudaDesp, abonosSinVinculo })
  if (clase === 'D') return { estado: 'ok', detalle: 'COD pagado y cuadrado' }
  if (clase === 'A') return { estado: 'fail', detalle: `deuda fantasma real ${deudaDesp} sin abono aplicable` }
  return { estado: 'warn', detalle: `clase ${clase}: cobrado sin aplicar (abonos sin vínculo ${abonosSinVinculo})` }
}

/**
 * I2: saldos denormalizados vs replay del ledger.
 * Convención del modelo: saldo_pendiente nunca es negativo — un replay deuda
 * negativo es excedente latente (o cargos facturados a otra cuenta de cliente)
 * y se reporta aparte; saldo_a_favor = crédito − devolución_crédito − consumos.
 */
export function invarianteSaldoVsReplay({ saldoPendiente, saldoAFavor, replay }, tolerancia = TOLERANCIA_USD) {
  const replayDeuda = Math.max(0, Number(replay?.deuda ?? replay) || 0)
  const replayFavor = Number(replay?.saldoAFavor ?? 0) || 0
  const okDeuda = Math.abs(Number(saldoPendiente) - replayDeuda) <= tolerancia
  const okFavor = saldoAFavor == null || Math.abs(Number(saldoAFavor) - replayFavor) <= tolerancia
  return {
    ok: okDeuda && okFavor,
    deltaDeuda: round2(Number(saldoPendiente) - replayDeuda),
    deltaFavor: saldoAFavor == null ? 0 : round2(Number(saldoAFavor) - replayFavor),
  }
}
