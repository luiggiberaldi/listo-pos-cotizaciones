// OP-2026-065 — prueba del servidor de STAGING contra la base real de staging.
// Lee la llave de servicio de construacero-staging/.dev.vars y se niega a correr
// si la llave no es del proyecto de staging (spupqgkdsgohxxfoxydl).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const REF_STAGING = 'spupqgkdsgohxxfoxydl'
const raiz = new URL('../../../', import.meta.url)
const vars = Object.fromEntries(readFileSync(new URL('construacero-staging/.dev.vars', raiz), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]))
const KEY = vars.SUPABASE_SERVICE_KEY
const ref = JSON.parse(Buffer.from(KEY.split('.')[1], 'base64url')).ref
if (ref !== REF_STAGING) throw new Error(`Llave de otro proyecto (${ref}); esta prueba solo corre en staging`)
const ENV = { SUPABASE_URL: `https://${REF_STAGING}.supabase.co`, SUPABASE_SERVICE_KEY: KEY }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const auth = { cuenta: null, operador: null }
vi.mock('../../../construacero-staging/api/lib/auth.js', async (orig) => ({
  ...(await orig()),
  verifyAuth: vi.fn(async () => ({ id: auth.cuenta, operator_id: auth.operador })),
  verifySupervisor: vi.fn(async () => false),
}))

const { handleGuardarCotizacion } = await import('../../../construacero-staging/api/handlers/cotizaciones.js')
const { runCleanupCotizaciones } = await import('../../../construacero-staging/api/lib/limpiezaCotizaciones.js')

async function rest(path, opts = {}) {
  const r = await fetch(`${ENV.SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
  const t = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${path}: ${t}`)
  return t ? JSON.parse(t) : null
}

let cliente
const nuevoId = crypto.randomUUID()
const pendientes = []

function req(body) {
  return new Request('https://app.test/api/cotizaciones/guardar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
const item = (n, precio) => ({ nombre_snap: `Prueba OP-065 ${n}`, unidad_snap: 'und', cantidad: 1, precio_unit_usd: precio, total_linea_usd: precio, descuento_pct: 0, origen: 'externo', producto_id: null })
const cabecera = (total) => ({ cliente_id: cliente.id, subtotal_usd: total, total_usd: total, descuento_global_pct: 0, descuento_usd: 0, costo_envio_usd: 0, notas_internas: 'PRUEBA OP-2026-065 (se borra sola)' })

beforeAll(async () => {
  const [vend] = await rest('usuarios?activo=eq.true&rol=eq.vendedor&select=id,cuenta_id&limit=1')
  auth.cuenta = vend.cuenta_id
  auth.operador = vend.id
  ;[cliente] = await rest(`clientes?cuenta_id=eq.${vend.cuenta_id}&activo=eq.true&vendedor_id=eq.${vend.id}&select=id&limit=1`)
  if (!cliente) [cliente] = await rest(`clientes?cuenta_id=eq.${vend.cuenta_id}&activo=eq.true&select=id&limit=1`)
})

afterAll(async () => {
  await rest(`cotizaciones?id=eq.${nuevoId}`, { method: 'DELETE' }).catch(() => {})
})

describe('OP-2026-065 en staging', () => {
  it('crear con identidad propia y reintentar: una sola cotización', async () => {
    const env = { ...ENV, waitUntil: p => pendientes.push(p) }
    const r1 = await handleGuardarCotizacion(req({ nuevoId, headerData: cabecera(10), items: [item(1, 10)] }), env)
    expect(r1.status).toBe(200)
    expect((await r1.json()).id).toBe(nuevoId)
    const r2 = await handleGuardarCotizacion(req({ nuevoId, headerData: cabecera(10), items: [item(1, 10)] }), env)
    expect(r2.status).toBe(200)
    expect((await r2.json()).id).toBe(nuevoId)
    const filas = await rest(`cotizaciones?id=eq.${nuevoId}&select=id,estado`)
    expect(filas).toHaveLength(1)
    const items = await rest(`cotizacion_items?cotizacion_id=eq.${nuevoId}&select=id`)
    expect(items).toHaveLength(1)
  })

  it('editar reemplaza los productos sin dejar repetidos ni perder', async () => {
    const r = await handleGuardarCotizacion(req({ cotizacionId: nuevoId, headerData: cabecera(30), items: [item(2, 10), item(3, 20)] }), { ...ENV, waitUntil: p => pendientes.push(p) })
    expect(r.status).toBe(200)
    const items = await rest(`cotizacion_items?cotizacion_id=eq.${nuevoId}&select=nombre_snap&order=orden`)
    expect(items.map(i => i.nombre_snap)).toEqual(['Prueba OP-065 2', 'Prueba OP-065 3'])
  })

  it('la auditoría CREAR_COTIZACION y EDITAR_COTIZACION quedan guardadas', async () => {
    await Promise.all(pendientes)
    const filas = await rest(`auditoria?entidad_id=eq.${nuevoId}&select=accion`)
    const acciones = filas.map(f => f.accion)
    expect(acciones).toContain('CREAR_COTIZACION')
    expect(acciones).toContain('EDITAR_COTIZACION')
  })

  it('limpieza nocturna: corre sin errores y, lanzada dos veces a la vez, solo trabaja una', async () => {
    const [a, b] = await Promise.all([runCleanupCotizaciones(ENV), runCleanupCotizaciones(ENV)])
    console.log('Limpieza staging:', JSON.stringify(a), JSON.stringify(b))
    expect([a.omitida, b.omitida].filter(Boolean)).toHaveLength(1)
    const trabajo = a.omitida ? b : a
    expect(trabajo.errors).toEqual([])
    // La cotización de prueba es de hoy: no se toca.
    const [cot] = await rest(`cotizaciones?id=eq.${nuevoId}&select=estado`)
    expect(cot.estado).toBe('borrador')
  })
})
