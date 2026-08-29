export function calcularDescuentoValido(tipoEntrada, valorEntrada, totalLineaEntrada, cantidadEntrada) {
  const tipo = tipoEntrada === 'monto'
    ? 'monto'
    : tipoEntrada === 'monto_unitario'
      ? 'monto_unitario'
      : 'porcentaje'
  const valor = Math.max(0, Number(valorEntrada) || 0)
  const totalLinea = Number(totalLineaEntrada)
  const cantidad = Number(cantidadEntrada)

  if (!Number.isFinite(totalLinea) || !Number.isFinite(cantidad) || valor <= 0 || totalLinea < 0 || cantidad < 0) {
    return null
  }

  let montoUsd
  if (tipo === 'porcentaje') {
    if (valor > 100) return null
    montoUsd = totalLinea * valor / 100
  } else if (tipo === 'monto_unitario') {
    montoUsd = valor * cantidad
  } else {
    montoUsd = valor
  }

  if (!Number.isFinite(montoUsd) || montoUsd > totalLinea) return null

  return {
    tipo,
    valor,
    montoUsd: Math.round(montoUsd * 10000) / 10000,
  }
}
