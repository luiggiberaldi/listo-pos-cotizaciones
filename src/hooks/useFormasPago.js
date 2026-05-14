import { useState, useCallback, useMemo } from 'react'
import { FORMAS_PAGO } from '../constants/formasPago'

/**
 * Hook centralizado para gestionar el estado de formas de pago en ventas, despachos y cotizaciones.
 * @param {number} totalRequerido - El monto total que se debe cubrir con los pagos.
 */
export function useFormasPago(totalRequerido = 0) {
  // Estado local: formasPago es un array de objetos { metodo, monto }
  // Se mantiene como array para preservar el orden de selección y facilitar el renderizado.
  const [formasPago, setFormasPago] = useState([])

  /**
   * Alterna la activación de una forma de pago.
   * Si se activa por primera vez, intenta asignar el monto restante automáticamente.
   */
  const toggleForma = useCallback((metodo) => {
    setFormasPago(prev => {
      const existe = prev.find(fp => fp.metodo === metodo)
      if (existe) return prev.filter(fp => fp.metodo !== metodo)

      // UX: Si hay exactamente 1 forma de pago que cubre el total, y el usuario 
      // selecciona una distinta, asumimos que quiere CAMBIAR la forma de pago.
      if (prev.length === 1 && Math.abs(Number(prev[0].monto) - totalRequerido) < 0.02) {
        return [{ metodo, monto: Number(totalRequerido.toFixed(2)) }]
      }

      // Calcular cuánto falta para cubrir el totalRequerido
      const actualAsignado = prev.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
      const restante = totalRequerido - actualAsignado
      
      // Si falta dinero, asignamos el resto a esta nueva forma de pago
      const montoInicial = restante > 0 ? Number(restante.toFixed(2)) : ''
      
      return [...prev, { metodo, monto: montoInicial }]
    })
  }, [totalRequerido])

  /**
   * Actualiza el monto de una forma de pago específica.
   */
  const setMontoForma = useCallback((metodo, monto) => {
    setFormasPago(prev => prev.map(fp => 
      fp.metodo === metodo ? { ...fp, monto } : fp
    ))
  }, [])

  /**
   * Actualiza propiedades extra de una forma de pago específica.
   */
  const updateForma = useCallback((metodo, updates) => {
    setFormasPago(prev => prev.map(fp => 
      fp.metodo === metodo ? { ...fp, ...updates } : fp
    ))
  }, [])

  /**
   * Reinicia todas las formas de pago.
   */
  const resetFormas = useCallback(() => {
    setFormasPago([])
  }, [])

  /**
   * Inicializa las formas de pago (útil para cargar datos existentes).
   */
  const setFormas = useCallback((nuevasFormas) => {
    if (Array.isArray(nuevasFormas)) {
      setFormasPago(nuevasFormas)
    }
  }, [])

  // Cálculos derivados (Computed)
  const totalAsignado = useMemo(() => {
    return formasPago.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
  }, [formasPago])

  // Lógica de "pago cuadrado": diferencia menor a 0.02 (tolerancia de redondeo)
  const pagoCuadrado = useMemo(() => {
    return formasPago.length > 0 && Math.abs(totalAsignado - totalRequerido) < 0.02
  }, [totalAsignado, totalRequerido, formasPago.length])

  const diferencia = useMemo(() => {
    return totalAsignado - totalRequerido
  }, [totalAsignado, totalRequerido])

  const hayVuelto = useMemo(() => {
    return formasPago.length > 0 && diferencia > 0.02
  }, [formasPago.length, diferencia])

  const faltante = useMemo(() => {
    return formasPago.length > 0 && diferencia < -0.02
  }, [formasPago.length, diferencia])

  const montoPendiente = useMemo(() => {
    const p = totalRequerido - totalAsignado
    return p > 0 ? p : 0
  }, [totalAsignado, totalRequerido])

  return {
    formasPago,
    setFormas,
    toggleForma,
    setMontoForma,
    updateForma,
    resetFormas,
    totalAsignado,
    pagoCuadrado,
    diferencia,
    hayVuelto,
    faltante,
    montoPendiente,
    FORMAS_PAGO,
  }
}
