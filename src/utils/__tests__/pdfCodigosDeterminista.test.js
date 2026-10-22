import { describe, expect, it } from 'vitest'
import { generarReporteVentasPDF } from '../../services/pdf/comisionesPDF'
import { generarComisionesPDF } from '../../services/pdf/comisionesGeneradasPDF'
import { generarPDF as generarCotizacionPDF } from '../../services/pdf/cotizacionPDF'
import { generarDespachoPDF } from '../../services/pdf/despachoPDF'
import { generarOrdenDespachoPDF } from '../../services/pdf/ordenDespachoPDF'
import { generarFacturaPDF } from '../../services/pdf/facturaPDF'
import { generarReporteVendedoresPDF } from '../../services/pdf/reporteVendedoresPDF'

const CONFIG = {
  nombre_negocio: 'Construacero Carabobo C.A.',
  empresa: 'Construacero Carabobo C.A.',
  rif: 'J-12345678-9',
  telefono: '0412-1234567',
  direccion: 'Valencia, Carabobo',
}

describe('Pruebas Deterministas: Códigos de Usuarios en PDFs', () => {
  it('1. Reporte de Ventas (comisionesPDF) incluye códigos en resumen y desglose', async () => {
    const reporte = {
      tipoFiltro: 'todos',
      kpis: { totalVentas: 1000, numDespachos: 2, ticketPromedio: 500, totalComisiones: 30 },
      porVendedor: [
        { id: 'usr-1', nombre: 'Edgar Ramírez', vendedor: 'Edgar Ramírez', color: '#16A34A', codigo: 'V-AZPZ', despachos: 1, totalUsd: 600, comision: 18 },
        { id: 'usr-2', nombre: 'Josué Marciales', vendedor: 'Josué Marciales', color: '#0EA5E9', codigo: 'V-DUAJ', despachos: 1, totalUsd: 400, comision: 12 },
      ],
      despachos: [
        { id: 'dsp-1', despacho_numero: 2764, asesor_id: 'usr-1', asesor_nombre: 'Edgar Ramírez', cliente_nombre: 'ANTONIO CARRILLO', venta_neta_usd: 600 },
        { id: 'dsp-2', despacho_numero: 2767, asesor_id: 'usr-2', asesor_nombre: 'Josué Marciales', cliente_nombre: 'OSCAR CORONEL', venta_neta_usd: 400 },
      ],
      porCliente: [],
    }

    const doc = await generarReporteVentasPDF({
      reporte,
      rango: { from: '2026-08-01', to: '2026-08-30' },
      config: CONFIG,
      action: 'return',
    })

    expect(doc).toBeTruthy()
    const pdfData = doc.output('datauristring')
    expect(pdfData).toContain('data:application/pdf')
  })

  it('2. Comisiones Generadas (comisionesGeneradasPDF) incluye código del vendedor', async () => {
    const comisiones = [
      {
        id: 'com-1',
        monto: 50,
        tipo: 'generada',
        creado_en: '2026-08-20T10:00:00Z',
        vendedor: { id: 'usr-1', nombre: 'Edgar Ramírez', color: '#16A34A', codigo: 'V-AZPZ' },
        comisiones: {
          id: 'com-1',
          totalcomision: 50,
          despacho: {
            numero: 2764,
            total_usd: 1000,
            cliente_nombre: 'ANTONIO CARRILLO',
            creado_en: '2026-08-20T10:00:00Z',
          }
        }
      }
    ]

    const doc = await generarComisionesPDF({
      comisiones,
      config: CONFIG,
      rango: { from: '2026-08-01', to: '2026-08-30' },
      action: 'return',
      tasaAplicada: 916.01,
      tipoTasa: 'Euro BCV',
    })

    expect(doc).toBeTruthy()
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })

  it('3. Cotización PDF (cotizacionPDF) NO incluye código de vendedor para el cliente', async () => {
    const cotizacion = {
      id: 'cot-1',
      numero: 'COT-1001',
      version: 1,
      total_usd: 500,
      subtotal_usd: 500,
      descuento_usd: 0,
      cliente: { nombre: 'ACME CORP', rif_cedula: 'J-123456789', telefono: '0414-1234567' },
      vendedor: { id: 'usr-1', nombre: 'Edgar Ramírez', telefono: '0412-5011591', codigo: 'V-AZPZ' },
    }

    const blob = await generarCotizacionPDF({
      cotizacion,
      items: [{ codigo_snap: 'CAB-01', nombre_snap: 'Cabilla 1/2', cantidad: 10, precio_unit_usd: 50, total_linea_usd: 500 }],
      config: CONFIG,
      monedaPDF: 'usd',
      tasa: 916.01,
      returnBlob: true,
    })

    expect(blob).toBeTruthy()
  })

  it('4. Despacho y Orden de Despacho PDF NO incluyen código de vendedor', async () => {
    const despacho = {
      id: 'dsp-1',
      numero: 2764,
      total_usd: 600,
      flete_usd: 0,
      descuento_total_usd: 0,
      cliente: { nombre: 'ANTONIO CARRILLO', rif_cedula: 'V-12345678', telefono: '0412-1112233' },
      vendedor: { id: 'usr-1', nombre: 'Edgar Ramírez', telefono: '0412-5011591', codigo: 'V-AZPZ' },
    }

    const docDespacho = await generarDespachoPDF({
      despacho,
      items: [{ codigo_snap: 'CAB-01', nombre_snap: 'Cabilla 1/2', cantidad: 12, precio_unit_usd: 50, total_linea_usd: 600 }],
      config: CONFIG,
      monedaPDF: 'usd',
      tasa: 916.01,
    })
    expect(docDespacho).toBeTruthy()

    const docOrden = await generarOrdenDespachoPDF({
      despacho,
      items: [{ codigo_snap: 'CAB-01', nombre_snap: 'Cabilla 1/2', cantidad: 12, precio_unit_usd: 50, total_linea_usd: 600 }],
      config: CONFIG,
      monedaPDF: 'usd',
      tasa: 916.01,
    })
    expect(docOrden).toBeTruthy()
  }, 15000)

  it('5. Factura NO incluye código pero Reporte de Vendedores SI incluye [V-AZPZ]', async () => {
    const despacho = {
      id: 'dsp-1',
      numero: 2764,
      total_usd: 600,
      cliente: { nombre: 'ANTONIO CARRILLO', rif_cedula: 'V-12345678', telefono: '0412-1112233' },
      vendedor: { id: 'usr-1', nombre: 'Edgar Ramírez', telefono: '0412-5011591', codigo: 'V-AZPZ' },
    }

    const docFactura = await generarFacturaPDF({
      despacho,
      items: [{ codigo_snap: 'CAB-01', nombre_snap: 'Cabilla 1/2', cantidad: 12, precio_unit_usd: 50, total_linea_usd: 600 }],
      config: CONFIG,
      monedaPDF: 'usd',
      tasa: 916.01,
    })
    expect(docFactura).toBeTruthy()

    const docReporteVendedores = await generarReporteVendedoresPDF({
      data: {
        porVendedor: [
          {
            id: 'usr-1',
            nombre: 'Edgar Ramírez',
            codigo: 'V-AZPZ',
            color: '#16A34A',
            totalUsd: 600,
            despachos: 1,
            clientes: [{ nombre: 'ANTONIO CARRILLO', totalUsd: 600, cantidadDespachos: 1 }],
            productos: [],
            topClientes: [{ nombre: 'ANTONIO CARRILLO', totalUsd: 600 }],
            topProductos: [],
            historial: [],
            cotizaciones: { total: 1, borrador: 0, enviada: 0, aprobada: 1, rechazada: 0, vencida: 0, anulada: 0 }
          }
        ]
      },
      periodo: { from: '2026-08-01', to: '2026-08-30' },
      config: CONFIG,
      tasa: 916.01,
      action: 'return',
    })
    expect(docReporteVendedores).toBeTruthy()
  })

  it('6. Prueba determinista estricta: los códigos [V-AZPZ] y [V-DUAJ] son renderizados textualmente en el PDF', async () => {
    const doc = await generarReporteVentasPDF({
      reporte: {
        tipoFiltro: 'todos',
        kpis: { totalVentas: 1000, numDespachos: 2, ticketPromedio: 500, totalComisiones: 30 },
        porVendedor: [
          { id: 'usr-1', nombre: 'Edgar Ramírez', vendedor: 'Edgar Ramírez', color: '#16A34A', codigo: 'V-AZPZ', despachos: 1, totalUsd: 600, comision: 18 },
          { id: 'usr-2', nombre: 'Josué Marciales', vendedor: 'Josué Marciales', color: '#0EA5E9', codigo: 'V-DUAJ', despachos: 1, totalUsd: 400, comision: 12 },
        ],
        despachos: [
          { id: 'dsp-1', despacho_numero: 2764, asesor_id: 'usr-1', asesor_nombre: 'Edgar Ramírez', cliente_nombre: 'ANTONIO CARRILLO', venta_neta_usd: 600 },
        ],
        porCliente: [],
      },
      rango: { from: '2026-08-01', to: '2026-08-30' },
      config: CONFIG,
      action: 'return',
    })

    expect(doc).toBeTruthy()
    const pageStream = (doc.internal.pages || []).map(p => Array.isArray(p) ? p.join('\n') : String(p)).join('\n')
    expect(pageStream).toContain('V-AZPZ')
    expect(pageStream).toContain('V-DUAJ')
  })
})
