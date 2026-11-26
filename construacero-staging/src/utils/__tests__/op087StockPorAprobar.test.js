// OP-2026-087 — el aviso "por aprobar" llega a todas las pantallas donde se elige un producto.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const leer = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8')

describe('OP-2026-087 stock por aprobar (aviso, no resta)', () => {
  it('el hook consulta las funciones nuevas y comparte prefijo con el comprometido', () => {
    const s = leer('src/hooks/useStockComprometido.js')
    expect(s).toContain("rpc('obtener_stock_por_aprobar')")
    expect(s).toContain("rpc('obtener_stock_por_aprobar_detalle'")
    expect(s).toContain('[...STOCK_COMPROMETIDO_KEY, \'por_aprobar\']')
  })
  it.each([
    ['src/views/InventarioView.jsx', 'porAprobar={stockPorAprobar[p.id]'],
    ['src/views/VentaRapidaView.jsx', 'porAprobar={stockPorAprobar[p.id]'],
    ['src/components/cotizaciones/CotizacionBuscador.jsx', 'porAprobar={stockPorAprobar[p.id]'],
    ['src/components/cotizaciones/ProductoAutocomplete.jsx', 'por aprobar'],
    ['src/components/shared/ProductCard.jsx', 'por aprobar'],
    ['src/components/inventario/ProductoCard.jsx', 'StockPorAprobarDetalle'],
  ])('%s muestra el aviso', (archivo, texto) => {
    expect(leer(archivo)).toContain(texto)
  })
  it('el aviso no se resta del disponible', () => {
    const s = leer('src/components/shared/ProductCard.jsx')
    expect(s).toMatch(/const disponibleReal = stock - comprometido\s/)
  })
  it('la migración filtra por empresa y solo despachos pendientes', () => {
    const s = leer('supabase/migrations/324_staging_stock_por_aprobar.sql')
    expect(s).toContain("nd.estado = 'pendiente'")
    expect(s).toContain('nd.cuenta_id = (SELECT auth.uid())')
    expect(s).toContain('REVOKE ALL ON FUNCTION public.obtener_stock_por_aprobar() FROM PUBLIC, anon')
  })
})
