import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(new URL('../ConciliarCodModal.jsx', import.meta.url), 'utf8')
const currency = fs.readFileSync(new URL('../../../utils/codCurrency.js', import.meta.url), 'utf8')

describe('ConciliarCodModal — guardarraíles F2', () => {
  it('obtiene saldo y estado desde el RPC resumen servido por Worker', () => {
    expect(source).toContain('/api/despachos/resumen-financiero')
    expect(source).toContain('codLedger?.deuda_cod_usd')
    expect(source).toContain('resumen?.cod')
  })

  it('registra el cobro solo por la ruta atómica con nota opcional e idempotency key estable', () => {
    expect(source).toContain('/api/despachos/conciliar-cod')
    expect(source).toContain('idempotencyKey,')
    expect(source).toContain('evidencia: evidencia.trim()')
    expect(source).toContain('Nota (opcional)')
    expect(source).not.toContain('Evidencia del pago (obligatoria)')
    expect(source).toContain('.trim().length < 4')
    expect(source).toContain("new Set(['Efectivo $', 'Efectivo Bs'])")
  })

  it('convierte Bs con precisión decimal exacta compatible con el redondeo SQL', () => {
    expect(source).toContain('convertBsToUsd(pago.monto_bs, getTasaSnapshot(tasa))')
    expect(source).toContain("import { convertBsToUsd } from '../../utils/codCurrency.js'")
    expect(currency).toContain('BigInt')
    expect(currency).toContain('rateUnits / 2n')
  })

  it('mantiene cada snapshot confirmado al cambiar la tasa seleccionada', () => {
    expect(source).toContain('const getTasaPago = (pago, tasaActual) => Number(pago.tasa_snapshot) > 0 ? pago.tasa_snapshot : tasaActual')
    expect(source).toContain('tasa_snapshot: getTasaSnapshot(tasaPago)')
    expect(source).toContain('pagos: pagosConfirmados')
    expect(source).toContain('La conversión de este abono quedará fija.')
  })

  it('permite hasta un centavo de exceso, pero deja parcial cualquier saldo pendiente', () => {
    expect(source).toContain('const coincide = diferencia >= 0 && diferencia <= 0.01')
    expect(source).toContain('diferencia <= 0.01')
    expect(source).toContain('Liquida COD · excede ${formatUsd(excedente)}')
  })

  it('limita a dos decimales los montos y muestra el motivo si no se cumple', () => {
    expect(source).toContain('hasMaxTwoDecimals')
    expect(source).toContain('Usa máximo dos decimales')
  })

  it('ya no inserta abonos de forma fragmentada ni ofrece el bypass sin asiento', () => {
    expect(source).not.toContain('useRegistrarAbono')
    expect(source).not.toContain('handleConfirmarSinAbono')
    expect(source).not.toContain('codSinAbono')
    expect(source).not.toContain('Marcar como pagado (ya recibido)')
  })

  it('no infiere si el COD se puede cobrar comparando monto nominal con saldo global del cliente', () => {
    expect(source).not.toContain('codExcedeSaldo')
    expect(source).not.toContain('saldoCliente')
  })
})

describe('ConciliarCodModal — pago mixto (release 19)', () => {
  it('muestra las dos porciones del pedido: COD cobrable aquí y crédito en CxC', () => {
    expect(source).toContain('cargo_cxc_usd')
    expect(source).toContain('deuda_cxc_usd')
    expect(source).toContain('Parte COD · se cobra aquí')
    expect(source).toContain('Parte a crédito · se cobra en CxC')
    expect(source).toContain('Desde la ficha del cliente')
  })

  it('explica el motivo concreto cuando el estado requiere revisión', () => {
    expect(source).toContain('MOTIVOS_REVISION')
    expect(source).toContain('motivo_revision')
    expect(source).toContain('atribucion_ambigua')
    expect(source).toContain('flag_sin_respaldo')
  })

  it('hace visible el desborde sin marca cuando existe', () => {
    expect(source).toContain('desborde_sin_marca_usd')
    expect(source).toContain('desborde sin marca')
  })
})
