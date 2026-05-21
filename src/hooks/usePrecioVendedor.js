// src/hooks/usePrecioVendedor.js
// Hook central para aplicar markup de precio a vendedores externos.
// Uso: const { aplicarMarkup, esExterno, markupPct } = usePrecioVendedor()
// - aplicarMarkup(precioBase) → precio con markup aplicado (o mismo precio si es interno)
// - esExterno → true si este vendedor tiene markup > 0
// - markupPct → valor numérico del markup (ej: 2)
// - factor    → multiplicador (ej: 1.02 para 2%)

import useAuthStore from '../store/useAuthStore'
import { useConfigNegocio } from './useConfigNegocio'

export function usePrecioVendedor() {
  const perfil = useAuthStore(s => s.perfil)
  const { data: config } = useConfigNegocio()

  const esExterno = !!perfil?.es_externo
  const pct = esExterno
    ? Number(config?.markup_pct_externo ?? 5.00)
    : (perfil?.markup_pct != null ? Number(perfil.markup_pct) : 0)

  const factor = pct > 0 ? (1 + pct / 100) : 1.0

  /**
   * Aplica el markup al precio base.
   * @param {number} precioBase - Precio original del inventario
   * @returns {number} Precio con markup aplicado (redondeado a 4 decimales)
   */
  function aplicarMarkup(precioBase) {
    if (pct <= 0) return Number(precioBase) || 0
    return Math.round(Number(precioBase) * factor * 10000) / 10000
  }

  return { aplicarMarkup, esExterno, markupPct: pct, factor }
}

export default usePrecioVendedor
