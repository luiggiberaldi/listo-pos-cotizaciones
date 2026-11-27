// OP-2026-087 + OP-2026-095 Fase 1 — aviso "por aprobar" (solo aviso, no resta del stock, 4 decimales y refresco inmediato).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('../../store/useAuthStore', () => ({ default: () => ({ perfil: null }) }))
vi.mock('../../services/supabase/client', () => ({ default: { rpc: vi.fn() } }))

const leer = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8')

describe('OP-2026-087 / OP-2026-095 stock por aprobar', () => {
  it('normalizarMapaPorAprobar conserva 4 decimales e ignora ceros o filas inválidas', async () => {
    const { normalizarMapaPorAprobar, STOCK_POR_APROBAR_KEY } = await import('../../hooks/useStockPorAprobar.js')
    expect(STOCK_POR_APROBAR_KEY).toEqual(['stock_por_aprobar'])
    expect(normalizarMapaPorAprobar([
      { producto_id: 'p1', total_por_aprobar: '12.3456' },
      { producto_id: 'p2', total_por_aprobar: 0 },
      { producto_id: 'p3', total_por_aprobar: -1 },
      { producto_id: null, total_por_aprobar: 5 },
      null,
    ])).toEqual({ p1: 12.3456 })
  })

  it('useDespachos invalida stock_por_aprobar al crear, aprobar/rechazar y editar despachos', () => {
    const s = leer('src/hooks/useDespachos.js')
    const matches = s.match(/queryKey:\s*\['stock_por_aprobar'\]/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  it.each([
    ['src/views/InventarioView.jsx', 'porAprobar={stockPorAprobar[p.id]'],
    ['src/views/VentaRapidaView.jsx', 'stockPorAprobar={stockPorAprobar}'],
    ['src/views/VentaRapidaView.jsx', 'porAprobar={stockPorAprobar[p.id]'],
    ['src/components/cotizaciones/CotizacionBuscador.jsx', 'porAprobar={stockPorAprobar[p.id]'],
    ['src/components/cotizaciones/ProductoAutocomplete.jsx', 'por aprobar'],
    ['src/components/shared/ProductCard.jsx', 'por aprobar'],
    ['src/components/inventario/ProductoCard.jsx', 'StockPorAprobarDetalle'],
  ])('%s integra el aviso por aprobar', (archivo, texto) => {
    expect(leer(archivo)).toContain(texto)
  })

  it('ProductCard nunca resta porAprobar del stock disponible', () => {
    const s = leer('src/components/shared/ProductCard.jsx')
    expect(s).toContain('const stock = Number(p.stock_actual) || 0')
    expect(s).not.toMatch(/stock\s*-\s*porAprobar/)
  })

  it('migración 316 filtra por empresa, usa 4 decimales y revoca acceso anónimo', () => {
    const s = leer('supabase/migrations/316_prod_stock_por_aprobar.sql')
    expect(s).toContain("nd.estado = 'pendiente'")
    expect(s).toContain('nd.cuenta_id = (SELECT auth.uid())')
    expect(s).toContain('NUMERIC(12,4)')
    expect(s).toContain('REVOKE ALL ON FUNCTION public.obtener_stock_por_aprobar() FROM PUBLIC, anon')
  })
})
