// OP-2026-061: la deuda de un cliente y su historial deben verse al instante en las pantallas abiertas,
// aunque el cambio venga de otra computadora o de una corrección hecha directo en la base.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/supabase/client', () => ({ default: {} }))
vi.mock('../../store/useAuthStore', () => ({ default: () => null }))
vi.mock('../../hooks/useInventario', () => ({ INVENTARIO_KEY: ['inventario'] }))
vi.mock('../../hooks/useDespachos', () => ({ DESPACHOS_KEY: ['despachos'] }))
vi.mock('../../hooks/useComisiones', () => ({ COMISIONES_KEY: ['comisiones'] }))

const { TABLAS_LAZY, TABLAS_INMEDIATAS } = await import('../../hooks/useRealtimeSync')
const buscar = (lista, tabla) => lista.find(t => t.tabla === tabla)

describe('OP-2026-061 — clientes y cuentas por cobrar se actualizan solos', () => {
  it('un cambio en clientes redibuja la pantalla abierta (no solo marca el dato como viejo)', () => {
    expect(buscar(TABLAS_LAZY, 'clientes')).toBeUndefined()
    expect(buscar(TABLAS_INMEDIATAS, 'clientes')?.keys).toEqual([['clientes']])
  })

  it('un abono o cargo nuevo actualiza la ficha (cuentas por cobrar) y la deuda del cliente', () => {
    const cxc = buscar(TABLAS_INMEDIATAS, 'cuentas_por_cobrar')
    expect(cxc?.keys).toEqual([['cuentas-cobrar'], ['clientes']])
    expect(cxc.debounceMs).toBeLessThanOrEqual(1000)
  })

  it('las demás tablas siguen igual', () => {
    expect(TABLAS_INMEDIATAS.map(t => t.tabla)).toEqual(expect.arrayContaining(['configuracion_negocio', 'cotizaciones', 'notas_despacho']))
    expect(TABLAS_LAZY.map(t => t.tabla)).toEqual(['comisiones', 'usuarios'])
  })
})
