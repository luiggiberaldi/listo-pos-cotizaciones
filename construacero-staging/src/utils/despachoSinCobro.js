// src/utils/despachoSinCobro.js — OP-2026-092 + OP-2026-095 Fase 4
// Regla compartida para saber si un despacho no requiere método de pago (total $0 y sin COD)
// y qué mensaje honesto mostrar según sean artículos en préstamo o donación/descuento 100 %.

export function evaluarSinCobro({ esCod = false, total = 0, items = [] } = {}) {
  const monto = Number(total) || 0
  const sinCobro = !esCod && monto <= 0.015
  if (!sinCobro) {
    return {
      sinCobro: false,
      motivo: null,
      titulo: '',
      descripcion: '',
      etiquetaCorta: '',
    }
  }

  const lista = Array.isArray(items) ? items : []
  const todosPrestamo = lista.length > 0 && lista.every(it => Boolean(it?.esPrestamo || it?.es_prestamo))

  if (todosPrestamo) {
    return {
      sinCobro: true,
      motivo: 'prestamo',
      titulo: 'Este despacho es 100 % préstamo: no se cobra nada ahora.',
      descripcion: 'Por eso no hace falta elegir un método de pago. Las devoluciones se gestionan desde la ficha del cliente → Préstamos.',
      etiquetaCorta: 'Sin cobro: todo es préstamo ✓',
    }
  }

  return {
    sinCobro: true,
    motivo: 'sin_cobro',
    titulo: 'Este despacho tiene total $0: no requiere método de pago.',
    descripcion: 'No hay monto por cobrar en este despacho (por ejemplo, donación o descuento del 100 %).',
    etiquetaCorta: 'Sin cobro ($0) ✓',
  }
}
