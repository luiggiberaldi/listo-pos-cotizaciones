// api/lib/transportistaUtils.js
// Calcula el neto comisionable del chofer por un despacho.
// La regla de alcance (fuera de Carabobo) se congela en la BD mediante la
// migración 235; esta utilidad conserva el cálculo puro para previews y tests.
// La config (tipo_calculo, pct, tarifa) es GLOBAL en configuracion_negocio,
// no por transportista. En la ficha del chofer solo se marca es_local.

const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUuidLocal(s) {
  return typeof s === 'string' && UUID_RE_LOCAL.test(s)
}

/**
 * Recupera el flag es_local del transportista + la config global del cálculo
 * desde configuracion_negocio (cuenta_id del operador).
 *
 * @param {object} env
 * @param {object} headers — headers con apikey/Authorization
 * @param {string|null} transportistaId — null = no hay transportista
 * @param {string|null} cuentaId — para filtrar configuracion_negocio por tenant
 * @returns {Promise<{es_local: boolean, tipo_calculo: string, pct_comision: number, tarifa_fija_usd: number} | null>}
 */
export async function fetchTransportistaConfig(env, headers, transportistaId, cuentaId = null) {
  if (transportistaId && !isValidUuidLocal(cuentaId)) {
    throw new Error('CUENTA_TRANSPORTISTA_REQUERIDA')
  }
  // 1. Si no hay transportista, todavía podemos leer la config global (poco útil pero seguro).
  // 2. Si hay transportista, leer su es_local.
  let esLocal = false
  if (transportistaId && isValidUuidLocal(transportistaId)) {
    try {
      const tRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/transportistas?cuenta_id=eq.${cuentaId}&id=eq.${transportistaId}` +
        `&select=es_local`,
        { headers }
      )
      if (tRes.ok) {
        const tData = await tRes.json()
        if (!Array.isArray(tData) || tData.length === 0) throw new Error('TRANSPORTISTA_NO_ENCONTRADO')
        esLocal = !!tData[0].es_local
        // Los transportistas no locales no generan comisión de flete y no
        // deben depender de que la configuración de choferes ya exista.
        if (!esLocal) {
          return {
            es_local: false,
            tipo_calculo: 'porcentaje',
            pct_comision: 0,
            tarifa_fija_usd: 0,
          }
        }
      } else {
        throw new Error('TRANSPORTISTA_NO_DISPONIBLE')
      }
    } catch (err) {
      console.warn('[transportistaUtils] Error leyendo es_local del transportista:', err?.message)
      throw err
    }
  }

  // Leer config global del cálculo desde configuracion_negocio (singleton por cuenta_id).
  if (!isValidUuidLocal(cuentaId)) throw new Error('CUENTA_TRANSPORTISTA_REQUERIDA')
  let config = null
  try {
    // Si tenemos cuentaId, filtrar por tenant (requiere service_role para bypassar RLS).
    // Fallback sin cuentaId: leer primera fila (sistema single-tenant sin UUID PK fijo).
    const filter = `?cuenta_id=eq.${cuentaId}&limit=1`
    const cRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/configuracion_negocio${filter}` +
      `&select=transp_tipo_calculo,transp_pct_comision,transp_tarifa_fija_usd`,
      { headers }
    )
    if (cRes.ok) {
      const cData = await cRes.json()
      if (Array.isArray(cData) && cData.length > 0) {
        config = {
          tipo_calculo: cData[0].transp_tipo_calculo === 'fija' ? 'fija' : 'porcentaje',
          pct_comision: Number(cData[0].transp_pct_comision),
          tarifa_fija_usd: Number(cData[0].transp_tarifa_fija_usd),
        }
        if (!Number.isFinite(config.pct_comision) || !Number.isFinite(config.tarifa_fija_usd)) {
          throw new Error('CONFIG_TRANSPORTISTA_INVALIDA')
        }
      }
      if (!config) throw new Error('CONFIG_TRANSPORTISTA_NO_DISPONIBLE')
    } else {
      throw new Error('CONFIG_TRANSPORTISTA_NO_DISPONIBLE')
    }
  } catch (err) {
    console.warn('[transportistaUtils] Error leyendo config de configuracion_negocio:', err?.message)
    throw err
  }

  return { es_local: esLocal, ...config }
}

/**
 * Calcula el neto comisionable antes de aplicar el destino.
 *  - es_local=false → 0
 *  - tipo='porcentaje' → flete * pct/100
 *  - tipo='fija' → MIN(tarifa_fija, flete)
 *  - Nunca excede al flete cobrado al cliente.
 * La persistencia debe usar la regla SQL para excluir Carabobo y nómina.
 * @param {{es_local?: boolean, tipo_calculo?: string, pct_comision?: number, tarifa_fija_usd?: number} | null} config
 * @param {number} fleteUsd
 * @returns {{ neto: number, pct_aplicado: number|null }}
 */
export function calcularNetoTransportista(config, fleteUsd) {
  const fleteNum = Number(fleteUsd)
  if (!Number.isFinite(fleteNum) || fleteNum < 0) throw new Error('FLETE_INVALIDO')
  const flete = fleteNum
  if (!config || !config.es_local) return { neto: 0, pct_aplicado: null }
  if (config.tipo_calculo === 'fija') {
    const tarifa = Math.max(0, Number(config.tarifa_fija_usd) || 0)
    return { neto: Math.min(tarifa, flete), pct_aplicado: null }
  }
  const pct = Math.max(0, Math.min(100, Number(config.pct_comision) || 0))
  // Redondea a 4 decimales (misma precisión que la columna NUMERIC(12,4)).
  const neto = Math.round((flete * pct / 100) * 10000) / 10000
  return { neto, pct_aplicado: pct }
}
