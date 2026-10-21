import { json, jsonError, isValidUuid, isSameOriginRequest } from '../lib/utils.js'
import { SUPER_ADMIN_UUID, validateOperator } from '../lib/auth.js'
import { convertBsToUsd } from '../../src/utils/codCurrency.js'

const ROLES_CONCILIAR_COD = new Set(['administracion', 'jefe', 'supervisor', 'desarrollador'])
const METODOS_PAGO_EXTERNOS = new Set([
  'Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT',
])
const METODOS_SIN_REFERENCIA = new Set(['Efectivo $', 'Efectivo Bs'])

function idempotencyKey(request, body) {
  const raw = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
  return raw || (request.headers.get('Idempotency-Key') || '').trim()
}

export async function handleResumenFinancieroDespacho(request, env) {
  const auth = await validateOperator(request, env)
  if (auth.error) return auth.error
  const { operador, headers } = auth
  if (!ROLES_CONCILIAR_COD.has(operador.rol)) return jsonError('No tiene permisos para consultar el resumen financiero COD', 403, request)
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { despachoId } = body || {}
  if (!isValidUuid(despachoId) || !isValidUuid(operador.cuenta_id)) {
    return jsonError('Despacho o cuenta inválidos', 400, request)
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/resumen_financiero_despacho`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_cuenta_id: operador.cuenta_id, p_despacho_id: despachoId }),
  })
  if (!response.ok) {
    const error = await response.text().catch(() => '')
    const missing = /NO_ENCONTRADO|SIN_PERMISO/.test(error)
    return jsonError(missing ? 'Despacho no encontrado' : 'No se pudo leer el resumen financiero', missing ? 404 : 503, request)
  }
  return json({ resumen: await response.json() }, 200, request)
}

export async function handleConciliarPagoCod(request, env) {
  if (!isSameOriginRequest(request)) return jsonError('Origen de la petición no permitido', 403, request);
  const auth = await validateOperator(request, env)
  if (auth.error) return auth.error
  const { operador, headers } = auth
  if (!ROLES_CONCILIAR_COD.has(operador.rol)) {
    return jsonError('No tiene permisos para conciliar cobros COD', 403, request)
  }
  if (operador.id === SUPER_ADMIN_UUID || auth.user?.operator_virtual_developer) {
    return jsonError('El perfil desarrollador virtual no tiene un usuario contable válido para registrar COD. Use un operador desarrollador activo de la cuenta.', 409, request)
  }

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { despachoId, pagos, evidencia } = body || {}
  const tienePrecisionDosDecimales = value => {
    const text = String(value).trim()
    return /^\d+(?:\.\d{1,2})?$/.test(text)
  }
  if (!isValidUuid(despachoId) || !isValidUuid(operador.cuenta_id)) {
    return jsonError('Despacho o cuenta inválidos', 400, request)
  }
  if (!Array.isArray(pagos) || pagos.length < 1 || pagos.length > 6) {
    return jsonError('Agregue entre 1 y 6 métodos de pago', 400, request)
  }
  // La nota es opcional (máximo 500 caracteres si se escribe)
  if (evidencia != null && (typeof evidencia !== 'string' || evidencia.trim().length > 500)) {
    return jsonError('La nota del cobro no puede superar los 500 caracteres', 400, request)
  }
  const pagosInvalidos = pagos.some(p => {
    if (!p || !METODOS_PAGO_EXTERNOS.has(p.metodo)
      || !tienePrecisionDosDecimales(p.monto)
      || !Number.isFinite(Number(p.monto)) || Number(p.monto) <= 0
      || (!METODOS_SIN_REFERENCIA.has(p.metodo) && String(p.referencia || '').trim().length < 4)) return true
    if (p.metodo !== 'Efectivo Bs') return false
    const montoBs = Number(p.monto_bs)
    const tasa = Number(p.tasa_snapshot)
    const equivalenteUsd = convertBsToUsd(p.monto_bs, p.tasa_snapshot)
    return !tienePrecisionDosDecimales(p.monto_bs)
      || !Number.isFinite(montoBs) || montoBs <= 0
      || !Number.isFinite(tasa) || tasa <= 0 || tasa > 1_000_000_000
      || tasa !== Math.round(tasa * 100_000_000) / 100_000_000
      || equivalenteUsd === null || equivalenteUsd <= 0
      || equivalenteUsd !== Number(p.monto)
      || typeof p.tasa_fuente !== 'string' || p.tasa_fuente.trim().length < 1 || p.tasa_fuente.length > 80
      || (p.tasa_actualizada_en != null && (typeof p.tasa_actualizada_en !== 'string'
        || !Number.isFinite(Date.parse(p.tasa_actualizada_en))))
  })
  if (pagosInvalidos) return jsonError('Método, monto, tasa o referencia de pago inválidos (la referencia requiere mínimo 4 caracteres)', 400, request)

  const key = idempotencyKey(request, body)
  // La clave la genera el cliente (una por conciliación) y la REUTILIZA en reintentos:
  // inventar una clave aleatoria por petición anularía el replay-safe de la RPC
  // (cada reintento parecería una conciliación nueva y duplicaría abonos).
  if (!key) return jsonError('Idempotency-Key requerida: genere una clave única por conciliación y reutilícela en los reintentos', 400, request)
  if (!isValidUuid(key)) return jsonError('Idempotency-Key inválida', 400, request)

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/registrar_pago_externo_cobro_idempotente`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      p_cuenta_id: operador.cuenta_id,
      p_despacho_id: despachoId,
      p_idempotency_key: key,
      p_usuario_id: operador.id,
      p_usuario_nombre: operador.nombre,
      p_pagos: pagos.map(p => ({
        metodo: p.metodo,
        monto: Number(Number(p.monto).toFixed(2)),
        referencia: p.referencia ? String(p.referencia).trim() : null,
        ...(p.metodo === 'Efectivo Bs' ? {
          monto_bs: Number(Number(p.monto_bs).toFixed(2)),
          tasa_snapshot: Number(Number(p.tasa_snapshot).toFixed(8)),
          tasa_fuente: p.tasa_fuente.trim(),
          tasa_actualizada_en: p.tasa_actualizada_en || null,
        } : {}),
      })),
      p_evidencia: typeof evidencia === 'string' ? evidencia.trim() : '',
      p_ip_origen: request.headers.get('CF-Connecting-IP') || null,
    }),
  })
  const text = await response.text()
  if (!response.ok) {
    const businessFailure = /COD_CONCILIACION_(?:PARAMETROS|PAGO_O_REFERENCIA|TASA_BS_INVALIDA|MONTO_INVALIDO|MONTO_NO_COINCIDE|MONTO_NOMINAL_INVALIDO|SIN_DEUDA|ACTOR_NO_AUTORIZADO|ESTADO_INVALIDO|DESPACHO_NO_ENCONTRADO|DESPACHO_CAMBIO|CLIENTE_REQUERIDO|LEDGER_AMBIGUO|CARGO_NO_COINCIDE|FORMA_PAGO_INVALIDA|COD_AMBIGUO|IDEMPOTENCIA_REUTILIZADA|ATRIBUCION_AMBIGUA|FLAG_SIN_SOPORTE)/.test(text)
    return jsonError(businessFailure ? text.slice(0, 500) : 'No se pudo registrar el cobro COD atómico', businessFailure ? 400 : 503, request)
  }
  let result
  try { result = JSON.parse(text) } catch { return jsonError('Respuesta inválida del conciliador', 502, request) }
  return json(result, 200, request)
}
