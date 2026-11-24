// api/handlers/__tests__/edicionProfundaCxc053.test.js
// OP-2026-053 (G2, edición profunda): artículos y cuenta del cliente en una sola transacción, sin borrar
// créditos ajenos, con decisión si quedan pagos sin deuda. El comportamiento con datos reales se prueba
// contra staging en scripts/op053-edicion-profunda-api.mjs; aquí, el manejo de respuestas y los contratos.
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleEditarItemsDespacho } from '../despachos.js'
import { validateOperator } from '../../lib/auth.js'

vi.mock('../../lib/auth.js', () => ({
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null), logToSystem: vi.fn(async () => null) }))

const despachos = fs.readFileSync(new URL('../despachos.js', import.meta.url), 'utf8')
const migracion = fs.readFileSync(new URL('../../../supabase/migrations/306_edicion_profunda_cxc.sql', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../../../src/components/despachos/EditarItemsDespachoModal.jsx', import.meta.url), 'utf8')

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const DESPACHO = 'dddddddd-4444-4444-8444-dddddddddddd'
const OPERADOR = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const ENV = { SUPABASE_URL: 'https://d.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 's', Authorization: 'Bearer s', 'Content-Type': 'application/json' }
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const req = (body) => new Request('https://w.test.invalid/api/despachos/editar-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const items = [{ producto_id: null, nombre_snap: 'X', cantidad: 1, precio_unit_usd: 10, orden: 0, origen: 'externo' }]
let llamadas

function base(respuestaRpc) {
  return async (url, init = {}) => {
    const u = String(url)
    llamadas.push({ u, metodo: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (u.includes('/rpc/editar_despacho_profundidad_con_cxc')) return respuestaRpc()
    // OP-2026-059: producción verifica el despacho (tenant y estado) antes de llamar a la función
    if (u.includes('/rest/v1/notas_despacho?') && u.includes('select=id,cuenta_id,estado')) {
      return jsonResponse([{ id: DESPACHO, cuenta_id: ACCOUNT, estado: 'despachada', total_usd: 10, flete_usd: 0, corte_usd: 0, descuento_total_usd: 0, forma_pago: '[]', forma_pago_cliente: null }])
    }
    return jsonResponse([])
  }
}

beforeEach(() => {
  validateOperator.mockResolvedValue({
    user: { id: ACCOUNT, operator_id: OPERADOR },
    operador: { id: OPERADOR, nombre: 'Test', rol: 'administracion', cuenta_id: ACCOUNT },
    headers, ip: '127.0.0.1',
  })
  llamadas = []
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('handleEditarItemsDespacho — una sola transacción', () => {
  it('llama a la función que edita artículos y cuenta juntos, con la decisión', async () => {
    vi.stubGlobal('fetch', vi.fn(base(() => jsonResponse({ ok: true, cxc_sincronizada: true, pasado_a_saldo_favor: 0 }))))
    const r = await handleEditarItemsDespacho(req({ despachoId: DESPACHO, items, pagos: '[]', destinoPagos: 'saldo_favor' }), ENV)
    expect(r.status).toBe(200)
    const rpc = llamadas.find(l => l.u.includes('/rpc/editar_despacho_profundidad_con_cxc'))
    expect(rpc.body).toMatchObject({ p_despacho_id: DESPACHO, p_destino_pagos: 'saldo_favor' })
    expect(llamadas.some(l => l.u.endsWith('/rpc/editar_despacho_profundidad'))).toBe(false)
  })

  it('no escribe en la cuenta del cliente por fuera de la función (sin DELETE/PATCH/POST sueltos)', async () => {
    vi.stubGlobal('fetch', vi.fn(base(() => jsonResponse({ ok: true }))))
    await handleEditarItemsDespacho(req({ despachoId: DESPACHO, items, pagos: '[]' }), ENV)
    expect(llamadas.filter(l => l.u.includes('/cuentas_por_cobrar') && l.metodo !== 'GET')).toHaveLength(0)
  })

  it('una decisión desconocida no se manda', async () => {
    vi.stubGlobal('fetch', vi.fn(base(() => jsonResponse({ ok: true }))))
    await handleEditarItemsDespacho(req({ despachoId: DESPACHO, items, pagos: '[]', destinoPagos: 'borrar' }), ENV)
    expect(llamadas.find(l => l.u.includes('/rpc/editar_despacho_profundidad_con_cxc')).body.p_destino_pagos).toBeNull()
  })

  it('pagos que quedarían sin deuda → 409 DECISION_PAGOS_REQUERIDA con el monto', async () => {
    vi.stubGlobal('fetch', vi.fn(base(() => new Response(JSON.stringify({ code: 'P0001', message: 'DECISION_PAGOS_REQUERIDA:300.00' }), { status: 400 }))))
    const r = await handleEditarItemsDespacho(req({ despachoId: DESPACHO, items, pagos: '[]' }), ENV)
    const body = await r.json()
    expect(r.status).toBe(409)
    expect(body).toMatchObject({ code: 'DECISION_PAGOS_REQUERIDA', pagos: { pagado_de_mas_nuevo: 300 } })
    expect(body.error).toMatch(/\$300\.00 que el cliente ya pagó quedarían sin deuda/)
  })

  it('saldo a favor insuficiente y vuelto ya usado → mensajes claros', async () => {
    vi.stubGlobal('fetch', vi.fn(base(() => new Response(JSON.stringify({ message: 'SALDO_FAVOR_INSUFICIENTE:100.00' }), { status: 400 }))))
    let r = await handleEditarItemsDespacho(req({ despachoId: DESPACHO, items, pagos: '[]' }), ENV)
    expect((await r.json()).error).toMatch(/solo tiene \$100\.00 de saldo a favor/)
    vi.stubGlobal('fetch', vi.fn(base(() => new Response(JSON.stringify({ message: 'VUELTO_YA_USADO:20.00' }), { status: 400 }))))
    r = await handleEditarItemsDespacho(req({ despachoId: DESPACHO, items, pagos: '[]' }), ENV)
    expect((await r.json()).error).toMatch(/vuelto .* ya se usó/)
  })
})

describe('contratos de la base y de la pantalla', () => {
  it('la base solo toca movimientos propios del despacho', () => {
    expect(migracion).toContain("descripcion ilike 'Pago con Saldo a Favor%'")
    expect(migracion).toContain("descripcion ilike 'Excedente de pago en Despacho%'")
    expect(migracion).toContain("'EDICION_PROFUNDA_CXC'")
    expect(migracion).toContain("raise exception 'DECISION_PAGOS_REQUERIDA:%'")
  })

  it('el servidor ya no borra "cualquier crédito" del despacho', () => {
    expect(despachos).not.toContain("dbMovimientos.find(m => m.tipo === 'credito')")
  })

  it('la pantalla pregunta qué hacer con el dinero y reenvía con la decisión', () => {
    expect(modal).toContain('data-testid="edicion-decision-pagos"')
    expect(modal).toContain("handleSave('saldo_favor')")
    expect(modal).toContain("handleSave('mantener')")
  })
})
