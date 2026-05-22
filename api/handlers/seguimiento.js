// api/handlers/seguimiento.js
import { json, jsonError, corsHeaders, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria, logToSystem } from '../lib/audit.js'

export async function handleGetSeguimiento(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user } = v

  const url = new URL(request.url)
  const clienteId = url.searchParams.get('cliente_id')
  const cotizacionId = url.searchParams.get('cotizacion_id')
  const despachoId = url.searchParams.get('despacho_id')

  let queryUrl = `${env.SUPABASE_URL}/rest/v1/seguimiento_operativo?cuenta_id=eq.${user.id}`

  if (clienteId && isValidUuid(clienteId)) {
    queryUrl += `&cliente_id=eq.${clienteId}`
  }
  if (cotizacionId && isValidUuid(cotizacionId)) {
    queryUrl += `&cotizacion_id=eq.${cotizacionId}`
  }
  if (despachoId && isValidUuid(despachoId)) {
    queryUrl += `&despacho_id=eq.${despachoId}`
  }

  // Ordenar: primero las notas fijadas arriba y luego por fecha más reciente
  queryUrl += `&select=id,cliente_id,cotizacion_id,despacho_id,usuario_id,tipo,prioridad,fijada,titulo,contenido,imagenes,creado_en,actualizado_en,usuario:usuarios!seguimiento_operativo_usuario_id_fkey(id,nombre,color,rol),cliente:clientes(id,codigo_cliente,nombre,rif_cedula,telefono,email,direccion,estado,ciudad,saldo_pendiente,activo,vendedor:usuarios!clientes_vendedor_id_fkey(id,nombre,color,rol)),cotizacion:cotizaciones(id,numero),despacho:notas_despacho(id,numero,creado_en,total_usd,flete_usd,corte_usd,descuento_total_usd,estado,forma_pago,vendedor:usuarios!notas_despacho_vendedor_id_fkey(id,nombre,color,rol))&order=fijada.desc,creado_en.desc`

  const res = await fetch(queryUrl, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    }
  })

  if (!res.ok) {
    const errText = await res.text()
    return jsonError(`Error al cargar seguimiento: ${errText}`, res.status, request)
  }

  const data = await res.json()
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  })
}

