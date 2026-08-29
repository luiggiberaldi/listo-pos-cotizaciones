import { describe, expect, it } from 'vitest'
import { auditKardex } from '../../../scripts/audit-kardex-staging.mjs'
import { evaluateKardexReport } from '../../../scripts/monitor-kardex-staging.mjs'

const product = { id: 'p-1', codigo: 'TEST-001', nombre: 'Producto test', stock_actual: 145, cuenta_id: 'c-1', activo: true }

function movement(overrides = {}) {
  return {
    id: `m-${Math.random()}`,
    numero: 1,
    lote_id: 'l-1',
    producto_id: 'p-1',
    producto_nombre: 'Producto test',
    tipo: 'ingreso',
    cantidad: 100,
    stock_anterior: 0,
    stock_nuevo: 100,
    motivo: 'Compra proveedor',
    motivo_tipo: 'compra_proveedor',
    usuario_id: 'u-1',
    usuario_nombre: 'Operador',
    cuenta_id: 'c-1',
    origen_tipo: 'compra',
    origen_id: 'l-1',
    origen_referencia: 'batch_ingest:1',
    idempotency_key: 'k-1',
    creado_en: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('auditKardex', () => {
  it('no reporta una cadena matemática y temporalmente continua', () => {
    const report = auditKardex(
      [{ ...product, stock_actual: 95 }],
      [
        movement(),
        movement({ id: 'm-2', numero: 2, tipo: 'egreso', cantidad: 5, stock_anterior: 100, stock_nuevo: 95, creado_en: '2026-01-02T00:00:00.000Z', origen_type: 'despacho', origen_id: 'd-1', idempotency_key: 'k-2' }),
      ],
    )

    expect(report.anomalies_total).toBe(0)
    expect(report.products_with_anomalies).toBe(0)
  })

  it('identifica el salto 151 → 391 antes de un egreso de 6', () => {
    const report = auditKardex(
      [{ ...product, stock_actual: 385 }],
      [
        movement({ id: 'm-1', numero: 1, tipo: 'ingreso', cantidad: 151, stock_nuevo: 151 }),
        movement({ id: 'm-2', numero: 2, tipo: 'egreso', cantidad: 6, stock_anterior: 391, stock_nuevo: 385, creado_en: '2026-01-02T00:00:00.000Z', motivo: 'Entrega confirmada — Despacho #1601', motivo_tipo: 'venta' }),
      ],
    )

    expect(report.products_with_anomalies).toBe(1)
    expect(report.summary_by_reason['venta/despacho']).toBe(1)
    expect(report.anomalies[0].continuity_delta).toBe(240)
    expect(report.anomalies[0].internal_math_error).toBe(false)
  })

  it('separa error interno de movimiento y divergencia del catálogo', () => {
    const report = auditKardex(
      [{ ...product, stock_actual: 120 }],
      [
        movement({ id: 'm-1', numero: 1, cantidad: 10, stock_nuevo: 11 }),
        movement({ id: 'm-2', numero: 2, tipo: 'egreso', cantidad: 1, stock_anterior: 11, stock_nuevo: 10, creado_en: '2026-01-02T00:00:00.000Z' }),
      ],
    )

    expect(report.summary_by_reason.stock_actual_vs_kardex).toBe(1)
    expect(report.anomalies.some(anomaly => anomaly.internal_math_error)).toBe(true)
  })

  it('marca la falta de trazabilidad mínima', () => {
    const report = auditKardex(
      [{ ...product, stock_actual: 100 }],
      [movement({ cuenta_id: null, usuario_id: null, usuario_nombre: null, motivo: null, motivo_tipo: null })],
    )

    expect(report.anomalies_total).toBe(1)
    expect(report.anomalies[0].missing_provenance).toBe(true)
  })

  it('reporta deuda de provenance estructurado sin inventar una anomalía de stock', () => {
    const report = auditKardex(
      [{ ...product, stock_actual: 100 }],
      [movement({ origen_tipo: null, origen_id: null, idempotency_key: null })],
    )

    expect(report.anomalies_total).toBe(0)
    expect(report.movements_missing_structured_provenance).toBe(1)
    expect(report.products[0].structured_provenance_missing).toBe(1)
  })

  it('ordena timestamps con microsegundos antes de aplicar el correlativo', () => {
    const report = auditKardex(
      [{ ...product, stock_actual: 105 }],
      [
        movement({ id: 'm-anchor', numero: 2, tipo: 'egreso', cantidad: 5, stock_anterior: 110, stock_nuevo: 105, creado_en: '2026-01-01T00:00:00.000001Z' }),
        movement({ id: 'm-compensation', numero: 999, cantidad: 10, stock_anterior: 100, stock_nuevo: 110, creado_en: '2026-01-01T00:00:00.000000Z' }),
      ],
    )

    expect(report.anomalies_total).toBe(0)
  })
})

describe('evaluateKardexReport', () => {
  it('aprueba únicamente un reporte sano del proyecto staging', () => {
    const result = evaluateKardexReport({
      project_ref: 'spupqgkdsgohxxfoxydl',
      read_only: true,
      anomalies_total: 0,
      products_with_anomalies: 0,
      movements_missing_structured_provenance: 0,
      products_scanned: 10,
      movements_scanned: 20,
    })

    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('rechaza anomalías, provenance incompleto o una ref que no sea staging', () => {
    const result = evaluateKardexReport({
      project_ref: 'proyecto-no-autorizado',
      read_only: true,
      anomalies_total: 1,
      products_with_anomalies: 1,
      movements_missing_structured_provenance: 2,
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toEqual([
      'project_ref',
      'anomalies',
      'products_with_anomalies',
      'structured_provenance',
    ])
  })
})
