// Limpieza nocturna de cotizaciones — OP-2026-067 (opción B, decidida por el dueño 2026-11-24)
//
// Antes: a los 15 días desde la CREACIÓN anulaba, y a los 30 días BORRABA para siempre,
// sin dejar rastro de cuáles. Ahora:
//   1. Sin movimiento en 30 días (según la última modificación):
//        enviada  → vencida
//        borrador → anulada  (la base no permite borrador → vencida)
//      Cada una queda en la auditoría (número, cliente, vendedor, monto).
//   2. Vencidas, rechazadas o anuladas sin movimiento en 1 año → se borran,
//      pero ANTES se guarda en la auditoría una copia completa (cabecera y productos).
//      Si la copia no se guarda, no se borra. Las que tienen despacho, comisiones u
//      otros vínculos no se pueden borrar y se dejan como están.
//   3. Las aceptadas nunca se tocan.
//   4. Corre una sola vez por noche aunque la nube dispare la tarea dos veces.

const DIA_MS = 24 * 60 * 60 * 1000
export const DIAS_PARA_VENCER = 30
export const DIAS_PARA_BORRAR = 365
const LOTE_MAXIMO = 200
const MARCA_INICIO = 'Limpieza automática de cotizaciones iniciada'
const VENTANA_CANDADO_MS = 60 * 60 * 1000

function cabeceras(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function leerJson(res) {
  try { return await res.json() } catch { return null }
}

async function anotarLog(env, nivel, mensaje, meta) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/system_logs`, {
      method: 'POST',
      headers: cabeceras(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ nivel, origen: 'worker-cron', categoria: 'SISTEMA', mensaje, meta: meta || {} }),
    })
  } catch { /* el registro nunca bloquea la limpieza */ }
}

// Candado: cada ejecución deja una marca; solo sigue la que tenga la marca más antigua
// de la última hora. Si dos ejecuciones arrancan a la vez, ambas ven la misma "primera".
async function tomarCandado(env, ahora) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/system_logs?select=id`, {
    method: 'POST',
    headers: cabeceras(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({ nivel: 'info', origen: 'worker-cron', categoria: 'SISTEMA', mensaje: MARCA_INICIO, meta: {} }),
  })
  if (!res.ok) throw new Error(`No se pudo dejar la marca de inicio: ${res.status}`)
  const [mia] = (await leerJson(res)) || []
  const desde = new Date(ahora.getTime() - VENTANA_CANDADO_MS).toISOString()
  const primeraRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/system_logs?origen=eq.worker-cron&mensaje=eq.${encodeURIComponent(MARCA_INICIO)}&ts=gte.${desde}&select=id&order=ts.asc,id.asc&limit=1`,
    { headers: cabeceras(env) }
  )
  if (!primeraRes.ok) throw new Error(`No se pudo revisar el candado: ${primeraRes.status}`)
  const [primera] = (await leerJson(primeraRes)) || []
  return Boolean(mia?.id && primera?.id && String(primera.id) === String(mia.id))
}

function filaAuditoria(cot, accion, descripcion, meta) {
  return {
    usuario_id: null,
    usuario_nombre: 'Sistema',
    usuario_rol: 'sistema',
    categoria: 'COTIZACION',
    accion,
    descripcion,
    entidad_tipo: 'cotizacion',
    entidad_id: cot.id,
    cuenta_id: cot.cuenta_id ?? null,
    meta,
  }
}

async function guardarAuditoria(env, filas) {
  if (filas.length === 0) return true
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
    method: 'POST',
    headers: cabeceras(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify(filas),
  })
  return res.ok
}

// Paso 1: vencer (enviada → vencida) o anular (borrador → anulada) por inactividad.
async function vencerInactivas(env, corte, results) {
  const sel = 'id,numero,estado,cliente_id,vendedor_id,total_usd,actualizado_en,cuenta_id'
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cotizaciones?actualizado_en=lt.${corte}&estado=in.(borrador,enviada)&select=${sel}&order=actualizado_en.asc&limit=${LOTE_MAXIMO}`,
    { headers: cabeceras(env) }
  )
  if (!res.ok) { results.errors.push(`Leer inactivas: ${res.status} ${await res.text().catch(() => '')}`); return }
  const filas = (await leerJson(res)) || []

  for (const [estadoOrigen, estadoDestino, accion] of [
    ['enviada', 'vencida', 'VENCER_COTIZACION_AUTO'],
    ['borrador', 'anulada', 'ANULAR_BORRADOR_AUTO'],
  ]) {
    const grupo = filas.filter(c => c.estado === estadoOrigen)
    if (grupo.length === 0) continue
    const ids = grupo.map(c => c.id)
    const patch = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=in.(${ids.join(',')})&estado=eq.${estadoOrigen}&select=id`,
      { method: 'PATCH', headers: cabeceras(env, { Prefer: 'return=representation' }), body: JSON.stringify({ estado: estadoDestino }) }
    )
    if (!patch.ok) { results.errors.push(`Pasar ${estadoOrigen}→${estadoDestino}: ${patch.status} ${await patch.text().catch(() => '')}`); continue }
    const cambiadas = new Set(((await leerJson(patch)) || []).map(r => r.id))
    const hechas = grupo.filter(c => cambiadas.has(c.id))
    if (estadoDestino === 'vencida') results.vencidas += hechas.length
    else results.anuladas += hechas.length

    const ok = await guardarAuditoria(env, hechas.map(c => filaAuditoria(
      c, accion,
      `Cotización #${c.numero} pasó de ${estadoOrigen} a ${estadoDestino} por ${DIAS_PARA_VENCER} días sin movimiento`,
      { numero: c.numero, estado_anterior: estadoOrigen, estado_nuevo: estadoDestino, cliente_id: c.cliente_id, vendedor_id: c.vendedor_id, total_usd: c.total_usd, ultimo_movimiento: c.actualizado_en }
    )))
    if (!ok) results.errors.push(`Auditoría de ${hechas.length} cotizaciones ${estadoDestino}s no se guardó`)
  }
}

