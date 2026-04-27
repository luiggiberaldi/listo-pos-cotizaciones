// src/hooks/useLineItems.js
// Hook compartido para gestión de líneas de carrito (items de cotización/venta)
import { useState, useCallback } from 'react'
import { showToast } from '../components/ui/Toast'

let _itemCounter = 0

/**
 * Hook unificado para gestión de líneas de productos.
 * Soporta las APIs de CotizacionBuilder, CotizacionRapida y VentaRapidaView.
 *
 * @param {Object} options
 * @param {boolean} options.withDescuento - incluir descuentoPct en items (default false)
 * @param {boolean} options.checkStock - validar stock al agregar (default false)
 * @returns {Object} { items, setItems, agregarItem, editarItem, eliminarItem, cambiarCantidad, cambiarPrecio, limpiar }
 */
export function useLineItems({ withDescuento = false, checkStock = false } = {}) {
  const [items, setItems] = useState([])

  const agregarItem = useCallback((producto) => {
    const stock = Number(producto.stock_actual) || 0

    setItems(prev => {
      const idx = prev.findIndex(it => it.productoId === producto.id)
      if (idx !== -1) {
        // Ya existe → incrementar cantidad
        if (checkStock && prev[idx].cantidad >= stock) {
          showToast(`Stock máximo: ${stock} ${producto.unidad ?? 'und'}`, 'error')
          return prev
        }
        return prev.map((it, i) => i === idx ? { ...it, cantidad: it.cantidad + 1 } : it)
      }
      // Nuevo item
      const item = {
        _key: `item-${++_itemCounter}`,
        productoId: producto.id,
        codigoSnap: producto.codigo ?? '',
        nombreSnap: producto.nombre,
        unidadSnap: producto.unidad ?? 'und',
        cantidad: 1,
        precioUnitUsd: Number(producto.precio_usd) || 0,
      }
      if (withDescuento) item.descuentoPct = 0
      return [...prev, item]
    })
  }, [checkStock, withDescuento])

  const editarItem = useCallback((idx, campo, valor) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [campo]: valor } : it))
  }, [])

  const eliminarItem = useCallback((idx) => {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const eliminarPorId = useCallback((productoId) => {
    setItems(prev => prev.filter(it => it.productoId !== productoId))
  }, [])

  const cambiarCantidad = useCallback((productoId, delta) => {
    setItems(prev => prev.map(it => {
      if (it.productoId !== productoId) return it
      return { ...it, cantidad: Math.max(1, it.cantidad + delta) }
    }))
  }, [])

  const setCantidadDirecta = useCallback((productoId, cantidad) => {
    const n = Math.max(1, Math.floor(Number(cantidad) || 1))
    setItems(prev => prev.map(it =>
      it.productoId === productoId ? { ...it, cantidad: n } : it
    ))
  }, [])

  const cambiarPrecio = useCallback((productoId, precio) => {
    setItems(prev => prev.map(it =>
      it.productoId === productoId ? { ...it, precioUnitUsd: Math.max(0, Number(precio) || 0) } : it
    ))
  }, [])

  const limpiar = useCallback(() => setItems([]), [])

  return {
    items,
    setItems,
    agregarItem,
    editarItem,
    eliminarItem,
    eliminarPorId,
    cambiarCantidad,
    setCantidadDirecta,
    cambiarPrecio,
    limpiar,
  }
}
