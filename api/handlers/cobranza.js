// api/handlers/cobranza.js
// GET /api/cobranza/resumen — cuántas cuentas por cobrar están vencidas o por vencer (para la campanita).
import { validateOperator } from '../lib/auth.js'
import { json, jsonError } from '../lib/utils.js'
import { leerResumenCobranza } from '../lib/cobranza.js'
import { ROLES_AVISO_COBRANZA } from '../../src/utils/cobranza.js'

const ROLES_PERMITIDOS = [...ROLES_AVISO_COBRANZA, 'desarrollador']

export async function handleResumenCobranza(request, env) {
  if (request.method !== 'GET') return jsonError('Método no permitido', 405, request)
  const validation = await validateOperator(request, env)
  if (validation.error) return validation.error
  const { user, operador } = validation
  if (!ROLES_PERMITIDOS.includes(operador.rol)) return jsonError('No tienes acceso a la cobranza', 403, request)
  try {
    const resumen = await leerResumenCobranza(env, user.id, new Date(), { signal: request.signal })
    const response = json(resumen, 200, request)
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return response
  } catch (e) {
    console.error('[COBRANZA] resumen falló:', e?.message)
    return jsonError('No se pudo calcular la cobranza', 500, request)
  }
}
