import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// supabase/client lanza al importar sin variables de entorno — stub para node.
vi.mock('../../../services/supabase/client', () => ({ default: {} }))

const form = fs.readFileSync(new URL('../ProductoForm.jsx', import.meta.url), 'utf8')
const inventario = fs.readFileSync(new URL('../../../hooks/useInventario.js', import.meta.url), 'utf8')

describe('refrescarCacheTrasMetadatos — cache de inventario tras escribir flags', () => {
  it('cancela lecturas en vuelo, parcha los flags del producto e invalida DESPUÉS', async () => {
    const { refrescarCacheTrasMetadatos } = await import('../../../hooks/useInventario')
    const llamadas = []
    let data = {
      productos: [
        { id: 'a', precio2_habilitado: true, precio3_habilitado: true },
        { id: 'b', precio2_habilitado: true, precio3_habilitado: true },
      ],
      totalCount: 2,
    }
    const qc = {
      cancelQueries: (q) => { llamadas.push(['cancel', q.queryKey[0]]); return Promise.resolve() },
      setQueriesData: (q, fn) => { llamadas.push(['set', q.queryKey[0]]); data = fn(data) },
      invalidateQueries: (q) => { llamadas.push(['invalidate', q.queryKey[0]]) },
    }

    await refrescarCacheTrasMetadatos(qc, 'a', { precio2_habilitado: false })

    // Orden: cancelar lecturas viejas → escribir el cache → refetch nuevo.
    expect(llamadas.map(([etapa]) => etapa)).toEqual(['cancel', 'set', 'invalidate'])
    expect(llamadas[0][1]).toBe('inventario')
    expect(llamadas[2][1]).toBe('inventario')

    // Flags parchados solo en el producto objetivo; el resto intacto.
    expect(data.productos[0]).toEqual({ id: 'a', precio2_habilitado: false, precio3_habilitado: true })
    expect(data.productos[1]).toEqual({ id: 'b', precio2_habilitado: true, precio3_habilitado: true })
    expect(data.totalCount).toBe(2)
  })

  it('deja intactas las caches de inventario que no son de productos (ej. categorías)', async () => {
    const { refrescarCacheTrasMetadatos } = await import('../../../hooks/useInventario')
    const categorias = ['VIGA', 'PLACA']
    const qc = {
      cancelQueries: () => Promise.resolve(),
      setQueriesData: (_q, fn) => { expect(fn(categorias)).toBe(categorias) },
      invalidateQueries: () => {},
    }
    await refrescarCacheTrasMetadatos(qc, 'a', { precio2_habilitado: false })
  })
})

describe('ProductoForm — contrato del guardado de metadatos (bug: guardar dos veces)', () => {
  it('refresca el cache tras confirmar la escritura de flags en edición', () => {
    const idxEscritura = form.indexOf('await guardarMetadatos(producto.id, metadatos)')
    const idxRefresco = form.indexOf('await refrescarCacheTrasMetadatos(qc, producto.id, metadatos)')
    expect(idxEscritura).toBeGreaterThan(-1)
    expect(idxRefresco).toBeGreaterThan(idxEscritura)
  })

  it('refresca el cache tras confirmar la escritura de flags en creación', () => {
    const idxEscritura = form.indexOf('await guardarMetadatos(productoResult.id, metadatos)')
    const idxRefresco = form.indexOf('await refrescarCacheTrasMetadatos(qc, productoResult.id, metadatos)')
    expect(idxEscritura).toBeGreaterThan(-1)
    expect(idxRefresco).toBeGreaterThan(idxEscritura)
  })

  it('el helper invalida el inventario (sin él, el refetch programado por la mutación puede leer antes del PATCH)', () => {
    expect(inventario).toContain('export async function refrescarCacheTrasMetadatos')
    expect(inventario).toContain('qc.invalidateQueries({ queryKey: INVENTARIO_KEY })')
    expect(inventario).toContain('await qc.cancelQueries({ queryKey: INVENTARIO_KEY })')
  })
})