export async function handleCrearSeguimiento(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user, operador, headers, ip } = v

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }

  const { cliente_id, cotizacion_id, despacho_id, tipo, prioridad, titulo, contenido, imagenes, fijada } = body

  if (!contenido?.trim()) {
    return jsonError('El contenido de la nota no puede estar vacío', 400, request)
  }

  const tipoValido = ['nota', 'incidencia', 'aclaratoria', 'seguimiento', 'evidencia', 'resolucion'].includes(tipo) ? tipo : 'nota'
  const prioridadValida = ['pendiente', 'resuelta', 'informativa', 'urgente'].includes(prioridad) ? prioridad : 'informativa'

  const payload = {
    cliente_id: cliente_id && isValidUuid(cliente_id) ? cliente_id : null,
    cotizacion_id: cotizacion_id && isValidUuid(cotizacion_id) ? cotizacion_id : null,
    despacho_id: despacho_id && isValidUuid(despacho_id) ? despacho_id : null,
    usuario_id: operador.id,
    tipo: tipoValido,
    prioridad: prioridadValida,
    titulo: titulo?.trim() || null,
    contenido: contenido.trim(),
    imagenes: Array.isArray(imagenes) ? imagenes : [],
    fijada: fijada === undefined ? true : !!fijada,
    cuenta_id: user.id
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/seguimiento_operativo`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text()
    return jsonError(`Error al guardar entrada de seguimiento: ${errText}`, res.status, request)
  }

  const data = await res.json()
  const nuevaEntrada = Array.isArray(data) ? data[0] : data

  // Registrar Auditoría
  try {
    let cat = 'CLIENTE'
    let entTipo = 'clientes'
    let entId = cliente_id || null
    let desc = `Operador ${operador.nombre} agregó una nota de seguimiento operativo.`

    if (cotizacion_id) {
      cat = 'COTIZACION'
      entTipo = 'cotizaciones'
      entId = cotizacion_id
      desc = `Operador ${operador.nombre} agregó una nota a la cotización.`
    } else if (despacho_id) {
      cat = 'COTIZACION'
      entTipo = 'notas_despacho'
      entId = despacho_id
      desc = `Operador ${operador.nombre} agregó una nota al despacho.`
    } else if (cliente_id) {
      cat = 'CLIENTE'
      entTipo = 'clientes'
      entId = cliente_id
      desc = `Operador ${operador.nombre} agregó una nota al cliente.`
    }

    await registrarAuditoria(env, headers, {
      usuarioId: operador.id,
      usuarioNombre: operador.nombre,
      usuarioRol: operador.rol,
      categoria: cat,
      accion: 'CREAR_SEGUIMIENTO',
      descripcion: desc,
      entidadTipo: entTipo,
      entidadId: entId,
      meta: { seguimiento_id: nuevaEntrada.id, tipo: tipoValido, prioridad: prioridadValida },
      ip
    })
  } catch (err) {
    console.error('Error registrando auditoría de seguimiento:', err)
  }

  return json(nuevaEntrada, 201, request)
}

export async function handleActualizarSeguimiento(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user, operador, headers, ip } = v

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }

  const { id, prioridad, fijada, contenido, tipo, imagenes } = body
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request)

  // 1. Obtener entrada actual
  const getRes = await fetch(`${env.SUPABASE_URL}/rest/v1/seguimiento_operativo?id=eq.${id}&cuenta_id=eq.${user.id}`, { headers })
  const [entrada] = await getRes.json()
  if (!entrada) return jsonError('Entrada no encontrada', 404, request)

  const updates = {}
  if (prioridad !== undefined) updates.prioridad = prioridad
  if (fijada !== undefined) updates.fijada = !!fijada
  if (contenido !== undefined) updates.contenido = contenido.trim()
  if (tipo !== undefined) updates.tipo = tipo
  if (imagenes !== undefined) updates.imagenes = Array.isArray(imagenes) ? imagenes : []

  // 2. Permisos: Creador de la nota puede modificar cualquier campo.
  // Si no es el creador, pero es rol administrativo/privilegiado, SOLO puede modificar 'fijada' (y solo a false)
  const esAutor = entrada.usuario_id === operador.id
  const esPrivilegiado = ['supervisor', 'administracion', 'jefe', 'desarrollador'].includes(operador.rol)

  if (!esAutor) {
    if (esPrivilegiado) {
      const llavesModificadas = Object.keys(updates)
      const tieneModificacionNoPermitida = llavesModificadas.some(k => k !== 'fijada')
      if (tieneModificacionNoPermitida) {
        return jsonError('Solo el creador del seguimiento puede modificar su contenido', 403, request)
      }
      if (updates.fijada === true) {
        return jsonError('Solo el creador del seguimiento puede fijarlo', 403, request)
      }
    } else {
      return jsonError('No tienes permisos para modificar esta nota', 403, request)
    }
  }

  updates.actualizado_en = new Date().toISOString()

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/seguimiento_operativo?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(updates),
  })

  if (!res.ok) {
    const errText = await res.text()
    return jsonError(`Error al actualizar entrada de seguimiento: ${errText}`, res.status, request)
  }

  const data = await res.json()
  const actualizada = Array.isArray(data) ? data[0] : data

  // Auditoría
  try {
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id,
      usuarioNombre: operador.nombre,
      usuarioRol: operador.rol,
      categoria: entrada.cotizacion_id || entrada.despacho_id ? 'COTIZACION' : 'CLIENTE',
      accion: 'ACTUALIZAR_SEGUIMIENTO',
      descripcion: `Operador ${operador.nombre} actualizó la nota de seguimiento #${id}.`,
      entidadTipo: entrada.cotizacion_id ? 'cotizaciones' : entrada.despacho_id ? 'notas_despacho' : 'clientes',
      entidadId: entrada.cotizacion_id || entrada.despacho_id || entrada.cliente_id,
      meta: { updates },
      ip
    })
  } catch (err) {
    console.error('Error registrando auditoría de seguimiento:', err)
  }

  return json(actualizada, 200, request)
}

export async function handleBorrarSeguimiento(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user, operador, headers, ip } = v

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }

  const { id } = body
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request)

  // 1. Obtener entrada actual
  const getRes = await fetch(`${env.SUPABASE_URL}/rest/v1/seguimiento_operativo?id=eq.${id}&cuenta_id=eq.${user.id}`, { headers })
  const [entrada] = await getRes.json()
  if (!entrada) return jsonError('Entrada no encontrada', 404, request)

  // Permisos: SOLO el creador de la nota puede borrarla
  const esAutor = entrada.usuario_id === operador.id
  if (!esAutor) {
    return jsonError('Solo el creador puede borrar esta nota', 403, request)
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/seguimiento_operativo?id=eq.${id}`, {
    method: 'DELETE',
    headers,
  })

  if (!res.ok) {
    const errText = await res.text()
    return jsonError(`Error al borrar entrada de seguimiento: ${errText}`, res.status, request)
  }

  // Auditoría
  try {
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id,
      usuarioNombre: operador.nombre,
      usuarioRol: operador.rol,
      categoria: entrada.cotizacion_id || entrada.despacho_id ? 'COTIZACION' : 'CLIENTE',
      accion: 'BORRAR_SEGUIMIENTO',
      descripcion: `Operador ${operador.nombre} eliminó la nota de seguimiento #${id}.`,
      entidadTipo: entrada.cotizacion_id ? 'cotizaciones' : entrada.despacho_id ? 'notas_despacho' : 'clientes',
      entidadId: entrada.cotizacion_id || entrada.despacho_id || entrada.cliente_id,
      meta: { entrada_borrada: entrada },
      ip
    })
  } catch (err) {
    console.error('Error registrando auditoría de seguimiento:', err)
  }

  return json({ success: true }, 200, request)
}

