// api/handlers/__tests__/despachoPagos052.test.js
// OP-2026-052: reabrir o anular un despacho ya no hace desaparecer pagos (G2, N1) y el abono ya no
// inventa cargos (M6). El comportamiento completo se prueba contra staging en
// scripts/op052-reabrir-anular-api.mjs; aquí quedan los contratos que no deben romperse.
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRegistrarAbono } from '../cxc.js'
import { validateOperator } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'

vi.mock('../../lib/auth.js', () => ({
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))
vi.mock('../../lib/cxcUtils.js', () => ({ recalcularSaldoPendienteCliente: vi.fn(async () => null) }))

const despachos = fs.readFileSync(new URL('../despachos.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../../../worker.js', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../../../src/components/despachos/DevolverAnularModal.jsx', import.meta.url), 'utf8')
const vista = fs.readFileSync(new URL('../../../src/views/DespachosView.jsx', import.meta.url), 'utf8')
const migracion = fs.readFileSync(new URL('../../../supabase/migrations/305_despacho_pagos_al_reabrir_anular.sql', import.meta.url), 'utf8')

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const CLIENTE = 'cccccccc-3333-4333-8333-cccccccccccc'
const DESPACHO = 'dddddddd-4444-4444-8444-dddddddddddd'
const OPERADOR = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const ENV = { SUPABASE_URL: 'https://cxc.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test', 'Content-Type': 'application/json' }
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

describe('M6 — un abono no inventa deudas', () => {
  beforeEach(() => {
    validateOperator.mockResolvedValue({
      user: { id: ACCOUNT, operator_id: OPERADOR },
      operador: { id: OPERADOR, nombre: 'Test', rol: 'administracion', cuenta_id: ACCOUNT },
      headers, ip: '127.0.0.1',
    })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('abono a un despacho sin deuda → 400 claro, sin crear cargo ni abono, y queda anotado', async () => {
    const llamadas = []
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const u = String(url)
      llamadas.push({ u, metodo: init.method || 'GET' })
      if (u.includes('/notas_despacho')) return jsonResponse([{ cliente_id: CLIENTE, cliente_factura_id: null }])
      if (u.includes('/cuentas_por_cobrar') && u.includes('tipo=eq.cargo')) return jsonResponse([])
      return jsonResponse([])
    }))
    const r = await handleRegistrarAbono(new Request('https://w.test.invalid/api/cxc/abono', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteId: CLIENTE, monto: 50, despachoId: DESPACHO, formaPago: 'Zelle' }),
    }), ENV)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/no tiene deuda registrada/)
    expect(llamadas.filter(l => l.metodo === 'POST')).toHaveLength(0)
    expect(registrarAuditoria.mock.calls.map(c => c[2].accion)).toContain('ABONO_RECHAZADO')
  })
})

describe('G2 y N1 — contratos del servidor', () => {
  it('reabrir usa la función que maneja los pagos, no la reversión que borraba todo', () => {
    expect(despachos).toContain('rpc/reabrir_despacho_con_pagos')
    expect(despachos).not.toContain('rpc/revertir_entrega_finanzas_atomica_staging')
    expect(despachos).toContain('p_destino_pagos: destinoPagos')
  })

  it('la decisión de destino de pagos se valida si el servidor la exige (OP-064: ya no para pendientes)', () => {
    expect(despachos).toContain("['saldo_favor', 'otro_despacho', 'no_cobrado'].includes(destinoPagoAnotado)")
  })

  it('si hay dinero en juego y falta la decisión, responde 409 DECISION_PAGOS_REQUERIDA con los datos', () => {
    expect(despachos).toContain("code: 'DECISION_PAGOS_REQUERIDA', pagos: pagosEnJuego")
    expect(despachos).toContain("['mantener', 'saldo_favor'].includes(destinoPagos)")
  })

  it('un despacho ENTREGADO ya no se bloquea sin salida: pasa por la decisión de pagos', () => {
    // OP-2026-059 (producción): el bloqueo de siempre queda SOLO para 'despachada' (esa ruta borra los
    // movimientos del despacho y no tiene paso de decisión); el entregado usa reabrir_despacho_con_pagos.
    expect(despachos).toContain("if (['pendiente', 'anulada'].includes(nuevoEstado) && desp.estado === 'despachada') {")
    expect(despachos).toContain('OP-2026-059: un despacho ENTREGADO ya no se bloquea')
    expect(despachos).toContain("const usarReabrir = desp.estado === 'entregada'")
  })

  it('la consulta previa está publicada en el servidor', () => {
    expect(worker).toContain("'/api/despachos/pagos-en-juego' && request.method === 'GET'")
    expect(despachos).toContain('export async function handlePagosEnJuegoDespacho')
  })

  it('la base desenlaza los abonos reales (no los borra) y anota todo en la auditoría', () => {
    expect(migracion).toContain('set despacho_id = null')
    expect(migracion).toContain("'REABRIR_DESPACHO_PAGOS'")
    expect(migracion).toContain("'ANULAR_DESPACHO_PAGOS'")
    expect(migracion).toContain("raise exception 'DECISION_PAGOS_REQUERIDA'")
  })
})

describe('G2 y N1 — contratos de la pantalla', () => {
  it('el modal consulta al servidor (no lee la tabla directamente) y pide la decisión', () => {
    expect(modal).toContain('/api/despachos/pagos-en-juego?despachoId=')
    expect(modal).not.toContain("from('cuentas_por_cobrar')")
    expect(modal).toContain('data-testid="decision-pagos-reabrir"')
    expect(modal).toContain('data-testid="decision-pagos-anular"')
  })

  it('desaparece el aviso que aceptaba perder el pago', () => {
    expect(modal).not.toContain('Entiendo que esta acción no revierte el pago registrado')
  })

  it('anular desde la lista usa el mismo modal con motivo y decisión', () => {
    expect(vista).toContain('<_DevolverAnularModal') // producción usa el prefijo _ en los componentes de esta vista
    expect(vista).toContain('motivoAnulacion: motivo')
  })
})

describe('OP-2026-064 — anular un despacho por aprobar no pregunta por dinero', () => {
  it('la consulta y la anulación tratan los pagos anotados de un pendiente como intención', async () => {
    const { sinDecisionAnularPendiente } = await import('../despachos.js')
    const r = sinDecisionAnularPendiente({ estado: 'pendiente', total_anotado: 30, requiere_decision_anular: true })
    expect(r.requiere_decision_anular).toBe(false)
    expect(r.pagos_anotados_son_intencion).toBe(true)
    expect(despachos).toContain('pago_anotado_nunca_cobrado')
    expect(despachos).toContain('mínimo 5 caracteres')
    expect(despachos).toContain('anularSoloIntencion')
  })
})
