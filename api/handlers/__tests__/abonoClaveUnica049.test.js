// api/handlers/__tests__/abonoClaveUnica049.test.js
// OP-2026-049 (G4) + OP-2026-050 (N8, N9, I2, auditoría de rechazos): un abono no se guarda
// dos veces, el monto y el detalle se validan con mensajes claros, el guardado se hace en un
// solo paso dentro de la base (función cxc_registrar_abono_atomico) y todo rechazo queda en
// la auditoría como ABONO_RECHAZADO.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRegistrarAbono, leerMontoAbono, validarDetallePago } from '../cxc.js'
import { validateOperator } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'

vi.mock('../../lib/auth.js', () => ({
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))
vi.mock('../../lib/cxcUtils.js', () => ({ recalcularSaldoPendienteCliente: vi.fn(async () => null) }))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const CLIENTE = 'cccccccc-3333-4333-8333-cccccccccccc'
const OPERADOR = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const ENV = { SUPABASE_URL: 'https://cxc.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test', 'Content-Type': 'application/json' }
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const req = (body) => new Request('https://worker.test.invalid/api/cxc/abono', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const fp = (lineas) => JSON.stringify(lineas)
let fetchMock

// Base simulada: la función de la base responde según `estado.rpc(cuerpo)`.
function base(estado) {
  return async (url, init = {}) => {
    const u = String(url)
    if (u.includes('/rpc/cxc_registrar_abono_atomico')) {
      const cuerpo = JSON.parse(init.body)
      estado.llamadas = [...(estado.llamadas || []), cuerpo]
      return estado.rpc ? estado.rpc(cuerpo) : jsonResponse({ id: 'nuevo-abono', nuevo_saldo: 4900, idempotent: false })
    }
    return jsonResponse([])
  }
}
const errorBase = (message) => new Response(JSON.stringify({ code: 'P0001', message }), { status: 400 })
const rechazos = () => registrarAuditoria.mock.calls.map(c => c[2]).filter(a => a.accion === 'ABONO_RECHAZADO')

beforeEach(() => {
  validateOperator.mockResolvedValue({
    user: { id: ACCOUNT, operator_id: OPERADOR },
    operador: { id: OPERADOR, nombre: 'Test', rol: 'administracion', cuenta_id: ACCOUNT },
    headers, ip: '127.0.0.1',
  })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('handleRegistrarAbono — guardado en un solo paso (I2) con huella única (G4)', () => {
  it('manda a la base la huella, el monto, el operador y si se confirmó un posible repetido', async () => {
    const estado = {}
    fetchMock.mockImplementation(base(estado))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 100, formaPago: 'Zelle', idempotencyKey: 'k-1' }), ENV)
    expect(r.status).toBe(200)
    expect(estado.llamadas).toHaveLength(1)
    expect(estado.llamadas[0]).toMatchObject({ p_cliente_id: CLIENTE, p_monto: 100, p_idempotency_key: 'k-1', p_registrado_por: OPERADOR, p_confirmar_duplicado: false })
  })

  it('no hace inserciones sueltas: el abono solo se guarda dentro de la función de la base', async () => {
    const estado = {}
    fetchMock.mockImplementation(base(estado))
    await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 100, idempotencyKey: 'k-1' }), ENV)
    const postsSueltos = fetchMock.mock.calls.filter(([u, i]) => (i?.method === 'POST') && String(u).endsWith('/cuentas_por_cobrar'))
    expect(postsSueltos).toHaveLength(0)
  })

  it('reintento con la misma huella: devuelve el abono ya guardado', async () => {
    fetchMock.mockImplementation(base({ rpc: () => jsonResponse({ id: 'abono-previo', nuevo_saldo: 400, idempotent: true }) }))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 100, idempotencyKey: 'k-1' }), ENV)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ id: 'abono-previo', idempotent: true })
  })

  it('huella usada para otro cliente → 409 y queda anotado el rechazo', async () => {
    fetchMock.mockImplementation(base({ rpc: () => errorBase('CLAVE_DE_OTRO_CLIENTE') }))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 100, idempotencyKey: 'k-ajena' }), ENV)
    expect(r.status).toBe(409)
    expect(rechazos()).toHaveLength(1)
  })

  it('dos operadores por el saldo completo: la base rechaza el segundo con mensaje claro', async () => {
    fetchMock.mockImplementation(base({ rpc: () => errorBase('MONTO_SUPERA_SALDO:0.00') }))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 534, idempotencyKey: 'k-b' }), ENV)
    const body = await r.json()
    expect(r.status).toBe(400)
    expect(body.code).toBe('MONTO_SUPERA_DEUDA')
    expect(body.error).toMatch(/es mayor que la deuda del cliente \(\$0\.00\)/)
    expect(rechazos()[0].meta).toMatchObject({ monto_intentado: 534, status: 400 })
  })
})