export async function runPurgeTrackingImages(env) {
  const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
  const queryUrl = `${env.SUPABASE_URL}/rest/v1/seguimiento_operativo?creado_en=lt.${fifteenDaysAgo}&select=id,imagenes,creado_en&limit=1000`

  try {
    const res = await fetch(queryUrl, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      }
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Error al consultar seguimientos: ${errText}`)
    }

    const records = await res.json()
    const recordsWithImages = records.filter(r => Array.isArray(r.imagenes) && r.imagenes.length > 0)

    if (recordsWithImages.length === 0) {
      await logToSystem(env, {
        nivel: 'info',
        origen: 'worker-cron',
        categoria: 'SISTEMA',
        mensaje: 'Purga automática de imágenes: No se encontraron imágenes de seguimiento con antigüedad mayor a 15 días.',
        meta: { cutoffDate: fifteenDaysAgo }
      })
      return { success: true, message: 'No se encontraron imágenes para purgar', deletedImages: 0, updatedRecords: 0 }
    }

    const filenames = []
    for (const record of recordsWithImages) {
      for (const url of record.imagenes) {
        if (typeof url === 'string') {
          const marker = '/seguimiento_evidencias/'
          const index = url.indexOf(marker)
          if (index !== -1) {
            let path = url.substring(index + marker.length)
            const qIndex = path.indexOf('?')
            if (qIndex !== -1) {
              path = path.substring(0, qIndex)
            }
            filenames.push(decodeURIComponent(path))
          }
        }
      }
    }

    let deletedImagesCount = 0
    if (filenames.length > 0) {
      const batchSize = 100
      for (let i = 0; i < filenames.length; i += batchSize) {
        const batch = filenames.slice(i, i + batchSize)
        const delRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/seguimiento_evidencias`, {
          method: 'DELETE',
          headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prefixes: batch })
        })
        if (!delRes.ok) {
          const errText = await delRes.text()
          console.error(`[CRON PURGE] Error eliminando imágenes del storage: ${errText}`)
        } else {
          deletedImagesCount += batch.length
        }
      }
    }

    let updatedRecordsCount = 0
    const recordIds = recordsWithImages.map(r => r.id)
    if (recordIds.length > 0) {
      const batchSize = 100
      for (let i = 0; i < recordIds.length; i += batchSize) {
        const batchIds = recordIds.slice(i, i + batchSize)
        const updRes = await fetch(`${env.SUPABASE_URL}/rest/v1/seguimiento_operativo?id=in.(${batchIds.join(',')})`, {
          method: 'PATCH',
          headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({ imagenes: [] })
        })
        if (!updRes.ok) {
          const errText = await updRes.text()
          console.error(`[CRON PURGE] Error actualizando filas en base de datos: ${errText}`)
        } else {
          updatedRecordsCount += batchIds.length
        }
      }
    }

    await logToSystem(env, {
      nivel: 'info',
      origen: 'worker-cron',
      categoria: 'SISTEMA',
      mensaje: `Purga automática de imágenes de seguimiento completada: se eliminaron ${deletedImagesCount} imágenes de ${updatedRecordsCount} seguimientos con antigüedad mayor a 15 días.`,
      meta: { deletedImagesCount, updatedRecordsCount, cutoffDate: fifteenDaysAgo }
    })

    return {
      success: true,
      message: `Purga completada. Se eliminaron ${deletedImagesCount} imágenes y se actualizaron ${updatedRecordsCount} registros.`,
      deletedImages: deletedImagesCount,
      updatedRecords: updatedRecordsCount
    }
  } catch (err) {
    console.error('[CRON PURGE ERROR]:', err.message)
    await logToSystem(env, {
      nivel: 'error',
      origen: 'worker-cron',
      categoria: 'SISTEMA',
      mensaje: `Error en la purga automática de imágenes: ${err.message}`,
      stack: err.stack?.slice(0, 3000),
      meta: { cutoffDate: fifteenDaysAgo }
    })
    return { success: false, error: err.message }
  }
}
