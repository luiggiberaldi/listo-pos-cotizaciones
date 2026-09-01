import { describe, expect, it } from 'vitest'
import {
  calcularResumenComisionesGeneradas,
  expandCommissionRows,
  formatCommissionPeriod,
  generarComisionesPDF,
  normalizarComisionGenerada,
} from '../../services/pdf/comisionesGeneradasPDF'

const RATE = 916.01
const CONFIG = {
  nombre_negocio: 'Construacero Carabobo C.A.',
  comision_categoria_cabilla: 'Cabilla',
}

function product({ name, code, total, category = 'OTROS', loan = false }) {
  return {
    nombre_snap: name,
    codigo_snap: code,
    total_linea_usd: total,
    es_prestamo: loan,
    producto: { categoria: category },
  }
}

function event({ id, sellerId, sellerName, total, cabilla, otros, number, products, payment, clientName = 'Transporte Monra C.A.' }) {
  return {
    id,
    monto: total,
    tipo: 'generada',
    creado_en: '2026-08-21T21:00:17.4896+00:00',
    vendedor: {
      id: sellerId,
      nombre: sellerName,
      color: sellerId === 'seller-1' ? '#CA8A04' : '#0EA5E9',
      es_externo: false,
    },
    comisiones: {
      id,
      totalcomision: total,
      comisioncabilla: cabilla,
      comisionotros: otros,
      pctcabilla: 2,
      pctotros: 2,
      estado: 'generada',
      despacho: {
        numero: number,
        total_usd: 766.02,
        creado_en: '2026-08-20T21:05:17.534Z',
        cliente_nombre: clientName,
        forma_pago_cliente: payment || '[{"metodo":"Transf. / Pago Móvil","monto":766.02}]',
        productos: products,
      },
    },
  }
}

const baseProducts = [
  product({ name: 'CABILLA ESTRIADA 10 mm', code: 'CAB0114005', total: 184, category: 'CABILLAS' }),
  product({ name: 'ZUNCHO 12 X 12', code: 'ZUN0140013', total: 34.5 }),
  product({ name: 'ALAMBRE GALVANIZADO', code: 'ALA0403001', total: 13.52 }),
  product({ name: 'CEMENTO GRIS ENSACADO', code: 'CEM1045001', total: 534, category: 'CEMENTO' }),
]

function makeRows(count = 58) {
  return Array.from({ length: count }, (_, index) => event({
    id: `commission-${index}`,
    sellerId: index % 2 === 0 ? 'seller-1' : 'seller-2',
    sellerName: index % 2 === 0 ? 'Niki Ramirez' : 'Edgar Ramirez',
    total: 15.32,
    cabilla: 3.68,
    otros: 11.64,
    number: 2548 + index,
    products: baseProducts,
  }))
}