// Paso 2: borrar las inactivas hace más de 1 año, con copia completa previa.
async function borrarAntiguas(env, corte, results) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cotizaciones?actualizado_en=lt.${corte}&estado=in.(vencida,rechazada,anulada)&select=*,cotizacion_items(*)&order=actualizado_en.asc&limit=${LOTE_MAXIMO}`,
    { headers: cabeceras(env) }
  )
  if (!res.ok) { results.errors.push(`Leer antiguas: ${res.status} ${await res.text().catch(() => '')}`); return }
  const filas = (await leerJson(res)) || []

  for (const cot of filas) {
    const { cotizacion_items: items, ...cabecera } = cot
    // 1) Copia completa en la auditoría. Sin copia, no se borra.
    const copiada = await guardarAuditoria(env, [filaAuditoria(
      cot, 'ELIMINAR_COTIZACION_AUTO',
      `Cotización #${cot.numero} (${cot.estado}) eliminada por ${DIAS_PARA_BORRAR} días sin movimiento. Copia completa en meta.`,
      { numero: cot.numero, copia_cotizacion: cabecera, copia_items: items || [] }
    )])
    if (!copiada) { results.omitidas++; results.errors.push(`Copia de #${cot.numero} no se guardó; no se borró`); continue }

    // 2) Borrar. Si tiene despacho, comisiones u otro vínculo, la base lo impide y se deja.
    const del = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cot.id}&estado=eq.${cot.estado}`, {
      method: 'DELETE', headers: cabeceras(env, { Prefer: 'return=representation' }),
    })
    const borradas = del.ok ? ((await leerJson(del)) || []).length : 0
    if (borradas > 0) results.eliminadas++
    else {
      results.omitidas++
      await guardarAuditoria(env, [filaAuditoria(
        cot, 'ELIMINAR_COTIZACION_AUTO_FALLIDO',
        `Cotización #${cot.numero} no se pudo borrar (tiene vínculos o cambió); se conserva.`,
        { numero: cot.numero, status: del.status }
      )])
    }
  }
}

export async function runCleanupCotizaciones(env, { ahora = new Date() } = {}) {
  const corteVencer = new Date(ahora.getTime() - DIAS_PARA_VENCER * DIA_MS).toISOString()
  const corteBorrar = new Date(ahora.getTime() - DIAS_PARA_BORRAR * DIA_MS).toISOString()
  const results = { success: true, omitida: false, vencidas: 0, anuladas: 0, eliminadas: 0, omitidas: 0, errors: [] }

  try {
    if (!(await tomarCandado(env, ahora))) {
      results.omitida = true
      return results
    }

    await vencerInactivas(env, corteVencer, results)
    await borrarAntiguas(env, corteBorrar, results)

    await anotarLog(env, results.errors.length > 0 ? 'warning' : 'info',
      `Limpieza automática de cotizaciones completada. Vencidas (enviadas, ${DIAS_PARA_VENCER} días sin movimiento): ${results.vencidas}. ` +
      `Borradores anulados: ${results.anuladas}. Eliminadas con copia (${DIAS_PARA_BORRAR} días): ${results.eliminadas}. No borradas: ${results.omitidas}.`,
      { corte_vencer: corteVencer, corte_borrar: corteBorrar, ...results }
    )
  } catch (err) {
    results.success = false
    results.errors.push(err.message)
    await anotarLog(env, 'error', `Error fatal en la limpieza automática de cotizaciones: ${err.message}`, { error: err.message })
  }
  return results
}
