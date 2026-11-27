import { describe, expect, it, vi } from 'vitest'
import { generarClientesPDF } from '../pdf/clientesPDF.js'
import { fechaArchivoCaracas } from '../pdf/pdfShared.js'

const config = {
  nombre_negocio: 'CONSTRUACERO CARABOBO C.A.',
  telefono_negocio: '+584144001122',
  email_negocio: 'ventas@construacerocarabobo.com',
}

function hacerClientes(cantidad = 3, extra = {}) {
  return Array.from({ length: cantidad }, (_, i) => ({
    id: `c-${i}`,
    codigo_cliente: `#${588466 + i}`,
    rif_cedula: i % 2 === 0 ? `V-18.612.${535 + i}` : `J-4012345${i}-7`,
    nombre: i === 0
      ? 'Enzo Patty'
      : `Constructora e Inversiones Industriales del Centro C.A. Sucursal Valencia #${i}`,
    tipo_cliente: i % 2 === 0 ? 'natural' : 'juridico',
    telefono: '+584144257691',
    vendedor: { nombre: i === 0 ? 'enzo patti' : 'Wendy Lozano TP' },
    creado_en: '2026-11-10T14:00:00Z',
    activo: i % 4 !== 3,
    ...extra,
  }))
}

function extraerTextoPlano(doc) {
  const raw = doc.output()
  // Decodifica paréntesis escapados de literales PDF para búsquedas legibles sin volcar binarios
  return raw.replace(/\\\(/g, '(').replace(/\\\)/g, ')')
}

describe('PDF Base de Datos de Clientes y Reporte de Personal (OP-2026-102)', () => {
  it('usa encabezado blanco/negro, cajas de resumen claras y contenido completo sin truncar', async () => {
    const { doc, filename } = await generarClientesPDF({
      items: hacerClientes(3),
      config,
      action: 'return',
      filtroResumen: 'Mis clientes · Solo activos',
      comprimir: false,
    })

    const texto = extraerTextoPlano(doc)
    expect(filename).toMatch(/^Base_de_Datos_Clientes_\d{4}-\d{2}-\d{2}\.pdf$/)
    for (const esperado of [
      'CONSTRUACERO',
      'Base de Datos de Clientes',
      'Mis clientes',
      'ENZO PATTY',
      'CONSTRUCTORA E INVERSIONES INDUSTRIALES',
      '0414-4257691',
      'Total Clientes',
      'Av. 76',
    ]) {
      expect(texto.includes(esperado), `Falta texto esperado: ${esperado}`).toBe(true)
    }

    // Verifica fondo blanco del header (1. g) y ausencia de los bloques sólidos oscuros anteriores
    expect(texto.includes('1. g')).toBe(true)
    expect(texto.includes('0.102 0.212 0.365 rg')).toBe(false)
    expect(texto.includes('0.016 0.471 0.341 rg')).toBe(false)
    expect(texto.includes('0.573 0.251 0.055 rg')).toBe(false)
  })

  it('salta a varias páginas con encabezado simplificado blanco/negro y sin chocar con el pie', async () => {
    const { doc } = await generarClientesPDF({
      items: hacerClientes(55),
      config,
      action: 'return',
      comprimir: false,
    })

    expect(doc.internal.getNumberOfPages()).toBeGreaterThan(1)
    const texto = extraerTextoPlano(doc)
    expect(texto.includes('Base de Datos de Clientes (Cont.)')).toBe(true)
    expect(texto.includes('gina 1 de')).toBe(true)
  })

  it('en Reporte de Personal usa nombre de archivo propio y columnas de rol/cargo', async () => {
    const personal = [
      {
        id: 'p-1',
        codigo_cliente: '#821937',
        rif_cedula: 'V-15222333',
        nombre: 'Alejandra Hidalgo de Rodriguez',
        tipo_cliente: 'personal',
        categoria: 'Administracion',
        telefono: '+584121234567',
        vendedor: { nombre: 'EMPRESA' },
        creado_en: '2026-11-15T18:00:00Z',
        activo: true,
      },
    ]

    const { doc, filename } = await generarClientesPDF({
      items: personal,
      config,
      action: 'return',
      title: 'Reporte de Personal',
      filtroResumen: 'Solo activos',
      comprimir: false,
    })

    const texto = extraerTextoPlano(doc)
    expect(filename).toMatch(/^Reporte_de_Personal_\d{4}-\d{2}-\d{2}\.pdf$/)
    for (const esperado of ['Reporte de Personal', 'ROL / CARGO', 'ADMINISTRACION', 'Total Personal']) {
      expect(texto.includes(esperado), `Falta texto esperado: ${esperado}`).toBe(true)
    }
  })

  it('usa la fecha de Venezuela (America/Caracas) aunque el reloj UTC ya haya cambiado de día', async () => {
    vi.useFakeTimers()
    try {
      // 2026-11-27 22:30 hora Venezuela = 2026-11-28 02:30 UTC
      vi.setSystemTime(new Date('2026-11-28T02:30:00Z'))
      expect(fechaArchivoCaracas()).toBe('2026-11-27')

      const { filename } = await generarClientesPDF({
        items: hacerClientes(1),
        config: null,
        action: 'return',
      })
      expect(filename).toBe('Base_de_Datos_Clientes_2026-11-27.pdf')
    } finally {
      vi.useRealTimers()
    }
  })

  it('maneja lista vacía y config nulo sin errores', async () => {
    const { doc } = await generarClientesPDF({
      items: [],
      config: null,
      action: 'return',
      comprimir: false,
    })

    const texto = extraerTextoPlano(doc)
    expect(texto.includes('No hay registros que coincidan')).toBe(true)
    expect(texto.includes('CONSTRUACERO')).toBe(true)
  })
})
