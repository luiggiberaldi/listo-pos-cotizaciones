export const FORMAS_PAGO = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT', 'Cruce', 'Donación', 'Cta por cobrar']

// Métodos disponibles en los flujos normales de venta para cualquier rol.
// Los flujos contextuales (conciliación COD/devoluciones) aplican sus propias restricciones.
export function getSalePaymentMethods() {
  return FORMAS_PAGO.filter(method => method !== 'Cobro a destino')
}
