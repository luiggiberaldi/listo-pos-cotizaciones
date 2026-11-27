import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
  getOperatorRole: vi.fn(),
  verifySupervisor: vi.fn(),
  verifyPrivileged: vi.fn(),
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
  logToSystem: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import {
  handleConteoInventario,
  handleRevertirMovimientoInventario,
  handleActualizarProductoConKardex,
} from '../inventario.js'

const ENV = { SUPABASE_URL: 'https://spupqgkdsgohxxfoxydl.supabase.co', SUPABASE_SERVICE_KEY: 'test' }
const PROD_ID = '11111111-1111-4111-8111-111111111111'
const MOV_ID = '22222222-2222-4222-8222-222222222222'
const IDEM_KEY = '33333333-3333-4333-8333-333333333333'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'

function makeReq(path, body, method = 'POST') {
  return new Request(`https://staging.erp.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('OP-2026-071 Fase 1 (N25 ficha + conteo físico + N26 reversión Kardex)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    validateOperator.mockResolvedValue({
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operator_id: '00000000-0000-0000-0000-000000000000' },
      operador: {
        id: '00000000-0000-0000-0000-000000000000',
        actor_id: ACTOR_ID,
        cuenta_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        nombre: 'Admin Staging',
        rol: 'desarrollador',
        color: '#0ea5e9',
      },
      headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      ip: '127.0.0.1',
    })
  })

  it('handleConteoInventario exige motivo y rechaza duplicados en el lote', async () => {
    const resNoMotivo = await handleConteoInventario(makeReq('/api/inventario/conteo', {
      motivo: '   ',
      idempotencyKey: IDEM_KEY,
      items: [{ producto_id: PROD_ID, stock_contado: 15, stock_esperado: 10 }],
    }), ENV)
    expect(resNoMotivo.status).toBe(400)

    const resDup = await handleConteoInventario(makeReq('/api/inventario/conteo', {
      motivo: 'Conteo físico anual',
      idempotencyKey: IDEM_KEY,
      items: [
        { producto_id: PROD_ID, stock_contado: 15, stock_esperado: 10 },
        { producto_id: PROD_ID, stock_contado: 12, stock_esperado: 10 },
      ],
    }), ENV)
    expect(resDup.status).toBe(400)
  })

  it('handleConteoInventario devuelve 409 en conflicto de concurrencia y 200 al aplicar conteo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: 'CONFLICTO_CONCURRENCIA_STOCK: "Tubo" cambió en el servidor (era 8 y se esperaba 10)',
    }), { status: 400 })))

    const conflict = await handleConteoInventario(makeReq('/api/inventario/conteo', {
      motivo: 'Conteo físico bodega',
      idempotencyKey: IDEM_KEY,
      items: [{ producto_id: PROD_ID, stock_contado: 15, stock_esperado: 10 }],
    }), ENV)
    expect(conflict.status).toBe(409)

    let sentRpcBody = null
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      sentRpcBody = JSON.parse(opts.body)
      return new Response(JSON.stringify({ ok: true, lote_id: '55555555-5555-4555-8555-555555555555', numero: 99, movimientos: 1, sin_cambios: 0 }), { status: 200 })
    }))

    const ok = await handleConteoInventario(makeReq('/api/inventario/conteo', {
      motivo: 'Conteo físico bodega',
      idempotencyKey: IDEM_KEY,
      items: [{ producto_id: PROD_ID, stock_contado: 0, stock_esperado: 8 }],
    }), ENV)
    expect(ok.status).toBe(200)
    expect(sentRpcBody.p_items[0].stock_contado).toBe(0)
    expect(sentRpcBody.p_items[0].stock_esperado).toBe(8)
    expect(sentRpcBody.p_usuario_id).toBe(ACTOR_ID)
  })

  it('handleActualizarProductoConKardex no envía stock_actual si no fue modificado por conteo', async () => {
    let rpcPayload = null
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      rpcPayload = JSON.parse(opts.body)
      return new Response(JSON.stringify({ ok: true, id: PROD_ID }), { status: 200 })
    }))

    const res = await handleActualizarProductoConKardex(makeReq('/api/productos/actualizar', {
      id: PROD_ID,
      nombre: 'Viga IPE 100',
      precio_usd: 25,
      stock_minimo: 5,
      idempotencyKey: IDEM_KEY,
    }, 'PATCH'), ENV)

    expect(res.status).toBe(200)
    expect(rpcPayload.p_stock_actual).toBeNull()
  })

  it('handleRevertirMovimientoInventario resuelve idempotencyKey y usa actor_id real', async () => {
    let rpcPayload = null
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      rpcPayload = JSON.parse(opts.body)
      return new Response(JSON.stringify({ ok: true, lote_id: '66666666-6666-4666-8666-666666666666', numero: 123, cantidad: 5, tipo_inverso: 'egreso', stock_nuevo: 10 }), { status: 200 })
    }))

    const res = await handleRevertirMovimientoInventario(makeReq('/api/inventario/movimiento/revertir', {
      movimiento_id: MOV_ID,
      idempotencyKey: IDEM_KEY,
    }), ENV)

    expect(res.status).toBe(200)
    expect(rpcPayload.p_usuario_id).toBe(ACTOR_ID)
    expect(rpcPayload.p_idempotency_key).toBe(IDEM_KEY)
  })

  it('contratos UI (N25 y N26): ficha protegida, 3er tab Conteo físico y elegibilidad Kardex', () => {
    const formSrc = readFileSync(new URL('../../../src/components/inventario/ProductoForm.jsx', import.meta.url), 'utf8')
    const hookProdSrc = readFileSync(new URL('../../../src/hooks/useInventario.js', import.meta.url), 'utf8')
    const hookMovSrc = readFileSync(new URL('../../../src/hooks/useMovimientosInventario.js', import.meta.url), 'utf8')
    const loteSrc = readFileSync(new URL('../../../src/components/inventario/MovimientoLoteModal.jsx', import.meta.url), 'utf8')
    const kardexSrc = readFileSync(new URL('../../../src/components/inventario/KardexModal.jsx', import.meta.url), 'utf8')

    expect(formSrc).toContain('Ajustar por conteo físico')
    expect(formSrc).toContain('Solo mediante conteo físico')
    expect(hookProdSrc).toContain('stock_actual: undefined') // edición normal no pisa stock

    expect(loteSrc).toContain('Conteo físico')
    expect(hookMovSrc).toContain('/api/inventario/conteo')
    expect(hookMovSrc).toContain('origen_tipo, origen_id, origen_referencia')

    // Kardex elegible para movimiento_inventario y conteo_fisico, bloqueando orígenes de sistema
    // (OP-2026-086: la regla vive en src/utils/kardexRevertible.js y tiene pruebas de comportamiento
    // en src/utils/__tests__/op086Inventario.test.js)
    const reglaSrc = readFileSync(new URL('../../../src/utils/kardexRevertible.js', import.meta.url), 'utf8')
    expect(kardexSrc).toContain("from '../../utils/kardexRevertible'")
    expect(reglaSrc).toContain("'movimiento_inventario'")
    expect(reglaSrc).toContain("'conteo_fisico'")
    expect(kardexSrc).not.toMatch(/const elegible\s*=\s*puedeRevertir\s*&&\s*!m\.origen_tipo/)
  })
})
