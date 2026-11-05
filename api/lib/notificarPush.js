// api/lib/notificarPush.js
// Envío de notificaciones push DESDE EL SERVIDOR: el aviso sale cuando la operación ya se guardó,
// sin depender del navegador de quien la hizo (si cierra la pestaña, igual se avisa).
import { isValidUuid } from './utils.js'
import { logToSystem } from './audit.js'
import { sendWebPush } from './webpush.js'

export const ROLES_VALIDOS = ['administracion', 'desarrollador', 'jefe', 'logistica', 'supervisor', 'vendedor', 'vendedor_sin_comision']

const BATCH_SIZE = 5

const dbHeaders = env => ({ apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` })

// Envía el aviso a los dispositivos de los roles (o del usuario) indicados.
// Si no se indica destino, avisa a todos (el llamador decide si eso está permitido).
// Nunca lanza: devuelve un resumen.
export async function enviarPush(env, { title, message, tag, url = '/', roles, userId, usuarioIds, excluirUsuarioId, usuarioNombre }) {
  const headers = dbHeaders(env)
  let subsUrl = `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth,usuario_id`

  if (userId) {
    if (!isValidUuid(userId)) return { error: 'Destino inválido', status: 400 }
    subsUrl += `&usuario_id=eq.${userId}`
  } else if (usuarioIds) {
    const ids = usuarioIds.filter(isValidUuid)
    if (!ids.length) return { sent: 0, failed: 0, removed: 0, destinos: 0 }
    subsUrl += `&usuario_id=in.(${ids.join(',')})`
  } else if (roles?.length) {
    const usersRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?select=id&rol=in.(${roles.join(',')})`, { headers })
    if (!usersRes.ok) return { error: 'Error al obtener usuarios', status: 500 }
    const ids = (await usersRes.json()).map(u => u.id).filter(isValidUuid)
    if (!ids.length) return { sent: 0, failed: 0, removed: 0, destinos: 0 }
    subsUrl += `&usuario_id=in.(${ids.join(',')})`
  }
  if (isValidUuid(excluirUsuarioId)) subsUrl += `&usuario_id=neq.${excluirUsuarioId}`

  const subsRes = await fetch(subsUrl, { headers })
  if (!subsRes.ok) return { error: 'Error al obtener suscripciones', status: 500 }
  const subscriptions = await subsRes.json()
  if (!subscriptions.length) return { sent: 0, failed: 0, removed: 0, destinos: 0 }

  const payload = JSON.stringify({ title, body: message, tag, url })
  let sent = 0
  let removed = 0
  const errores = []

  for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
    const batch = subscriptions.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(sub => sendWebPush(sub.endpoint, sub.p256dh, sub.auth, payload, env)))
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') { sent++; continue }
      const errMsg = results[j].reason?.message || ''
      console.error('Push failed for', batch[j].endpoint, errMsg)
      errores.push(errMsg.slice(0, 80))
      // Si el dispositivo ya no existe, se retira su suscripción
      if (errMsg.includes('410') || errMsg.includes('404')) {
        removed++
        await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(batch[j].endpoint)}`, { method: 'DELETE', headers })
      }
    }
  }

  // Resumen de entrega (sin textos ni direcciones) para saber si las notificaciones llegan.
  await logToSystem(env, {
    nivel: errores.length ? 'warn' : 'info',
    categoria: 'PUSH',
    mensaje: `Push enviado: ${sent} ok, ${errores.length} con error, ${removed} suscripciones retiradas`,
    usuario_id: isValidUuid(excluirUsuarioId) ? excluirUsuarioId : null,
    usuario_nombre: usuarioNombre || null,
    meta: { tag: tag || null, destinos: subscriptions.length, sent, errores: errores.slice(0, 5), removed },
  }).catch(() => {})

  return { sent, failed: errores.length, removed, destinos: subscriptions.length }
}

// Ejecuta el aviso sin hacer esperar la respuesta al usuario (waitUntil del Worker).
// Fuera del Worker (pruebas) simplemente lo espera.
export function programar(env, tarea) {
  const p = Promise.resolve().then(tarea).catch(e => console.error('[PUSH] aviso falló:', e?.message))
  if (typeof env?.waitUntil === 'function') { env.waitUntil(p); return Promise.resolve() }
  return p
}

// El supervisor recibe solo los avisos de SUS despachos (ver más abajo), no los de todo el equipo.
const TODOS_LOS_ROLES = ROLES_VALIDOS.filter(r => r !== 'supervisor')

// Avisos de despachos. Lee los datos que necesita desde la base (nombre del cliente, número de la
// cotización, forma de pago) para que el aviso salga igual sin importar quién lo disparó.
const TIPOS = {
  creado: { roles: ['administracion', 'jefe'] },
  venta_rapida: { roles: ['administracion', 'jefe'] },
  despachada: { roles: ['vendedor', 'logistica'] },
  entregada: { roles: ['vendedor'] },
  anulada: { roles: TODOS_LOS_ROLES },
}

const AVISA_AL_DUENO = new Set(['despachada', 'entregada', 'anulada'])

export function avisarDespacho(env, { tipo, despachoId, actor }) {
  if (!TIPOS[tipo] || !isValidUuid(despachoId)) return Promise.resolve()
  return programar(env, async () => {
    const headers = dbHeaders(env)
    const get = async p => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { headers }); return r.ok ? (await r.json())[0] : null }
    const d = await get(`notas_despacho?id=eq.${despachoId}&select=numero,cotizacion_id,cliente_id,forma_pago,vendedor_id`)
    if (!d) return
    const [cot, cli] = await Promise.all([
      isValidUuid(d.cotizacion_id) ? get(`cotizaciones?id=eq.${d.cotizacion_id}&select=numero`) : null,
      isValidUuid(d.cliente_id) ? get(`clientes?id=eq.${d.cliente_id}&select=nombre`) : null,
    ])
    const cliente = cli?.nombre || 'cliente'
    const numCot = cot?.numero ? String(cot.numero).padStart(5, '0') : '—'
    const num = tipo === 'venta_rapida' ? (d.numero ?? '—') : numCot
    const esCod = /cobro a destino/i.test(typeof d.forma_pago === 'string' ? d.forma_pago : JSON.stringify(d.forma_pago || ''))
    const quien = actor?.nombre || 'usuario'
    const cod = esCod ? ' [COD]' : ''

    const textos = {
      creado: { title: `🚚 Orden de Despacho Creada${cod}`, message: `Despacho para cotización #${numCot} — ${cliente}${esCod ? ' (Cobro a Destino)' : ''}`, tag: `despacho-${numCot}` },
      venta_rapida: { title: `Venta Rápida Creada${cod}`, message: `Despacho #${num} — ${cliente}${esCod ? ' (Cobro a Destino)' : ''}`, tag: `venta-rapida-${d.numero}` },
      despachada: { title: '🚚 Despacho en Ruta', message: `Despacho #${numCot} — ${cliente} despachado por ${quien}`, tag: `despacho-ruta-${numCot}` },
      entregada: { title: '✅ Despacho Entregado', message: `Despacho #${numCot} — ${cliente} entregado (marcado por ${quien})`, tag: `despacho-entregado-${numCot}` },
      anulada: { title: '❌ Despacho Cancelado', message: `Despacho #${numCot} — ${cliente} cancelado por ${quien}`, tag: `despacho-cancelado-${numCot}` },
    }[tipo]

    await enviarPush(env, { ...textos, url: '/despachos', roles: TIPOS[tipo].roles, excluirUsuarioId: actor?.id, usuarioNombre: quien })

    // Si el dueño del despacho es un supervisor, se le avisa de lo suyo (no recibe los del resto del equipo)
    if (AVISA_AL_DUENO.has(tipo) && isValidUuid(d.vendedor_id) && d.vendedor_id !== actor?.id) {
      const dueno = await get(`usuarios?id=eq.${d.vendedor_id}&select=rol`)
      if (dueno?.rol === 'supervisor') {
        await enviarPush(env, { ...textos, url: '/despachos', userId: d.vendedor_id, excluirUsuarioId: actor?.id, usuarioNombre: quien })
      }
    }
  })
}
