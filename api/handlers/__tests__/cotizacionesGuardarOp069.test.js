// OP-2026-065: guardar cotización sin duplicar, sin perder productos y con auditoría
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
  getOperatorRole: vi.fn(),
  verifySupervisor: vi.fn(async () => false),
  verifyAdminRole: vi.fn(async () => false),
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
  logToSystem: vi.fn(() => Promise.resolve()),
}))

import { verifyAuth } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'
import { handleGuardarCotizacion } from '../cotizaciones.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' }
const accountId = '11111111-1111-4111-8111-111111111111'
const sellerId = '22222222-2222-4222-8222-222222222222'
const otherSeller = '55555555-5555-4555-8555-555555555555'
const clientId = '33333333-3333-4333-8333-333333333333'
const nuevoId = '44444444-4444-4444-8444-444444444444'

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function request(extra = {}) {
  return new Request('https://app.test/api/cotizaciones/guardar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      headerData: { cliente_id: clientId, subtotal_usd: 10, total_usd: 10 },
      items: [{ nombre_snap: 'Producto', cantidad: 1, precio_unit_usd: 10, total_linea_usd: 10 }],
      ...extra,
    }),
  })
}

function simular(manejador) {
  const llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const c = { u: String(url), metodo: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null }
    llamadas.push(c)
    return manejador(c)
  }))
  return llamadas
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  verifyAuth.mockResolvedValue({ id: accountId, operator_id: sellerId })
})

describe('guardar cotización nueva con identidad propia (N28)', () => {
  it('la primera vez la crea con el id que mandó la pantalla', async () => {
    const llamadas = simular(({ u, metodo }) => {
      if (u.includes('/cotizaciones?id=eq.') && metodo === 'GET') return resp([])
      if (u.includes('/cotizaciones?select=id') && metodo === 'POST') return resp([{ id: nuevoId }], 201)
      if (u.includes('/cotizacion_items') && metodo === 'POST') return resp([], 201)
      throw new Error(`no esperada ${metodo} ${u}`)
    })
    const res = await handleGuardarCotizacion(request({ nuevoId }), ENV)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: nuevoId })
    expect(llamadas.find(l => l.metodo === 'POST' && l.u.includes('/cotizaciones?')).body.id).toBe(nuevoId)
  })

  it('un reintento de una cotización ya enviada NO crea otra', async () => {
    const llamadas = simular(({ u, metodo }) => {
      if (u.includes('/cotizaciones?id=eq.') && metodo === 'GET') return resp([{ id: nuevoId, vendedor_id: sellerId, estado: 'enviada' }])
      throw new Error(`no esperada ${metodo} ${u}`)
    })
    const res = await handleGuardarCotizacion(request({ nuevoId }), ENV)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(nuevoId)
    expect(llamadas.some(l => l.metodo === 'POST')).toBe(false)
  })

  it('un reintento de un borrador ya creado lo actualiza en vez de duplicarlo', async () => {
    const llamadas = simular(({ u, metodo }) => {
      if (u.includes('/cotizaciones?id=eq.') && metodo === 'GET') return resp([{ id: nuevoId, vendedor_id: sellerId, estado: 'borrador' }])
      if (u.includes('/cotizacion_items?cotizacion_id=eq.') && metodo === 'GET') return resp([])
      if (u.includes('/cotizaciones?id=eq.') && metodo === 'PATCH') return resp([{ id: nuevoId }])
      if (u.includes('/cotizacion_items') && metodo === 'POST') return resp([{ id: 'n1' }], 201)
      throw new Error(`no esperada ${metodo} ${u}`)
    })
    const res = await handleGuardarCotizacion(request({ nuevoId }), ENV)
    expect(res.status).toBe(200)
    expect(llamadas.some(l => l.metodo === 'POST' && l.u.includes('/cotizaciones?'))).toBe(false)
    expect(registrarAuditoria.mock.calls.at(-1)[2].accion).toBe('EDITAR_COTIZACION')
  })

  it('no deja usar el id de una cotización de otro vendedor', async () => {
    simular(({ u, metodo }) => {
      if (u.includes('/cotizaciones?id=eq.') && metodo === 'GET') return resp([{ id: nuevoId, vendedor_id: otherSeller, estado: 'borrador' }])
      throw new Error(`no esperada ${metodo} ${u}`)
    })
    const res = await handleGuardarCotizacion(request({ nuevoId }), ENV)
    expect(res.status).toBe(409)
  })

  it('rechaza un nuevoId que no es un identificador válido', async () => {
    simular(() => { throw new Error('no debería llamar a la base') })
    const res = await handleGuardarCotizacion(request({ nuevoId: 'local_123' }), ENV)
    expect(res.status).toBe(400)
  })
})

