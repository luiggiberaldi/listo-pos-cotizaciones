import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn() }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(() => Promise.resolve()) }))

import { validateOperator } from '../../lib/auth.js'
import { handleReporteTransportistas } from '../transportistas.js'

const cuentaId = '11111111-1111-4111-8111-111111111111'
const chofer = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  validateOperator.mockResolvedValue({
    operador: { id: '44444444-4444-4444-8444-444444444444', rol: 'jefe', cuenta_id: cuentaId },
    headers: {},
  })
})

describe('reporte de transportistas completo', () => {
  it('cuenta los 1.250 despachos aunque la base entregue máximo 1.000 por pedido', async () => {
    const despachos = Array.from({ length: 1250 }, (_, i) => ({
      id: `d${i}`, transportista_id: chofer, flete_usd: 10, flete_neto_transportista_usd: 2,
      flete_comisionable: true, flete_pagado: false, estado: 'entregada', creado_en: '2026-10-01T12:00:00Z',
    }))
    const pedidosDespachos = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      const u = new URL(String(url))
      if (u.pathname.endsWith('/transportistas')) return new Response(JSON.stringify([{ id: chofer, nombre: 'Chofer', es_local: true, activo: true }]))
      if (u.pathname.endsWith('/configuracion_negocio')) return new Response(JSON.stringify([{ transp_tipo_calculo: 'porcentaje', transp_pct_comision: 20 }]))
      if (u.pathname.endsWith('/notas_despacho')) {
        pedidosDespachos.push(u.searchParams.toString())
        const offset = Number(u.searchParams.get('offset') || 0)
        const limit = Math.min(Number(u.searchParams.get('limit') || 1000), 1000) // tope del servidor
        return new Response(JSON.stringify(despachos.slice(offset, offset + limit)))
      }
      return new Response('[]')
    }))

    const res = await handleReporteTransportistas(
      new Request('https://app.test/api/transportistas/reporte?desde=2026-01-01&hasta=2026-11-06'),
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'k' },
    )
    expect(res.status).toBe(200)
    const { items } = await res.json()
    expect(items).toHaveLength(1)
    expect(items[0].despachos).toBe(1250)
    expect(items[0].flete_total_usd).toBe(12500)
    expect(items[0].saldo_usd).toBe(2500)
    expect(pedidosDespachos).toHaveLength(2)
    expect(pedidosDespachos[0]).toContain('order=id.asc')
  })

  it('si la base falla al leer, responde error (no un reporte en ceros)', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => {
      const u = new URL(String(url))
      if (u.pathname.endsWith('/transportistas')) return new Response(JSON.stringify([{ id: chofer, nombre: 'Chofer', es_local: true }]))
      if (u.pathname.endsWith('/notas_despacho')) return new Response('fallo', { status: 500 })
      return new Response('[]')
    }))
    const res = await handleReporteTransportistas(
      new Request('https://app.test/api/transportistas/reporte'),
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'k' },
    )
    expect(res.status).toBe(500)
  })
})