describe('handleRegistrarAbono — aviso de posible abono repetido (G4)', () => {
  const previo = { id: 'abono-igual', creado_en: new Date(Date.now() - 30_000).toISOString(), referencia: 'ENZO CONFIRMO' }

  it('abono igual reciente → 409 POSIBLE_DUPLICADO, no guarda y anota el intento', async () => {
    fetchMock.mockImplementation(base({ rpc: () => jsonResponse({ posible_duplicado: previo }) }))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 1000, idempotencyKey: 'k-2' }), ENV)
    const body = await r.json()
    expect(r.status).toBe(409)
    expect(body.code).toBe('POSIBLE_DUPLICADO')
    expect(body.error).toMatch(/Ya se registró un abono de \$1000\.00/)
    expect(body.error).toMatch(/ENZO CONFIRMO/)
    expect(rechazos()).toHaveLength(1)
  })

  it('si el operador confirma que es otro pago, se lo dice a la base', async () => {
    const estado = {}
    fetchMock.mockImplementation(base(estado))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 1000, idempotencyKey: 'k-3', confirmarDuplicado: true }), ENV)
    expect(r.status).toBe(200)
    expect(estado.llamadas[0].p_confirmar_duplicado).toBe(true)
  })
})

describe('N9 — monto inválido con mensaje claro (nunca error técnico 500)', () => {
  it.each([['abc'], [''], [null], [0], [-5], ['0.001'], [Infinity]])('monto %p → 400 sin llamar a la base', async (monto) => {
    const estado = {}
    fetchMock.mockImplementation(base(estado))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto, formaPago: 'Zelle' }), ENV)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/monto del abono/i)
    expect(estado.llamadas || []).toHaveLength(0)
    expect(rechazos()).toHaveLength(1)
  })

  it('acepta montos escritos como texto numérico y los redondea a centavos', () => {
    expect(leerMontoAbono('12.345')).toEqual({ monto: 12.35 })
    expect(leerMontoAbono(80)).toEqual({ monto: 80 })
  })
})

describe('N8 — el detalle de formas de pago debe sumar el monto del abono', () => {
  it('$40 con detalle de $10 → 400 con las dos cifras', async () => {
    const estado = {}
    fetchMock.mockImplementation(base(estado))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 40, formaPago: fp([{ metodo: 'Zelle', monto: 10 }]) }), ENV)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/suman \$10\.00 pero el abono es de \$40\.00/)
    expect(estado.llamadas || []).toHaveLength(0)
    expect(rechazos()).toHaveLength(1)
  })

  it('Zelle $50 + Efectivo $30 = $80 → se guarda', async () => {
    fetchMock.mockImplementation(base({}))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 80, formaPago: fp([{ metodo: 'Zelle', monto: 50 }, { metodo: 'Efectivo $', monto: 30 }]) }), ENV)
    expect(r.status).toBe(200)
  })

  it('reglas del detalle', () => {
    expect(validarDetallePago('Zelle', 10)).toEqual({ ok: true })
    expect(validarDetallePago(null, 10)).toEqual({ ok: true })
    expect(validarDetallePago(fp([{ metodo: 'Zelle', monto: 10.004 }]), 10)).toEqual({ ok: true })
    expect(validarDetallePago('[roto', 10).error).toMatch(/dañado/)
    expect(validarDetallePago(fp([]), 10).error).toMatch(/Falta/)
    expect(validarDetallePago(fp([{ metodo: 'Zelle', monto: 'x' }]), 10).error).toMatch(/monto válido/)
    expect(validarDetallePago(fp([{ monto: 10 }]), 10).error).toMatch(/método/)
  })
})

describe('Auditoría de intentos rechazados', () => {
  it('un rol sin permiso queda anotado', async () => {
    validateOperator.mockResolvedValue({
      user: { id: ACCOUNT, operator_id: OPERADOR },
      operador: { id: OPERADOR, nombre: 'Vendedor', rol: 'vendedor', cuenta_id: ACCOUNT },
      headers, ip: '127.0.0.1',
    })
    fetchMock.mockImplementation(base({}))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 10 }), ENV)
    expect(r.status).toBe(403)
    expect(rechazos()[0]).toMatchObject({ categoria: 'FINANZAS', usuarioRol: 'vendedor', entidadId: CLIENTE })
  })

  it('un error inesperado de la base queda anotado como rechazo (500)', async () => {
    fetchMock.mockImplementation(base({ rpc: () => new Response('boom', { status: 500 }) }))
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 10 }), ENV)
    expect(r.status).toBe(500)
    expect(rechazos()).toHaveLength(1)
  })

  it('un abono correcto NO crea anotación desde el servidor (la hace la base en el mismo paso)', async () => {
    fetchMock.mockImplementation(base({}))
    await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 10 }), ENV)
    expect(registrarAuditoria).not.toHaveBeenCalled()
  })
})