describe('editar sin perder productos (N31)', () => {
  const existente = ({ u, metodo }) => {
    if (u.includes('/cotizaciones?id=eq.') && metodo === 'GET') return resp([{ vendedor_id: sellerId, estado: 'borrador' }])
    if (u.includes('/cotizacion_items?cotizacion_id=eq.') && metodo === 'GET') return resp([{ id: 'v1' }, { id: 'v2' }])
    if (u.includes('/cotizaciones?id=eq.') && metodo === 'PATCH') return resp([{ id: nuevoId }])
    return null
  }

  it('inserta los productos nuevos ANTES de borrar los viejos, y borra solo los viejos', async () => {
    const llamadas = simular((c) => existente(c)
      || (c.u.includes('/cotizacion_items') && c.metodo === 'POST' ? resp([{ id: 'n1' }], 201) : null)
      || (c.u.includes('/cotizacion_items?id=in.') && c.metodo === 'DELETE' ? resp([]) : null)
      || (() => { throw new Error(`no esperada ${c.metodo} ${c.u}`) })())
    const res = await handleGuardarCotizacion(request({ cotizacionId: nuevoId }), ENV)
    expect(res.status).toBe(200)
    const iInsert = llamadas.findIndex(l => l.metodo === 'POST' && l.u.includes('/cotizacion_items'))
    const iDelete = llamadas.findIndex(l => l.metodo === 'DELETE')
    expect(iInsert).toBeLessThan(iDelete)
    expect(llamadas[iDelete].u).toContain('id=in.(v1,v2)')
    expect(llamadas.some(l => l.metodo === 'DELETE' && l.u.includes('cotizacion_id=eq.'))).toBe(false)
  })

  it('si insertar los nuevos falla, los viejos NO se borran', async () => {
    const llamadas = simular((c) => existente(c)
      || (c.u.includes('/cotizacion_items') && c.metodo === 'POST' ? resp({ message: 'check' }, 400) : null)
      || (() => { throw new Error(`no esperada ${c.metodo} ${c.u}`) })())
    const res = await handleGuardarCotizacion(request({ cotizacionId: nuevoId }), ENV)
    expect(res.status).toBe(500)
    expect(llamadas.some(l => l.metodo === 'DELETE')).toBe(false)
  })

  it('si borrar los viejos falla, deshace los nuevos (no quedan repetidos)', async () => {
    const llamadas = simular((c) => existente(c)
      || (c.u.includes('/cotizacion_items') && c.metodo === 'POST' ? resp([{ id: 'n1' }], 201) : null)
      || (c.u.includes('id=in.(v1,v2)') && c.metodo === 'DELETE' ? resp({ message: 'fallo' }, 500) : null)
      || (c.u.includes('id=in.(n1)') && c.metodo === 'DELETE' ? resp([]) : null)
      || (() => { throw new Error(`no esperada ${c.metodo} ${c.u}`) })())
    const res = await handleGuardarCotizacion(request({ cotizacionId: nuevoId }), ENV)
    expect(res.status).toBe(500)
    expect(llamadas.some(l => l.metodo === 'DELETE' && l.u.includes('id=in.(n1)'))).toBe(true)
  })
})

describe('auditoría de crear cotización (N29)', () => {
  it('pide a la nube terminar la auditoría aunque ya se haya respondido', async () => {
    simular(({ u, metodo }) => {
      if (u.includes('/cotizaciones?id=eq.') && metodo === 'GET') return resp([])
      if (u.includes('/cotizaciones?select=id') && metodo === 'POST') return resp([{ id: nuevoId }], 201)
      if (u.includes('/cotizacion_items') && metodo === 'POST') return resp([], 201)
      throw new Error(`no esperada ${metodo} ${u}`)
    })
    const waitUntil = vi.fn()
    const res = await handleGuardarCotizacion(request({ nuevoId }), { ...ENV, waitUntil })
    expect(res.status).toBe(200)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(registrarAuditoria.mock.calls[0][2].accion).toBe('CREAR_COTIZACION')
  })
})
