// api/lib/__tests__/cxcUtilsFallo057.test.js
// OP-2026-057 (M5): si el recálculo del saldo falla, queda anotado en la auditoría.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recalcularSaldoPendienteCliente } from '../cxcUtils.js'
import { registrarAuditoria } from '../audit.js'

vi.mock('../audit.js', () => ({ registrarAuditoria: vi.fn(async () => null), logToSystem: vi.fn(async () => null) }))
const ENV = { SUPABASE_URL: 'https://x.test.invalid', SUPABASE_SERVICE_KEY: 't' }
const CLIENTE = 'cccccccc-3333-4333-8333-cccccccccccc'
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('recalcularSaldoPendienteCliente — fallos visibles', () => {
  it('fallo al leer los movimientos → anotación RECALCULO_SALDO_FALLIDO', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await recalcularSaldoPendienteCliente(CLIENTE, ENV, {})
    expect(registrarAuditoria).toHaveBeenCalledTimes(1)
    expect(registrarAuditoria.mock.calls[0][2]).toMatchObject({ categoria: 'SISTEMA', accion: 'RECALCULO_SALDO_FALLIDO', entidadId: CLIENTE })
  })
  it('fallo al guardar el saldo → también se anota', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => (init.method === 'PATCH' ? new Response('no', { status: 400 }) : new Response('[]', { status: 200 }))))
    await recalcularSaldoPendienteCliente(CLIENTE, ENV, {})
    expect(registrarAuditoria.mock.calls[0][2].meta.paso).toBe('guardar saldo')
  })
  it('sin fallos no anota nada', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    await recalcularSaldoPendienteCliente(CLIENTE, ENV, {})
    expect(registrarAuditoria).not.toHaveBeenCalled()
  })
})
