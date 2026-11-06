import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn() }))

import { validateOperator } from '../../lib/auth.js'
import { handleMisVentas } from '../misVentas.js'

const cuenta = '10000000-0000-4000-8000-000000000001'
const yo = '20000000-0000-4000-8000-000000000001'
const otro = '20000000-0000-4000-8000-000000000002'
const desp = '30000000-0000-4000-8000-000000000001'
const cli = '40000000-0000-4000-8000-000000000001'
const env = { SUPABASE_URL: 'https://staging.test.invalid' }

function auth(rol) {
  validateOperator.mockResolvedValue({ user: { id: cuenta }, operador: { id: yo, cuenta_id: cuenta, rol, nombre: 'Edgar' }, headers: {} })
}

let llamadas
function stubDb() {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (u, init = {}) => {
    const url = new URL(u)
    const tabla = url.pathname.split('/').at(-1)
    llamadas.push({ tabla, params: url.searchParams, metodo: init.method || 'GET' })
    const filas = {
      notas_despacho: [{ id: desp, numero: 7, cotizacion_id: null, cliente_id: cli, estado: 'entregada', creado_en: '2026-11-01T15:00:00Z', total_usd: 50, forma_pago: '[]' }],
      notas_despacho_items: [{ despacho_id: desp, codigo_snap: 'A', nombre_snap: 'Art', unidad_snap: 'und', cantidad: 2, precio_unit_usd: 25, total_linea_usd: 50, orden: 1 }],
      clientes: [{ id: cli, nombre: 'Cliente', rif_cedula: 'J-1' }],
      comisiones: [{ despachoid: desp, totalcomision: 2 }],
    }[tabla] || []
    return new Response(JSON.stringify(filas), { status: 200 })
  }))
}

const pedir = query => handleMisVentas(new Request(`https://w.test/api/reportes/mis-ventas?${query}`), env)

beforeEach(() => { vi.clearAllMocks(); stubDb() })

describe('GET /api/reportes/mis-ventas', () => {
  it('solo trae ventas de los clientes del operador de la sesión, de su cuenta, aprobadas y en el rango', async () => {
    auth('vendedor')
    const res = await pedir('desde=2026-10-30&hasta=2026-11-05')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resumen).toEqual({ totalUsd: 50, despachos: 1, clientes: 1, unidades: 2, comisionUsd: 2 })
    expect(body.vendedor).toEqual({ nombre: 'Edgar', rol: 'vendedor' })

    const d = llamadas.find(l => l.tabla === 'notas_despacho').params
    // las ventas se buscan por CLIENTES DEL VENDEDOR, no por quién hizo el despacho
    expect(d.get('vendedor_id')).toBeNull()
    expect(d.get('cliente_id')).toBeNull() // se pide el rango completo y el cruce con sus clientes se hace en el servidor
    const cl = llamadas.find(l => l.tabla === 'clientes').params
    expect(cl.get('vendedor_id')).toBe(`eq.${yo}`)
    expect(d.get('cuenta_id')).toBe(`eq.${cuenta}`)
    expect(d.get('estado')).toBe('in.(despachada,entregada)')
    expect(d.getAll('creado_en')).toEqual(['gte.2026-10-30T00:00:00-04:00', 'lt.2026-11-06T00:00:00-04:00'])
    // todo lo demás también queda limitado a la cuenta, y las comisiones al operador
    for (const l of llamadas.filter(l => l.tabla !== 'comisiones')) expect(l.params.get('cuenta_id')).toBe(`eq.${cuenta}`)
    const c = llamadas.find(l => l.tabla === 'comisiones').params
    expect(c.get('cuentaid')).toBe(`eq.${cuenta}`)
    expect(c.get('vendedorid')).toBe(`eq.${yo}`)
    expect(llamadas.every(l => l.metodo === 'GET')).toBe(true)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
  })

  it('no acepta pedir ventas de otro vendedor ni filtros extra', async () => {
    auth('vendedor')
    for (const extra of [`vendedorId=${otro}`, `vendedor_id=${otro}`, `cuenta_id=${cuenta}`, 'rol=jefe']) {
      const res = await pedir(`desde=2026-10-30&hasta=2026-11-05&${extra}`)
      expect(res.status).toBe(400)
    }
    expect(llamadas).toHaveLength(0)
  })

  it('vendedor sin comisión: no consulta ni muestra comisiones', async () => {
    auth('vendedor_sin_comision')
    const body = await (await pedir('desde=2026-10-30&hasta=2026-11-05')).json()
    expect(body.resumen.comisionUsd).toBeNull()
    expect(llamadas.some(l => l.tabla === 'comisiones')).toBe(false)
  })

  it('el supervisor ve solo lo suyo', async () => {
    auth('supervisor')
    await pedir('desde=2026-10-30&hasta=2026-11-05')
    expect(llamadas.find(l => l.tabla === 'clientes').params.get('vendedor_id')).toBe(`eq.${yo}`)
  })

  it('sin clientes asignados: no consulta despachos y devuelve vacío', async () => {
    auth('vendedor')
    vi.stubGlobal('fetch', vi.fn(async (u) => { llamadas.push({ tabla: new URL(u).pathname.split('/').at(-1), params: new URL(u).searchParams }); return new Response('[]', { status: 200 }) }))
    const body = await (await pedir('desde=2026-10-30&hasta=2026-11-05')).json()
    expect(body.resumen.despachos).toBe(0)
    expect(body.despachos).toEqual([])
  })

  it('de los despachos del rango solo devuelve los de SUS clientes (el cruce se hace en el servidor)', async () => {
    auth('vendedor')
    const ajeno = '40000000-0000-4000-8000-0000000000ff'
    vi.stubGlobal('fetch', vi.fn(async (u) => {
      const tabla = new URL(u).pathname.split('/').at(-1)
      const filas = {
        notas_despacho: [
          { id: desp, numero: 7, cotizacion_id: null, cliente_id: cli, estado: 'entregada', creado_en: '2026-11-01T15:00:00Z', total_usd: 50, forma_pago: '[]' },
          { id: '30000000-0000-4000-8000-0000000000aa', numero: 8, cotizacion_id: null, cliente_id: ajeno, estado: 'entregada', creado_en: '2026-11-01T16:00:00Z', total_usd: 999, forma_pago: '[]' },
        ],
        clientes: [{ id: cli, nombre: 'Cliente', rif_cedula: 'J-1' }],
      }[tabla] || []
      return new Response(JSON.stringify(filas), { status: 200 })
    }))
    const body = await (await pedir('desde=2026-10-30&hasta=2026-11-05')).json()
    expect(body.despachos.map(d => d.numero)).toEqual([7])
    expect(body.resumen.totalUsd).toBe(50)
  })

  it('otros roles no pueden usarlo', async () => {
    for (const rol of ['jefe', 'administracion', 'logistica', 'desarrollador']) {
      auth(rol)
      expect((await pedir('desde=2026-10-30&hasta=2026-11-05')).status).toBe(403)
    }
  })

  it('rango inválido → 400 sin consultar la base', async () => {
    auth('vendedor')
    expect((await pedir('desde=2026-11-05&hasta=2026-10-01')).status).toBe(400)
    expect((await pedir('hasta=2026-10-01')).status).toBe(400)
    expect(llamadas).toHaveLength(0)
  })

  it('sin sesión de operador → responde el error de autenticación', async () => {
    validateOperator.mockResolvedValue({ error: new Response('{}', { status: 401 }) })
    expect((await pedir('desde=2026-10-30&hasta=2026-11-05')).status).toBe(401)
  })
})
