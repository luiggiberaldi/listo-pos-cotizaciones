// Contrato operativo del flujo de despacho.
// Un despacho pendiente o aprobado no mueve el stock físico; la entrega sí.
export function expectedStockAfterDispatch(stockInicial, cantidad, estado) {
  const initial = Number(stockInicial)
  const quantity = Number(cantidad)

  if (!Number.isFinite(initial) || !Number.isFinite(quantity) || quantity < 0) {
    throw new Error('stockInicial y cantidad deben ser números válidos')
  }

  return estado === 'entregada' ? initial - quantity : initial
}

export function expectedCommittedStock(cantidad, estado) {
  const quantity = Number(cantidad)
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('cantidad debe ser un número válido')
  }

  return estado === 'despachada' ? quantity : 0
}
