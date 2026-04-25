import { describe, it, expect, vi } from 'vitest'

// Mock supabase client (whatsapp.js importa supabase al top level)
vi.mock('../../services/supabase/client', () => ({
  default: { auth: { getSession: vi.fn() } },
}))

import { formatearTelefono, generarMensaje } from '../whatsapp'

// ─── formatearTelefono ──────────────────────────────────────────────────────

describe('formatearTelefono', () => {
  it('"04121234567" → "584121234567"', () => {
    expect(formatearTelefono('04121234567')).toBe('584121234567')
  })

  it('"412-123-4567" → "584121234567"', () => {
    expect(formatearTelefono('412-123-4567')).toBe('584121234567')
  })

  it('"+584121234567" → "584121234567"', () => {
    expect(formatearTelefono('+584121234567')).toBe('584121234567')
  })

  it('"584121234567" → "584121234567" (ya tiene 58)', () => {
    expect(formatearTelefono('584121234567')).toBe('584121234567')
  })

  it('remueve parentesis: "(0412)1234567"', () => {
    expect(formatearTelefono('(0412)1234567')).toBe('584121234567')
  })

  it('remueve espacios: "0412 123 4567"', () => {
    expect(formatearTelefono('0412 123 4567')).toBe('584121234567')
  })

  it('null retorna ""', () => {
    expect(formatearTelefono(null)).toBe('')
  })

  it('undefined retorna ""', () => {
    expect(formatearTelefono(undefined)).toBe('')
  })

  it('string vacio retorna ""', () => {
    expect(formatearTelefono('')).toBe('')
  })

  it('remueve puntos: "0412.123.4567"', () => {
    expect(formatearTelefono('0412.123.4567')).toBe('584121234567')
  })
})

// ─── generarMensaje ─────────────────────────────────────────────────────────

describe('generarMensaje', () => {
  it('genera mensaje basico con nombre cliente y vendedor', () => {
    const msg = generarMensaje({
      nombreCliente: 'Juan',
      nombreVendedor: 'Pedro',
      numDisplay: 'COT-00001',
      totalUsd: 100,
    })
    expect(msg).toContain('*Juan*')
    expect(msg).toContain('*Pedro*')
    expect(msg).toContain('COT-00001')
  })

  it('sin nombre cliente usa "Estimado/a cliente,"', () => {
    const msg = generarMensaje({
      numDisplay: 'COT-00001',
      totalUsd: 50,
    })
    expect(msg).toContain('Estimado/a cliente,')
  })

  it('sin vendedor omite saludo personal', () => {
    const msg = generarMensaje({
      nombreCliente: 'Juan',
      numDisplay: 'COT-00001',
      totalUsd: 50,
    })
    expect(msg).not.toContain('Le saluda')
    expect(msg).toContain('Le enviamos la cotizacion')
  })

  // NOTA: generarMensaje calcula lineasProductos internamente pero actualmente
  // no las incluye en el output (los items se computan pero no se agregan al array).
  // Estos tests verifican el comportamiento actual.
  it('acepta items sin crashear', () => {
    const msg = generarMensaje({
      numDisplay: 'COT-00001',
      totalUsd: 100,
      items: [
        { nombre_snap: 'Cabilla 3/8', cantidad: 10, precio_unit_usd: 5 },
      ],
    })
    expect(msg).toContain('COT-00001')
    expect(msg).toBeDefined()
  })

  it('acepta mas de 15 items sin crashear', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      nombre_snap: `Producto ${i + 1}`,
      cantidad: 1,
      precio_unit_usd: 10,
    }))
    const msg = generarMensaje({
      numDisplay: 'COT-00001',
      totalUsd: 200,
      items,
    })
    expect(msg).toContain('COT-00001')
  })

  it('incluye link PDF cuando pdfUrl esta presente', () => {
    const msg = generarMensaje({
      numDisplay: 'COT-00001',
      totalUsd: 100,
      pdfUrl: 'https://example.com/pdf',
    })
    expect(msg).toContain('https://example.com/pdf')
    expect(msg).toContain('Pulse aca')
  })

  it('muestra texto generico cuando no hay pdfUrl', () => {
    const msg = generarMensaje({
      numDisplay: 'COT-00001',
      totalUsd: 100,
    })
    expect(msg).toContain('Adjunto encontrara el documento PDF')
  })

  it('usa nombre de negocio personalizado', () => {
    const msg = generarMensaje({
      nombreNegocio: 'Mi Ferreteria',
      nombreVendedor: 'Ana',
      numDisplay: 'COT-00001',
      totalUsd: 50,
    })
    expect(msg).toContain('Mi Ferreteria')
  })

  it('usa "Construacero Carabobo" como negocio por defecto', () => {
    const msg = generarMensaje({
      numDisplay: 'COT-00001',
      totalUsd: 50,
    })
    expect(msg).toContain('Construacero Carabobo')
  })
})
