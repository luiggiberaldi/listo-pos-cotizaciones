// OP-2026-065: limpieza nocturna de cotizaciones (opción B)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCleanupCotizaciones } from '../limpiezaCotizaciones.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' }
const AHORA = new Date('2026-11-25T03:00:00Z')

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

// Simula Supabase: cada llamada se anota y responde según la ruta y el método.
function simular({ candadoMio = true, inactivas = [], antiguas = [], auditoriaFalla = false, deleteBloqueado = [] } = {}) {
  const llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = String(url)
    const metodo = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    llamadas.push({ u, metodo, body })
    if (u.includes('/system_logs') && metodo === 'POST' && body?.mensaje?.includes('iniciada')) return resp([{ id: 'mia' }], 201)
    if (u.includes('/system_logs') && metodo === 'GET') return resp([{ id: candadoMio ? 'mia' : 'otra' }])
    if (u.includes('/system_logs')) return resp(null, 201)
    if (u.includes('/auditoria')) return auditoriaFalla ? resp({ message: 'fallo' }, 500) : resp(null, 201)
    if (u.includes('/cotizaciones?') && metodo === 'GET' && u.includes('estado=in.(borrador,enviada)')) return resp(inactivas)
    if (u.includes('/cotizaciones?') && metodo === 'GET' && u.includes('estado=in.(vencida,rechazada,anulada)')) return resp(antiguas)
    if (u.includes('/cotizaciones?') && metodo === 'PATCH') {
      const ids = u.match(/id=in\.\(([^)]*)\)/)[1].split(',')
      return resp(ids.map(id => ({ id })))
    }
    if (u.includes('/cotizaciones?') && metodo === 'DELETE') {
      const id = u.match(/id=eq\.([^&]*)/)[1]
      return deleteBloqueado.includes(id) ? resp({ message: 'violates foreign key' }, 409) : resp([{ id }])
    }
    throw new Error(`llamada no esperada: ${metodo} ${u}`)
  }))
  return llamadas
}

beforeEach(() => vi.unstubAllGlobals())

describe('limpieza nocturna de cotizaciones (OP-2026-065)', () => {
  it('si otra ejecución ya tomó el candado, no hace nada (una sola vez por noche)', async () => {
    const llamadas = simular({ candadoMio: false, inactivas: [{ id: 'c1', estado: 'enviada' }] })
    const r = await runCleanupCotizaciones(ENV, { ahora: AHORA })
    expect(r.omitida).toBe(true)
    expect(llamadas.some(l => l.u.includes('/cotizaciones'))).toBe(false)
  })

  it('cuenta los 30 días desde la última modificación, no desde la creación', async () => {
    const llamadas = simular()
    await runCleanupCotizaciones(ENV, { ahora: AHORA })
    const lectura = llamadas.find(l => l.metodo === 'GET' && l.u.includes('estado=in.(borrador,enviada)'))
    expect(lectura.u).toContain('actualizado_en=lt.2026-10-26T03:00:00.000Z')
    expect(lectura.u).not.toContain('creado_en')
  })

  it('enviada → vencida y borrador → anulada, cada una con su registro de auditoría', async () => {
    const llamadas = simular({
      inactivas: [
        { id: 'e1', numero: 10, estado: 'enviada', cliente_id: 'cl', vendedor_id: 'v', total_usd: 50, cuenta_id: 'cta' },
        { id: 'b1', numero: 11, estado: 'borrador', cliente_id: 'cl', vendedor_id: 'v', total_usd: 20, cuenta_id: 'cta' },
      ],
    })
    const r = await runCleanupCotizaciones(ENV, { ahora: AHORA })
    expect(r).toMatchObject({ vencidas: 1, anuladas: 1, eliminadas: 0, errors: [] })
    const patches = llamadas.filter(l => l.metodo === 'PATCH')
    expect(patches.map(p => p.body.estado).sort()).toEqual(['anulada', 'vencida'])
    const auditorias = llamadas.filter(l => l.u.includes('/auditoria')).flatMap(l => l.body)
    expect(auditorias.map(a => a.accion).sort()).toEqual(['ANULAR_BORRADOR_AUTO', 'VENCER_COTIZACION_AUTO'])
    expect(auditorias.every(a => a.cuenta_id === 'cta' && a.meta.numero)).toBe(true)
  })

  it('nunca toca aceptadas: solo lee borrador/enviada y vencida/rechazada/anulada', async () => {
    const llamadas = simular()
    await runCleanupCotizaciones(ENV, { ahora: AHORA })
    expect(llamadas.some(l => l.u.includes('aceptada'))).toBe(false)
  })

  it('al año guarda una copia completa ANTES de borrar', async () => {
    const llamadas = simular({ antiguas: [{ id: 'a1', numero: 5, estado: 'anulada', cuenta_id: 'cta', cotizacion_items: [{ id: 'i1', nombre_snap: 'Cabilla' }] }] })
    const r = await runCleanupCotizaciones(ENV, { ahora: AHORA })
    expect(r.eliminadas).toBe(1)
    const iCopia = llamadas.findIndex(l => l.u.includes('/auditoria') && l.body[0].accion === 'ELIMINAR_COTIZACION_AUTO')
    const iBorrado = llamadas.findIndex(l => l.metodo === 'DELETE')
    expect(iCopia).toBeGreaterThanOrEqual(0)
    expect(iCopia).toBeLessThan(iBorrado)
    const copia = llamadas[iCopia].body[0].meta
    expect(copia.copia_items).toHaveLength(1)
    expect(copia.copia_cotizacion.id).toBe('a1')
    const lectura = llamadas.find(l => l.metodo === 'GET' && l.u.includes('estado=in.(vencida,rechazada,anulada)'))
    expect(lectura.u).toContain('actualizado_en=lt.2025-11-25T03:00:00.000Z')
  })

  it('si la copia no se guarda, NO se borra', async () => {
    const llamadas = simular({ auditoriaFalla: true, antiguas: [{ id: 'a1', numero: 5, estado: 'vencida', cotizacion_items: [] }] })
    const r = await runCleanupCotizaciones(ENV, { ahora: AHORA })
    expect(r.eliminadas).toBe(0)
    expect(r.omitidas).toBe(1)
    expect(llamadas.some(l => l.metodo === 'DELETE')).toBe(false)
  })

  it('si la base impide borrar (tiene despacho o comisiones), la deja y sigue con las demás', async () => {
    simular({
      deleteBloqueado: ['a1'],
      antiguas: [
        { id: 'a1', numero: 5, estado: 'anulada', cotizacion_items: [] },
        { id: 'a2', numero: 6, estado: 'rechazada', cotizacion_items: [] },
      ],
    })
    const r = await runCleanupCotizaciones(ENV, { ahora: AHORA })
    expect(r.eliminadas).toBe(1)
    expect(r.omitidas).toBe(1)
  })
})
