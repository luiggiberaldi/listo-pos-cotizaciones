import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/supabase/client', () => ({ default: {} }))
vi.mock('../../hooks/useComisiones', () => ({ fetchComisionesTodas: vi.fn() }))

import { cargarEventosComisionesParaPdf } from '../../services/comisionesPdfHelper'

describe('OP-2026-101 Fase 2: paginación y filtrado en comisionesPdfHelper', () => {
  it('trae >1000 eventos vía fetchEventosFn, excluye roles administrativos y consulta cotizaciones en tandas de 100', async () => {
    const eventos = Array.from({ length: 250 }, (_, i) => ({
      id: `ev-${i}`,
      vendedor: {
        id: i % 5 === 0 ? 'admin-1' : (i % 2 === 0 ? 'ext-1' : 'int-1'),
        rol: i % 5 === 0 ? 'administracion' : 'vendedor',
        es_externo: i % 2 === 0 && i % 5 !== 0,
      },
      comisiones: {
        cotizacionid: `cot-${i}`,
      },
    }))

    const fetchEventosFn = vi.fn(async () => ({ data: eventos }))
    const batchesVistos = []
    const supabaseClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(async (_col, batch) => {
            batchesVistos.push(batch.length)
            return {
              data: batch.map(id => ({ id, numero: 100, cliente: { id: 'c1', nombre: 'TEST' } })),
              error: null,
            }
          }),
        })),
      })),
    }

    const resTodos = await cargarEventosComisionesParaPdf({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      tipoFiltro: 'todos',
      fetchEventosFn,
      supabaseClient,
    })

    // 250 totales - 50 de administracion = 200 eventos válidos
    expect(resTodos.rawEvents).toHaveLength(250)
    expect(resTodos.filteredEvents).toHaveLength(200)
    // 200 cotizaciones divididas en 2 tandas de 100 (nunca un .in() gigante)
    expect(batchesVistos).toEqual([100, 100])
    expect(Object.keys(resTodos.cotizacionesMap)).toHaveLength(200)
    expect(fetchEventosFn).toHaveBeenCalledWith({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      vendedorId: '',
      vista: 'eventos',
    })
  })

  it('filtra internos y externos usando fallback r.comisiones.vendedor', async () => {
    const eventos = [
      { id: '1', comisiones: { vendedor: { id: 'v1', rol: 'vendedor', es_externo: false } } },
      { id: '2', comisiones: { vendedor: { id: 'v2', rol: 'vendedor', es_externo: true, markup_pct: 5 } } },
      { id: '3', comisiones: { vendedor: { id: 'v3', rol: 'desarrollador', es_externo: false } } },
    ]
    const fetchEventosFn = vi.fn(async () => ({ data: eventos }))
    const supabaseClient = { from: vi.fn() }

    const internos = await cargarEventosComisionesParaPdf({ tipoFiltro: 'internos', fetchEventosFn, supabaseClient })
    const externos = await cargarEventosComisionesParaPdf({ tipoFiltro: 'externos', fetchEventosFn, supabaseClient })

    expect(internos.filteredEvents.map(e => e.id)).toEqual(['1'])
    expect(externos.filteredEvents.map(e => e.id)).toEqual(['2'])
  })

  it('propaga el error si falla una tanda de cotizaciones (no lo silencia)', async () => {
    const fetchEventosFn = vi.fn(async () => ({
      data: [{ id: '1', vendedor: { rol: 'vendedor' }, comisiones: { cotizacionid: 'cot-1' } }],
    }))
    const supabaseClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: null, error: new Error('Error de red') })),
        })),
      })),
    }

    await expect(
      cargarEventosComisionesParaPdf({ fetchEventosFn, supabaseClient })
    ).rejects.toThrow('Error de red')
  })
})
