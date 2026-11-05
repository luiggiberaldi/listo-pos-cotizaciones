// api/lib/cobranza.js
// Aviso diario de cobranza (cuentas por cobrar vencidas y por vencer) para jefe y administración.
// Lee lo mismo que el reporte de Crédito: clientes activos con saldo pendiente y sus cargos/abonos.
import { readAllRows, splitIds } from './dashboardData.js'
import { enviarPush } from './notificarPush.js'
import { isValidUuid } from './utils.js'
import { DIAS_AVISO_COBRANZA, ROLES_AVISO_COBRANZA, fechaCaracas, resumirCobranza, textoCobranza } from '../../src/utils/cobranza.js'

export const URL_COBRANZA = '/reportes?tab=credito'

const dbHeaders = env => ({ apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` })

export async function leerResumenCobranza(env, cuentaId, now = new Date(), { signal } = {}) {
  if (!isValidUuid(cuentaId)) throw new Error('Cuenta inválida')
  const headers = dbHeaders(env)
  const clientes = await readAllRows(env, headers, 'clientes', new URLSearchParams({
    select: 'id', cuenta_id: `eq.${cuentaId}`, activo: 'eq.true', saldo_pendiente: 'gt.0',
  }), { signal })
  const transacciones = []
  for (const ids of splitIds(clientes.map(c => c.id))) {
    transacciones.push(...await readAllRows(env, headers, 'cuentas_por_cobrar', new URLSearchParams({
      select: 'id,cliente_id,despacho_id,tipo,monto_usd,fecha_vencimiento,creado_en',
      cuenta_id: `eq.${cuentaId}`, tipo: 'in.(cargo,abono)', cliente_id: `in.(${ids.join(',')})`,
    }), { signal }))
  }
  return resumirCobranza(transacciones, fechaCaracas(now), DIAS_AVISO_COBRANZA)
}

// Tarea programada: un aviso por cuenta a sus jefes y administradores activos.
// Si no hay nada vencido ni por vencer, no se envía nada.
export async function runAvisoCobranza(env, now = new Date()) {
  const headers = dbHeaders(env)
  const destinatarios = await readAllRows(env, headers, 'usuarios', new URLSearchParams({
    select: 'id,cuenta_id', rol: `in.(${ROLES_AVISO_COBRANZA.join(',')})`, activo: 'eq.true',
  }))
  const porCuenta = new Map()
  for (const u of destinatarios) {
    if (!isValidUuid(u.cuenta_id) || !isValidUuid(u.id)) continue
    if (!porCuenta.has(u.cuenta_id)) porCuenta.set(u.cuenta_id, [])
    porCuenta.get(u.cuenta_id).push(u.id)
  }
  const resultado = []
  for (const [cuentaId, usuarioIds] of porCuenta) {
    const resumen = await leerResumenCobranza(env, cuentaId, now)
    const texto = textoCobranza(resumen)
    if (!texto) { resultado.push({ cuentaId, enviado: false }); continue }
    const envio = await enviarPush(env, {
      title: texto.title, message: texto.body, tag: `cobranza-${resumen.hoy}`, url: URL_COBRANZA,
      usuarioIds, usuarioNombre: 'Aviso diario de cobranza',
    })
    resultado.push({ cuentaId, enviado: true, vencidas: resumen.vencidas.cantidad, porVencer: resumen.porVencer.cantidad, ...envio })
  }
  return resultado
}
