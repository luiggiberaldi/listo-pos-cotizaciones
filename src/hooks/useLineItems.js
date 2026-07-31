// src/hooks/useLineItems.js
// Hook compartido para gestión de líneas de carrito (items de cotización/venta)
import { useState, useCallback, useRef } from 'react'
import { showToast } from '../components/ui/Toast'

let _itemCounter = 0

/**
 * Hook unificado para gestión de líneas de productos.
 * Soporta las APIs de CotizacionBuilder, CotizacionRapida y VentaRapidaView.
 *
 * @param {Object} options
 * @param {boolean} options.withDescuento - incluir descuentoPct en items (default false)
 * @param {boolean} options.checkStock - validar stock al agregar/cambiar cantidad (default false)
 * @returns {Object} { items, setItems, agregarItem, editarItem, eliminarItem, cambiarCantidad, cambiarPrecio, limpiar, setStockMap }
 */
export function useLineItems({ withDescuento = false, checkStock = false } = {}) {
  const [items, setItems] = useState([])
  const stockMapRef = useRef({})

  const setStockMap = useCallback((map) => {
    stockMapRef.current = map
  }, [])

  const getStock = (productoId) => {
    const s = stockMapRef.current[productoId]
    return s != null ? Number(s) : Infinity
  }

  const agregarItem = useCallback((producto) => {
    const stock = Number(producto.stock_actual) || 0

    if (checkStock) {
      const itemExistente = items.find(it => it.productoId === producto.id)
      if (itemExistente && itemExistente.cantidad >= stock) {
        showToast(`Stock excedido: ${stock} disp.`, 'warning')
      }
    }

    setItems(prev => {
      const idx = prev.findIndex(it => it.productoId === producto.id)
      if (idx !== -1) {
        // Ya existe → incrementar cantidad
        return prev.map((it, i) => i === idx ? { ...it, cantidad: it.cantidad + 1 } : it)
      }
      const precioBase = Number(producto.precio_usd ?? producto.preciousd ?? 0)
      const item = {
        _key: `item-${++_itemCounter}`,
        productoId: producto.id,
        codigoSnap: producto.codigo ?? producto.codigoSnap ?? '',
        nombreSnap: producto.nombre,
        unidadSnap: producto.unidad ?? 'und',
        cantidad: Number(producto.cantidad_inicial ?? producto.cantidadinicial ?? 1),
        precioUnitUsd: precioBase,
        precioOriginalUsd: Number(producto.precioOriginalUsd ?? producto.precio_original_usd ?? precioBase),
        origen: producto.origen ?? 'inventario',
        categoria: producto.categoria ?? '',
        esPrestamo: producto.esPrestamo ?? producto.es_prestamo ?? false,
      }
      if (withDescuento) item.descuentoPct = 0
      return [...prev, item]
    })
  }, [checkStock, withDescuento, items])

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
    if (checkStock && delta > 0) {
      const it = items.find(x => x.productoId === productoId)
      if (it) {
        const esExterno = it.origen === 'externo' || !it.productoId || String(it.productoId).startsWith('manual-') || String(it.codigoSnap).startsWith('EXT')
        const stock = esExterno ? Infinity : getStock(productoId)
        const nueva = Math.max(1, it.cantidad + delta)
        if (nueva > stock && stock < Infinity) {
          showToast(`Stock insuficiente: ${stock} disp.`, 'warning')
        }
      }
    }

    setItems(prev => prev.map(it => {
      if (it.productoId !== productoId) return it
      const nueva = Math.max(1, it.cantidad + delta)
      return { ...it, cantidad: nueva }
    }))
  }, [checkStock, items])

  const setCantidadDirecta = useCallback((productoId, cantidad) => {
    let n = Math.max(1, Math.floor(Number(cantidad) || 1))
    if (checkStock) {
      const it = items.find(x => x.productoId === productoId)
      if (it) {
        const esExterno = it.origen === 'externo' || !it.productoId || String(it.productoId).startsWith('manual-') || String(it.codigoSnap).startsWith('EXT')
        const stock = esExterno ? Infinity : getStock(productoId)
        if (n > stock && stock < Infinity) {
          showToast(`Cantidad supera el stock (${stock})`, 'warning')
        }
      }
    }
    setItems(prev => prev.map(x => x.productoId === productoId ? { ...x, cantidad: n } : x))
  }, [checkStock, items])

  const cambiarPrecio = useCallback((productoId, precio, precioOriginal) => {
    setItems(prev => prev.map(it => {
      if (it.productoId !== productoId) return it
      const pUnit = Math.max(0, Number(precio) || 0)
      const pOrig = precioOriginal !== undefined ? precioOriginal : pUnit
      return { ...it, precioUnitUsd: pUnit, precioOriginalUsd: pOrig }
    }))
  }, [])

  const togglePrestamo = useCallback((productoId) => {
    setItems(prev => prev.map(it =>
      it.productoId === productoId ? { ...it, esPrestamo: !it.esPrestamo } : it
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
    togglePrestamo,
    limpiar,
    setStockMap,
  }
}