describe('comisionesGeneradasPDF', () => {
  it('prioriza cliente_nombre del despacho y normaliza nombres largos', () => {
    const normalized = normalizarComisionGenerada(event({
      id: 'client-field',
      sellerId: 'seller-1',
      sellerName: 'Niki Ramirez',
      total: 10,
      cabilla: 2,
      otros: 8,
      number: 2548,
      products: [],
      clientName: 'Transporte Monra C.A. de Carabobo',
    }))

    expect(normalized.clienteNombre).toBe('TRANSPORTE MONRA C.A. DE CARABOBO')
  })

  it('usa la fecha del despacho y muestra el rango explícito del corte', () => {
    const normalized = normalizarComisionGenerada(event({
      id: 'dispatch-date',
      sellerId: 'seller-1',
      sellerName: 'Niki Ramirez',
      total: 10,
      cabilla: 2,
      otros: 8,
      number: 2548,
      products: [],
    }))

    expect(normalized.fechaDespacho).toBe('2026-08-20T21:05:17.534Z')
    expect(formatCommissionPeriod({ from: '2026-08-14', to: '2026-08-20' }))
      .toBe('Período: 14/08/2026 al 20/08/2026 · Base: fecha del despacho')
  })

  it('excluye CxC solo de filas legacy y no vuelve a prorratear filas generadas', () => {
    const legacy = normalizarComisionGenerada({
      id: 'legacy-mixto',
      totalcomision: 10,
      estado: 'pendiente',
      vendedor: { id: 'seller-1', nombre: 'Niki Ramirez' },
      despacho: {
        total_usd: 100,
        forma_pago_cliente: '[{"metodo":"Cta por cobrar","monto":40},{"metodo":"Efectivo $","monto":60}]',
      },
    })
    const generated = normalizarComisionGenerada(event({
      id: 'generated-mixto',
      sellerId: 'seller-1',
      sellerName: 'Niki Ramirez',
      total: 10,
      cabilla: 2,
      otros: 8,
      number: 3000,
      products: [],
      payment: '[{"metodo":"Cta por cobrar","monto":40},{"metodo":"Efectivo $","monto":60}]',
    }))

    expect(legacy.totalcomision).toBe(6)
    expect(legacy.legacyScaledBy).toBeCloseTo(0.6)
    expect(generated.totalcomision).toBe(10)
  })

  it('excluye donaciones, prestamos y productos de corte', () => {
    const loan = normalizarComisionGenerada(event({
      id: 'loan',
      sellerId: 'seller-1',
      sellerName: 'Niki Ramirez',
      total: 12,
      cabilla: 4,
      otros: 8,
      number: 4000,
      products: [product({ name: 'MATERIAL EN PRESTAMO', code: 'PRESTAMO', total: 100, loan: true })],
      payment: '[{"metodo":"Prestamo","monto":100}]',
    }))
    const donation = normalizarComisionGenerada(event({
      id: 'donation',
      sellerId: 'seller-1',
      sellerName: 'Niki Ramirez',
      total: 12,
      cabilla: 4,
      otros: 8,
      number: 4001,
      products: [product({ name: 'MATERIAL DONADO', code: 'DONACION', total: 100 })],
      payment: '[{"metodo":"Donacion","monto":100}]',
    }))

    expect(loan.totalcomision).toBe(0)
    expect(donation.totalcomision).toBe(0)
    expect(expandCommissionRows([loan], { config: CONFIG })).toEqual([])
    expect(expandCommissionRows([donation], { config: CONFIG })).toEqual([])
  })

  it('mantiene la formula del resumen: generada + CxC manual - descuento carro', () => {
    const rows = makeRows(2).map(row => normalizarComisionGenerada(row, { rate: RATE }))
    const summary = calcularResumenComisionesGeneradas(rows, {
      'seller-1': { cxc: '5.50', descuentoCarro: '1.25' },
      'seller-2': { cxc: '2.00', descuentoCarro: '0.50' },
    }, RATE)

    expect(summary.totalGeneradoUsd).toBe(30.64)
    expect(summary.totalCxcManualUsd).toBe(7.5)
    expect(summary.totalDescuentoCarroUsd).toBe(1.75)
    expect(summary.totalPagarUsd).toBe(36.39)
    expect(summary.totalPagarBs).toBeCloseTo(33333.6039, 2)
  })

  it.each([
    ['general detallado', { vendedor: null, formato: 'detallado', modoCorteSemanal: true, count: 58 }],
    ['individual detallado', { vendedor: { id: 'seller-1', nombre: 'Niki Ramirez', color: '#CA8A04' }, formato: 'detallado', modoCorteSemanal: true, count: 58 }],
    ['general resumido', { vendedor: null, formato: 'resumido', modoCorteSemanal: false, count: 4 }],
    ['individual resumido', { vendedor: { id: 'seller-1', nombre: 'Niki Ramirez', color: '#CA8A04' }, formato: 'resumido', modoCorteSemanal: false, count: 4 }],
  ])('genera PDF %s sin error de coordenadas ni overflow de columnas', async (_label, options) => {
    const rows = makeRows(options.count)
    const filteredRows = options.vendedor
      ? rows.filter(row => row.vendedor.id === options.vendedor.id)
      : rows
    const doc = await generarComisionesPDF({
      comisiones: filteredRows,
      vendedor: options.vendedor,
      config: CONFIG,
      rango: { from: '2026-08-01', to: '2026-08-22' },
      action: 'return',
      formato: options.formato,
      tasaAplicada: RATE,
      tipoTasa: 'Euro BCV',
      ajustesManuales: {
        'seller-1': { cxc: '5', descuentoCarro: '1' },
      },
      modoCorteSemanal: options.modoCorteSemanal,
    })

    expect(doc).toBeTruthy()
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1)
    if (options.modoCorteSemanal) {
      expect(doc.internal.getNumberOfPages()).toBeGreaterThan(1)
    }
  })

  it('normaliza y preserva el codigo del vendedor para mostrarlo en el PDF', () => {
    const normalized = normalizarComisionGenerada({
      id: 'test-codigo',
      totalcomision: 15,
      estado: 'generada',
      vendedor: { id: 'seller-1', nombre: 'Edgar Ramirez', color: '#16A34A', codigo: 'V-01' },
      despacho: { total_usd: 100 },
    })

    expect(normalized.vendedor.codigo).toBe('V-01')
    expect(normalized.vendedor.nombre).toBe('Edgar Ramirez')
  })
})
