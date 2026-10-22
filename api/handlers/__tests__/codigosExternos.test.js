// api/handlers/__tests__/codigosExternos.test.js
// Corrección de códigos de productos externos antes de aprobar un despacho.
// Garantías: solo roles de administración, solo despachos 'pendiente', solo
// líneas externas (producto_id IS NULL), y nunca tocar inventario/precios.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
  getOperatorRole: vi.fn(),
  verifySupervisor: vi.fn(),
  verifyPrivileged: vi.fn(),
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../lib/cxcUtils.js', () => ({
  recalcularSaldoPendienteCliente: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'
import { handleEditarCodigosExternos } from '../despachos.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'test' }
const cuentaId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const operatorId = '11111111-1111-4111-8111-111111111111'
const despachoId = '22222222-2222-4222-8222-222222222222'
const itemExternoId = '33333333-3333-4333-8333-333333333333'
const itemInventarioId = '44444444-4444-4444-8444-444444444444'

function auth(rol = 'administracion') {
  return {
    user: { id: cuentaId, operator_id: operatorId },
    operador: { id: operatorId, nombre: 'Operador Test', rol, color: '#000000', cuenta_id: cuentaId },
    headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

function post(body) {
  return new Request('https://app.test/api/despachos/editar-codigos-externos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * fetchMock mínimo para el handler:
 *  - GET  /notas_despacho?id=…            → estado del despacho
 *  - GET  /notas_despacho_items?…producto_id=is.null → solo externos
 *  - PATCH /notas_despacho_items?id=…      → actualización del código
 */
function installFetch({ estado = 'pendiente', externos } = {}) {
  const calls = []
  const externosRows = externos ?? [
    { id: itemExternoId, codigo_snap: 'EXT1234567', nombre_snap: 'CINTA EXTERNA' },
  ]
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase()
    const call = { url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined }
    calls.push(call)

    if (String(url).includes('/notas_despacho?id=')) {
      return new Response(JSON.stringify([{ id: despachoId, estado, numero: 4127 }]), { status: 200 })
    }
    if (String(url).includes('/notas_despacho_items?')) {
      if (method === 'PATCH') {
        // Devuelve la fila actualizada (Prefer: return=representation)
        return new Response(JSON.stringify([{ id: itemExternoId, codigo_snap: call.body.codigo_snap }]), { status: 200 })
      }
      // La consulta del handler filtra producto_id=is.null: solo externos
      expect(String(url)).toContain('producto_id=is.null')
      return new Response(JSON.stringify(externosRows), { status: 200 })
    }

    throw new Error(`[test] llamada no declarada: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

async function bodyOf(response) {
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  validateOperator.mockResolvedValue(auth())
})

describe('handleEditarCodigosExternos — guardas de acceso', () => {
  it('rechaza roles fuera de administración/jefatura/desarrollo', async () => {
    validateOperator.mockResolvedValue(auth('vendedor'))
    const { calls } = installFetch()
    const res = await bodyOf(await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemExternoId, codigo: 'CEM-001' }],
    }), ENV))

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/permiso/i)
    expect(calls.length).toBe(0) // ni siquiera consulta la base
  })

  it('rechaza corregir códigos si el despacho ya fue aprobado', async () => {
    installFetch({ estado: 'despachada' })
    const res = await bodyOf(await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemExternoId, codigo: 'CEM-001' }],
    }), ENV))

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/antes de aprobar/i)
  })
})

describe('handleEditarCodigosExternos — solo líneas externas', () => {
  it('rechaza un itemId que no corresponde a una línea externa del despacho', async () => {
    const { calls } = installFetch()
    const res = await bodyOf(await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemInventarioId, codigo: 'CEM-001' }],
    }), ENV))

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/productos externos/i)
    expect(calls.some(c => c.method === 'PATCH')).toBe(false) // no toca nada
  })

  it('rechaza códigos vacíos o demasiado largos', async () => {
    installFetch()
    const vacio = await bodyOf(await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemExternoId, codigo: '   ' }],
    }), ENV))
    expect(vacio.status).toBe(400)
    expect(vacio.body.error).toMatch(/vacío/i)

    const largo = await bodyOf(await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemExternoId, codigo: 'X'.repeat(41) }],
    }), ENV))
    expect(largo.status).toBe(400)
    expect(largo.body.error).toMatch(/40 caracteres/i)
  })

  it('acepta códigos con espacios raros del teclado, pero los normaliza', async () => {
    installFetch()
    const res = await bodyOf(await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemExternoId, codigo: '  cem-001  ' }],
    }), ENV))

    expect(res.status).toBe(200)
    expect(res.body.actualizados).toBe(1)
  })
})

describe('handleEditarCodigosExternos — actualización', () => {
  it('hace PATCH solo del codigo_snap, con filtro de externo y sin tocar inventario', async () => {
    const { calls } = installFetch()
    const res = await bodyOf(await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemExternoId, codigo: 'CEM-001' }],
    }), ENV))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, actualizados: 1 })

    const patches = calls.filter(c => c.method === 'PATCH')
    expect(patches.length).toBe(1)
    expect(patches[0].url).toContain(`id=eq.${itemExternoId}`)
    expect(patches[0].url).toContain(`despacho_id=eq.${despachoId}`)
    expect(patches[0].url).toContain('producto_id=is.null')
    // Solo cambia el código: ni cantidades, ni precios, ni stock
    expect(patches[0].body).toEqual({ codigo_snap: 'CEM-001' })

    // Ninguna llamada tocó tablas de inventario o movimientos
    expect(calls.every(c => !c.url.includes('inventario') && !c.url.includes('productos'))).toBe(true)
  })

  it('registra la auditoría del cambio con el código anterior y el nuevo', async () => {
    installFetch()
    await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemExternoId, codigo: 'CEM-001' }],
    }), ENV)

    expect(registrarAuditoria).toHaveBeenCalledTimes(1)
    const [, , payload] = registrarAuditoria.mock.calls[0]
    expect(payload.accion).toBe('CORREGIR_CODIGO_EXTERNO')
    expect(payload.entidadId).toBe(despachoId)
    expect(payload.meta.cambios).toEqual([
      { item_id: itemExternoId, nombre: 'CINTA EXTERNA', codigo_anterior: 'EXT1234567', codigo_nuevo: 'CEM-001' },
    ])
  })

  it('no hace PATCH ni auditoría cuando el código no cambió', async () => {
    const { calls } = installFetch()
    const res = await bodyOf(await handleEditarCodigosExternos(post({
      despachoId,
      codigos: [{ itemId: itemExternoId, codigo: 'EXT1234567' }],
    }), ENV))

    expect(res.status).toBe(200)
    expect(res.body.actualizados).toBe(0)
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
    expect(registrarAuditoria).not.toHaveBeenCalled()
  })
})
