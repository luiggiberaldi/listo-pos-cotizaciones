import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
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

import { verifyAuth, verifySupervisor, validateOperator } from '../../lib/auth.js'
import { handleBackup, handleRestore } from '../admin.js'
import { handleBorrarProductoConKardex } from '../inventario.js'
import { detectarCargasRecientesSimilares, consolidarFilasImportacionCsv } from '../../../src/utils/cargaDuplicada.js'

const ENV = { SUPABASE_URL: 'https://spupqgkdsgohxxfoxydl.supabase.co', SUPABASE_SERVICE_KEY: 'test' }
const CUENTA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'
const PROD_ID = '11111111-1111-4111-8111-111111111111'
const IDEM_KEY = '77777777-7777-4777-8777-777777777777'

describe('OP-2026-071 Fase 4 (N33 historial, N34 4 decimales y consolidación, N32 respaldo completo y alerta duplicados)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    verifyAuth.mockResolvedValue({ id: CUENTA_ID, operator_id: ACTOR_ID })
    verifySupervisor.mockResolvedValue(true)
    validateOperator.mockResolvedValue({
      user: { id: CUENTA_ID, operator_id: ACTOR_ID },
      operador: { id: ACTOR_ID, actor_id: ACTOR_ID, cuenta_id: CUENTA_ID, nombre: 'Admin', rol: 'administracion', color: '#000' },
      headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      ip: '127.0.0.1',
    })
  })

  it('N32: handleBackup incluye movimientos de Kardex, operaciones, préstamos, devoluciones, intercambios e ítems de despacho', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('/rest/v1/clientes')) return new Response(JSON.stringify([{ id: 'c1', nombre: 'Cli' }]), { status: 200 })
      if (url.includes('/rest/v1/notas_despacho?')) return new Response(JSON.stringify([{ id: 'd1', numero: 1 }]), { status: 200 })
      if (url.includes('/rest/v1/inventario_movimientos')) return new Response(JSON.stringify([{ id: 'm1' }]), { status: 200 })
      if (url.includes('/rest/v1/cliente_prestamos')) return new Response(JSON.stringify([{ id: 'p1', cliente_id: 'c1' }]), { status: 200 })
      if (url.includes('/rest/v1/despacho_devoluciones')) return new Response(JSON.stringify([{ id: 'dev1', despacho_id: 'd1' }]), { status: 200 })
      if (url.includes('/rest/v1/despacho_devolucion_intercambios')) return new Response(JSON.stringify([{ id: 'int1', despacho_id: 'd1' }]), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }))

    const res = await handleBackup(new Request('https://staging.erp.test/api/admin/backup'), ENV)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tablas).toHaveProperty('notas_despacho_items')
    expect(json.tablas).toHaveProperty('inventario_movimientos')
    expect(json.tablas).toHaveProperty('inventario_operaciones')
    expect(json.tablas).toHaveProperty('cliente_prestamos')
    expect(json.tablas).toHaveProperty('despacho_devoluciones')
    expect(json.tablas).toHaveProperty('despacho_devolucion_intercambios')
  })

  it('N32: handleRestore restaura tablas de inventario/préstamos/devoluciones sin inyectar cuenta_id inexistente', async () => {
    const posted = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (opts?.method === 'POST' && !url.includes('/rpc/')) {
        posted.push({ table: url.split('/rest/v1/')[1], body: JSON.parse(opts.body) })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))

    const req = new Request('https://staging.erp.test/api/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tablas: {
          productos: [{ id: PROD_ID, nombre: 'P1' }],
          notas_despacho: [{ id: 'd1', numero: 1 }],
          notas_despacho_items: [{ id: 'di1', despacho_id: 'd1' }],
          cliente_prestamos: [{ id: 'cp1', cliente_id: 'c1', despacho_id: 'd1' }],
          despacho_devoluciones: [{ id: 'dd1', despacho_id: 'd1' }],
          despacho_devolucion_intercambios: [{ id: 'di2', despacho_id: 'd1' }],
          inventario_movimientos: [{ id: 'im1', producto_id: PROD_ID }],
        },
      }),
    })
    const res = await handleRestore(req, ENV)
    expect(res.status).toBe(200)
    const cpPost = posted.find(p => p.table === 'cliente_prestamos')
    const ddPost = posted.find(p => p.table === 'despacho_devoluciones')
    const imPost = posted.find(p => p.table === 'inventario_movimientos')
    expect(cpPost?.body?.[0]).not.toHaveProperty('cuenta_id')
    expect(ddPost?.body?.[0]).not.toHaveProperty('cuenta_id')
    expect(imPost?.body?.[0]?.cuenta_id).toBe(CUENTA_ID)
  })

  it('N32: detectarCargasRecientesSimilares alerta carga repetida en 24h y consolidarFilasImportacionCsv suma duplicados por código', () => {
    const now = Date.parse('2026-11-24T12:00:00Z')
    const alertas = detectarCargasRecientesSimilares([
      { producto_id: PROD_ID, producto_nombre: 'Cabilla 3/8', tipo: 'ingreso', cantidad: 50, motivo: 'Compra Ferretotal', origen_tipo: 'batch_ingest', creado_en: '2026-11-24T10:00:00Z' },
    ], [{ producto_id: PROD_ID, nombre: 'Cabilla 3/8', cantidad: 50 }], now)
    expect(alertas).toHaveLength(1)
    expect(alertas[0].cantidad).toBe(50)

    const consolidadas = consolidarFilasImportacionCsv([
      { codigo: ' cab-01 ', nombre: 'Cabilla', stock_actual: 10.125 },
      { codigo: 'CAB-01', nombre: 'Cabilla', stock_actual: 5.375 },
    ])
    expect(consolidadas).toHaveLength(1)
    expect(consolidadas[0].stock_actual).toBe(15.5)
  })

  it('N33: handleBorrarProductoConKardex retorna 409 cuando BD reporta PRODUCTO_CON_HISTORIAL_USAR_ARCHIVADO', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'PRODUCTO_CON_HISTORIAL_USAR_ARCHIVADO: "Tubo"' }), { status: 400 })))
    const res = await handleBorrarProductoConKardex(new Request('https://staging.erp.test/api/productos/borrar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: 'https://staging.erp.test' },
      body: JSON.stringify({ id: PROD_ID, idempotencyKey: IDEM_KEY }),
    }), ENV)
    expect(res.status).toBe(409)
  })

  it('Contrato SQL 313: protege historial, corrige signo negativo, amplía a NUMERIC(12,4) y consolida lotes conservando ARREGLO 278', () => {
    const migPath = resolve('supabase/migrations/315_staging_higiene_decimales_lotes.sql')
    expect(existsSync(migPath)).toBe(true)
    const sql = readFileSync(migPath, 'utf8')
    expect(sql).toContain('PRODUCTO_CON_HISTORIAL_USAR_ARCHIVADO')
    expect(sql).toContain('v_producto.stock_actual < 0')
    expect(sql).toContain('NUMERIC(12,4)')
    expect(sql).toContain('despacho_items_peso')
    expect(sql).toContain('ARREGLO 278')
    expect(sql).not.toContain('precio_usd = CASE WHEN COALESCE(v_item.precio_usd')
  })
})
