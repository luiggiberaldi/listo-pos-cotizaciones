import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../pdf/pdfLogo', () => ({ cargarLogo: vi.fn(async () => null) }))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal()
  class JsPdfEspia extends mod.jsPDF {
    constructor(...a) {
      super(...a)
      const originalText = this.text
      this.text = (t, ...r) => {
        ;(globalThis.__f3Textos ||= []).push(Array.isArray(t) ? t.join(' ') : String(t))
        return originalText.call(this, t, ...r)
      }
      this.save = (name) => {
        globalThis.__f3Nombre = name
        return this
      }
    }
  }
  return { ...mod, jsPDF: JsPdfEspia }
})

import { generarReporteVentasPDF } from '../pdf/comisionesPDF'
import { generarComisionesPDF, expandCommissionRows } from '../pdf/comisionesGeneradasPDF'
import { generarReporteVendedoresPDF } from '../pdf/reporteVendedoresPDF'
import { generarReporteCxCPDF } from '../pdf/cxcPDF'
import { generarArticulosExternosPDF } from '../pdf/articulosExternosPDF'
import { construirVentasDia } from '../../utils/ventasDia'
import { construirReportePeriodoCxC } from '../../utils/cxcPeriodReport'

describe('OP-2026-101 Fase 3: exactitud de reportes financieros y CxC', () => {
  beforeEach(() => {
    globalThis.__f3Textos = []
    globalThis.__f3Nombre = ''
  })

  it('3.1 Reporte de Ventas: descuenta Saldo a Favor (case-insensitive) en Caja Real y usa nuevo título de créditos del período', async () => {
    await generarReporteVentasPDF({
      reporte: {
        tipoFiltro: 'internos',
        kpis: { totalVentas: 1000, totalFlete: 0, numDespachos: 1, ticketPromedio: 1000, totalComisiones: 20, totalDevoluciones: 0 },
        porVendedor: [{ id: 'v1', vendedor: 'JUAN', count: 1, totalUsd: 1000, comision: 20 }],
        porFormaPago: [
          { formaPago: 'Zelle', count: 1, totalUsd: 700, pagos: [] },
          { formaPago: 'Saldo a Favor', count: 1, totalUsd: 100, pagos: [] },
          { formaPago: 'Cta por cobrar', count: 1, totalUsd: 200, pagos: [] },
        ],
        despachos: [{ despacho_id: 'd1', despacho_numero: 10, asesor_id: 'v1', cliente_nombre: 'CLI', venta_neta_usd: 1000 }],
      },
      rango: { from: '2026-11-01', to: '2026-11-27' },
      config: { nombre_negocio: 'CONSTRUACERO' },
      cxcData: {
        kpis: { totalDeuda: 200 },
        clientesConDeuda: [{ id: 'c1', nombre: 'CLI', vendedor: { id: 'v1', nombre: 'JUAN' }, monto_otorgado: 200, monto_cobrado: 0, saldo_pendiente: 200 }],
        abonos: [],
      },
    })

    const textos = globalThis.__f3Textos.join(' | ')
    expect(textos).toContain('Créditos otorgados en el período (saldos pendientes)')
    expect(textos).toContain('CxC, COD y Saldo a Favor:')
    // 1000 - (200 + 100) = 700,00
    expect(textos).toContain('$700,00')
  })

  it('3.2 Comisiones: tipoVendedor aparece en título y archivo, y bucket sin ítems no pierde comisión', async () => {
    const expanded = expandCommissionRows([
      {
        id: 'com-1',
        totalcomision: 50,
        comisioncabilla: 20,
        comisionotros: 30,
        pctcabilla: 2,
        pctotros: 3,
        vendedor: { id: 'v1', nombre: 'ANA', es_externo: false },
        despacho: {
          numero: 99,
          totalusd: 1000,
          productos: [{ nombre_snap: 'TUBO 2X1', categoria: 'TUBOS', total_linea_usd: 1000 }], // solo 'otros', 0 'cabilla'
        },
      },
    ], { rate: 60, config: {} })

    const sumaExpanded = expanded.reduce((s, r) => s + Number(r.totalcomision || 0), 0)
    expect(sumaExpanded).toBeCloseTo(50, 2)
    expect(expanded.some(r => r.descripcion.includes('SIN ARTÍCULOS CLASIFICADOS'))).toBe(true)

    await generarComisionesPDF({
      comisiones: [{
        id: 'com-1',
        totalcomision: 50,
        comisioncabilla: 0,
        comisionotros: 50,
        vendedor: { id: 'v1', nombre: 'ANA', es_externo: false },
        despacho: { numero: 99, totalusd: 1000, productos: [{ nombre_snap: 'TUBO', total_linea_usd: 1000 }] },
      }],
      tipoVendedor: 'internos',
      rango: { from: '2026-11-01', to: '2026-11-27' },
      tasaAplicada: 60,
      formato: 'resumido',
    })

    expect(globalThis.__f3Textos.join(' ')).toContain('(Internos)')
    expect(globalThis.__f3Nombre).toContain('Internos')
  })

  it('3.3 Reporte Vendedores: conserva signo menos (-) en variaciones negativas', async () => {
    await generarReporteVendedoresPDF({
      data: {
        kpis: { totalUsd: 800, numDespachos: 2, ticketPromedio: 400, comisionTotal: 16, variacionUsd: -20 },
        porVendedor: [{
          id: 'v1',
          nombre: 'MARIA',
          codigo: 'V-MAR',
          color: '#1B365D',
          totalUsd: 800,
          prevTotalUsd: 1000,
          variacionUsd: -20,
          numDespachos: 2,
          ticketPromedio: 400,
          tasaCierre: 50,
          comisionTotal: 16,
          comisionGenerada: 16,
          comisionCabilla2: 10,
          comisionCabilla3: 0,
          comisionOtros: 6,
          cotizaciones: { borrador: 0, enviada: 1, aceptada: 1, rechazada: 0, anulada: 0, total: 2 },
          topClientes: [],
          topProductos: [],
          historial: [],
        }],
      },
      config: { nombre_negocio: 'CONSTRUACERO' },
      periodo: { from: '2026-11-01', to: '2026-11-27' },
      tipo: 'general',
    })

    const textos = globalThis.__f3Textos.join(' | ')
    expect(textos).toContain('-20.0% vs periodo anterior')
  })

  it('3.4 CxC PDF y cxcPeriodReport: vencimiento contra rango.to, rango en header, [PERSONAL], TOTAL cobranza y pagado de más', async () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [
        { id: 'c1', nombre: 'EMP UNO', tipo_cliente: 'personal', saldo_pendiente: 100 },
        { id: 'c2', nombre: 'CLI MAYOR', tipo_cliente: 'comercial', saldo_pendiente: 500 },
        { id: 'c3', nombre: 'CLI EXCESO', tipo_cliente: 'comercial', saldo_pendiente: 0 },
      ],
      transacciones: [
        { id: 't1', cliente_id: 'c1', tipo: 'cargo', monto_usd: 100, creado_en: '2026-10-01T15:00:00Z', fecha_vencimiento: '2026-10-15' },
        { id: 't2', cliente_id: 'c2', tipo: 'cargo', monto_usd: 500, creado_en: '2026-10-02T15:00:00Z', fecha_vencimiento: '2026-11-10' },
        { id: 't3', cliente_id: 'c3', tipo: 'cargo', monto_usd: 50, creado_en: '2026-10-02T15:00:00Z' },
        { id: 't4', cliente_id: 'c3', tipo: 'abono', monto_usd: 80, creado_en: '2026-10-05T15:00:00Z', forma_pago_abono: [{ metodo: 'Zelle', monto: 80 }] },
      ],
      rango: { from: '2026-10-01', to: '2026-10-31' },
    })

    // Ordenado descendente por saldo_pendiente
    expect(reporte.clientesConDeuda.map(c => c.id)).toEqual(['c2', 'c1'])
    // Pagado de más detectado (OP-062 N25)
    expect(reporte.clientesPagadoDeMas).toHaveLength(1)
    expect(reporte.clientesPagadoDeMas[0].pagadoDeMas).toBe(30)

    await generarReporteCxCPDF({
      data: reporte,
      config: { nombre_negocio: 'CONSTRUACERO' },
      tipo: 'detallado',
      rango: { from: '2026-10-01', to: '2026-10-31' },
    })

    const textos = globalThis.__f3Textos.join(' | ')
    // Al corte 2026-10-31: 2026-10-15 lleva 16 días vencido y 2026-11-10 vence en 10 días (NO contra hoy)
    expect(textos).toContain('Vencido hace 16 días')
    expect(textos).toContain('Vence en 10 días')
    expect(textos).toContain('[PERSONAL]')
    expect(textos).toContain('RESUMEN DEL PERÍODO:')
    expect(textos).toContain('TOTAL COBRANZA')
    expect(globalThis.__f3Nombre).toBe('Reporte_CxC_DETALLADO_2026-10-01_2026-10-31.pdf')
  })

  it('3.5 Externos muestra filtro y código; Ventas del día acredita COD pagado en cobradoUsd', async () => {
    await generarArticulosExternosPDF({
      items: [{
        fecha: '2026-11-26T15:00:00Z',
        despacho_numero: 500,
        articulo_codigo: 'EXT-99',
        articulo_nombre: 'LAMINA ESPECIAL',
        cantidad: 2,
        precio_unit_usd: 50,
        total_usd: 100,
        cliente_nombre: 'CLIENTE X',
        cliente_rif: 'J-1',
        asesor_nombre: 'LUIS',
      }],
      rango: { from: '2026-11-01', to: '2026-11-27' },
      kpis: { totalVentas: 100, cantidadTotal: 2, pedidosUnicos: 1, clientesUnicos: 1 },
      filtroAsesor: 'LUIS',
      busqueda: 'LAMINA',
    })

    const textos = globalThis.__f3Textos.join(' | ')
    expect(textos).toContain('Asesor: LUIS')
    expect(textos).toContain('EXT-99')

    const ventasDia = construirVentasDia({
      fecha: '2026-11-27',
      clientes: [{ id: 'c1', nombre: 'CLI COD' }],
      despachos: [{
        id: 'd1',
        numero: 1,
        cliente_id: 'c1',
        estado: 'entregada',
        total_usd: 100,
        creado_en: '2026-11-27T14:00:00Z',
        entregada_en: '2026-11-27T16:00:00Z',
        forma_pago: JSON.stringify([{
          metodo: 'Cobro a destino',
          monto: 100,
          cobro_destino_pagado: true,
          metodos_pagados: [{ metodo: 'Zelle', monto: 100, referencia: 'Z123' }],
        }]),
      }],
    })
    expect(ventasDia.resumen.cobradoUsd).toBe(100)
    expect(ventasDia.resumen.porCobrarUsd).toBe(0)
  })
})
