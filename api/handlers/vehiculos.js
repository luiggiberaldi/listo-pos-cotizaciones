// api/handlers/vehiculos.js
// Catálogo de vehículos de la flota propia + reporte de productividad por
// vehículo y por chofer local (plan: docs/plans/2026-10-26-plan-flota-vehiculos-choferes.md).
// Escritura SOLO vía Worker (service_role): la tabla vehiculos no acepta
// escrituras directas del navegador (raíl R2).
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

// Los días del reporte son días de Venezuela (UTC-4, sin horario de verano):
// sin esto, un despacho de las 11 p. m. caía en el día siguiente.
const HORA_CARACAS = '-04:00'

const ROLES_GESTION  = ['jefe', 'administracion', 'logistica', 'desarrollador']
const ROLES_ELIMINAR = ['jefe', 'administracion', 'logistica', 'desarrollador']
// El supervisor queda fuera del reporte de flota porque muestra comisiones
// (raíl R13: los montos que se pagan a choferes solo los ven admin/dev/logística/jefe).
const ROLES_REPORTE  = ['jefe', 'logistica', 'desarrollador']

function fechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return false
  const [year, month, day] = fecha.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function requireCuenta(operador, request) {
  if (!isValidUuid(operador?.cuenta_id)) {
    return { error: jsonError('Cuenta del operador no disponible', 403, request) }
  }
  return { cuentaId: operador.cuenta_id, filter: `cuenta_id=eq.${operador.cuenta_id}` }
}

function textoRequerido(valor, campo) {
  const t = String(valor ?? '').trim()
  if (!t) return { error: `${campo} es requerido` }
  return { valor: t }
}

// Devuelve un mensaje si la placa del chuto o la de la batea ya la usa otro camión
// de la cuenta (excluyendo `excluirId` al editar); null si no hay choque.
async function placaRepetida(env, headers, filtroCuenta, { placa, placa_batea }, excluirId = null) {
  const excluir = excluirId ? `&id=neq.${excluirId}` : ''
  const revisar = [['placa', placa, 'del chuto'], ['placa_batea', placa_batea, 'de batea']]
  for (const [columna, valor, texto] of revisar) {
    if (!valor) continue
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/vehiculos?${filtroCuenta}&${columna}=eq.${encodeURIComponent(valor)}${excluir}&select=id&limit=1`,
      { headers }
    )
    const filas = res.ok ? await res.json() : []
    if (Array.isArray(filas) && filas.length > 0) return `Ya existe otro vehículo con la placa ${texto} ${valor}`
  }
  return null
}

/**
 * Comprueba que un vehículo elegido para un viaje sea de la cuenta y esté
 * activo (raíl R8). Devuelve { ok } o { error } con un mensaje para el usuario.
 */
export async function validarVehiculoDeCuenta({ env, headers, cuentaId, vehiculoId }) {
  if (!vehiculoId) return { ok: true }
  if (!isValidUuid(vehiculoId)) return { error: 'vehiculoId inválido' }
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/vehiculos?id=eq.${vehiculoId}&cuenta_id=eq.${cuentaId}&select=id,activo&limit=1`,
    { headers }
  )
  if (!res.ok) return { error: 'No se pudo validar el vehículo' }
  const [vehiculo] = await res.json()
  if (!vehiculo) return { error: 'El vehículo no existe en esta cuenta' }
  if (!vehiculo.activo) return { error: 'El vehículo está inactivo; elige otro' }
  return { ok: true }
}

/**
 * Fija el vehículo habitual de un chofer local.
 * Usado por los flujos "Dejar este vehículo como el nuevo camión fijo".
 * Valida que el vehículo sea de la cuenta y esté activo, y que el chofer sea local.
 */
export async function guardarVehiculoHabitual({ env, headers, cuentaId, transportistaId, vehiculoId }) {
  if (!transportistaId || !vehiculoId) return { ok: true }
  const valido = await validarVehiculoDeCuenta({ env, headers, cuentaId, vehiculoId })
  if (valido.error) return valido
  const trRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/transportistas?id=eq.${transportistaId}&cuenta_id=eq.${cuentaId}&select=es_local&limit=1`,
    { headers }
  )
  const [chofer] = trRes.ok ? await trRes.json() : []
  if (!chofer?.es_local) return { error: 'Solo los choferes locales tienen camión fijo' }
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/transportistas?id=eq.${transportistaId}&cuenta_id=eq.${cuentaId}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ vehiculo_habitual_id: vehiculoId }),
    }
  )
  if (!res.ok) return { error: await res.text().catch(() => '') }
  return { ok: true }
}

// ── GET /api/vehiculos/listar ─────────────────────────────────────────────────
export async function handleListarVehiculos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error

  const url = new URL(request.url)
  const incluirInactivos = url.searchParams.get('incluir_inactivos') === 'true'
  const activoFilter = incluirInactivos ? '' : 'activo=eq.true&'

  const vehRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/vehiculos?${cuenta.filter}&${activoFilter}order=nombre.asc` +
    `&select=id,codigo,nombre,placa,placa_batea,modelo,capacidad_kg,color_batea,activo,creado_en`,
    { headers }
  )
  if (!vehRes.ok) {
    const err = await vehRes.text().catch(() => '')
    return jsonError(`Error al listar vehículos: ${err}`, 500, request)
  }
  const vehiculos = await vehRes.json()

  // Choferes con vehículo habitual, para mostrar en cada tarjeta quién lo maneja.
  const choferesRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/transportistas?${cuenta.filter}` +
    `&vehiculo_habitual_id=not.is.null&order=nombre.asc&select=id,nombre,activo,vehiculo_habitual_id`,
    { headers }
  )
  const choferes = choferesRes.ok ? await choferesRes.json() : []

  const lista = vehiculos.map(vh => ({
    ...vh,
    choferes_asignados: choferes
      .filter(c => c.vehiculo_habitual_id === vh.id)
      .map(c => ({ id: c.id, nombre: c.nombre, activo: c.activo })),
  }))

  return json({ ok: true, vehiculos: lista }, 200, request)
}

// Siguiente código interno de la cuenta: CAM-01, CAM-02… (sigue al mayor CAM-NN existente;
// los creados por la carga histórica usan VEH-… y no interfieren).
async function siguienteCodigoVehiculo(env, headers, filtroCuenta) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/vehiculos?${filtroCuenta}&select=codigo`, { headers })
  const filas = res.ok ? await res.json() : []
  const mayor = (Array.isArray(filas) ? filas : []).reduce((max, f) => {
    const m = /^CAM-(\d+)$/i.exec(String(f?.codigo || '').trim())
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return `CAM-${String(mayor + 1).padStart(2, '0')}`
}

// ── POST /api/vehiculos/crear ─────────────────────────────────────────────────
export async function handleCrearVehiculo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_GESTION.includes(operador.rol)) {
    return jsonError('Acceso denegado: no puedes crear vehículos', 403, request)
  }
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { nombre, placa, capacidad_kg, color_batea, modelo, placa_batea } = body

  const n = textoRequerido(nombre, 'El modelo')
  if (n.error) return jsonError(n.error, 400, request)
  // Al menos una placa: la del chuto (opcional desde 287) o la de la batea.
  const placaNorm = String(placa ?? '').trim().toUpperCase() || null
  const bateaNorm = String(placa_batea ?? '').trim().toUpperCase() || null
  if (!placaNorm && !bateaNorm) {
    return jsonError('Indica al menos una placa: la del chuto o la de la batea', 400, request)
  }

  let capacidad = 0
  if (capacidad_kg !== undefined && capacidad_kg !== null && capacidad_kg !== '') {
    capacidad = Number(capacidad_kg)
    if (!Number.isFinite(capacidad) || capacidad < 0) {
      return jsonError('capacidad_kg inválida (debe ser un número mayor o igual a 0)', 400, request)
    }
  }

  // Placas únicas por cuenta (el índice único también protege la del chuto, pero
  // aquí damos un mensaje amable en lugar del error crudo de la base de datos).
  const dupError = await placaRepetida(env, headers, cuenta.filter, { placa: placaNorm, placa_batea: bateaNorm })
  if (dupError) return jsonError(dupError, 400, request)

  // El código es interno (CAM-01, CAM-02…): lo pone el servidor, nadie lo escribe ni lo ve.
  const codigo = await siguienteCodigoVehiculo(env, headers, cuenta.filter)

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/vehiculos`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      cuenta_id: cuenta.cuentaId,
      codigo,
      nombre: n.valor,
      placa: placaNorm,
      capacidad_kg: capacidad,
      color_batea: color_batea ? String(color_batea).trim() : null,
      modelo: modelo ? String(modelo).trim() : null,
      placa_batea: bateaNorm,
      activo: true,
    }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    return jsonError(`Error al crear vehículo: ${err}`, 500, request)
  }
  const [vehiculo] = await res.json()

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null
  registrarAuditoria(env, headers, {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    categoria: 'VEHICULO',
    accion: 'CREAR_VEHICULO',
    descripcion: `Vehículo ${n.valor} (${placaNorm || bateaNorm}) creado`,
    entidadTipo: 'vehiculo',
    entidadId: vehiculo.id,
    meta: { codigo, placa: placaNorm, capacidad_kg: capacidad },
    ip,
  }).catch(() => {})

  return json({ ok: true, vehiculo }, 201, request)
}

// ── POST /api/vehiculos/actualizar ────────────────────────────────────────────
export async function handleActualizarVehiculo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_GESTION.includes(operador.rol)) {
    return jsonError('Acceso denegado: no puedes editar vehículos', 403, request)
  }
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id } = body
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)

  const camposPermitidos = ['nombre', 'placa', 'placa_batea', 'modelo', 'capacidad_kg', 'color_batea', 'activo']
  const updateData = Object.fromEntries(
    camposPermitidos.filter(campo => Object.prototype.hasOwnProperty.call(body, campo))
      .map(campo => [campo, body[campo]])
  )
  if (Object.keys(updateData).length === 0) {
    return jsonError('No hay campos permitidos para actualizar', 400, request)
  }

  if (updateData.placa !== undefined) {
    updateData.placa = String(updateData.placa ?? '').trim().toUpperCase() || null
  }
  if (updateData.placa_batea !== undefined) {
    updateData.placa_batea = String(updateData.placa_batea ?? '').trim().toUpperCase() || null
  }
  if (updateData.placa !== undefined || updateData.placa_batea !== undefined) {
    // Estado final: lo que llega + lo que ya tenía el camión. Debe quedar al menos una placa.
    const actRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/vehiculos?id=eq.${id}&cuenta_id=eq.${cuenta.cuentaId}&select=placa,placa_batea&limit=1`,
      { headers }
    )
    const [actual] = actRes.ok ? await actRes.json() : []
    if (!actual) return jsonError('Vehículo no encontrado', 404, request)
    const placaFinal = updateData.placa !== undefined ? updateData.placa : actual.placa
    const bateaFinal = updateData.placa_batea !== undefined ? updateData.placa_batea : actual.placa_batea
    if (!placaFinal && !bateaFinal) {
      return jsonError('El vehículo debe conservar al menos una placa: la del chuto o la de la batea', 400, request)
    }
    const dupError = await placaRepetida(env, headers, cuenta.filter, {
      placa: updateData.placa !== undefined ? updateData.placa : null,
      placa_batea: updateData.placa_batea !== undefined ? updateData.placa_batea : null,
    }, id)
    if (dupError) return jsonError(dupError, 400, request)
  }
  if (updateData.modelo !== undefined) {
    updateData.modelo = String(updateData.modelo ?? '').trim() || null
  }
  if (updateData.nombre !== undefined) {
    const n = textoRequerido(updateData.nombre, 'El modelo')
    if (n.error) return jsonError(n.error, 400, request)
    updateData.nombre = n.valor
  }
  if (updateData.capacidad_kg !== undefined && updateData.capacidad_kg !== null && updateData.capacidad_kg !== '') {
    const cap = Number(updateData.capacidad_kg)
    if (!Number.isFinite(cap) || cap < 0) {
      return jsonError('capacidad_kg inválida (debe ser un número mayor o igual a 0)', 400, request)
    }
    updateData.capacidad_kg = cap
  } else if (updateData.capacidad_kg === null || updateData.capacidad_kg === '') {
    updateData.capacidad_kg = 0
  }
  if (updateData.activo !== undefined && typeof updateData.activo !== 'boolean') {
    return jsonError('activo debe ser verdadero o falso', 400, request)
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/vehiculos?id=eq.${id}&cuenta_id=eq.${cuenta.cuentaId}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(updateData),
    }
  )
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    return jsonError(`Error al actualizar vehículo: ${err}`, 500, request)
  }
  const data = await res.json()
  const actualizado = data[0]
  if (!actualizado) return jsonError('Vehículo no encontrado en esta cuenta', 404, request)

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null
  registrarAuditoria(env, headers, {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    categoria: 'VEHICULO',
    accion: 'ACTUALIZAR_VEHICULO',
    descripcion: `Vehículo ${actualizado.nombre || id} actualizado`,
    entidadTipo: 'vehiculo',
    entidadId: id,
    meta: { campos_modificados: Object.keys(updateData) },
    ip,
  }).catch(() => {})

  return json({ ok: true, vehiculo: actualizado }, 200, request)
}

// ── POST /api/vehiculos/eliminar ──────────────────────────────────────────────
// Invoca eliminar_o_desactivar_vehiculo_atomico: borra si tiene 0 viajes
// (desenlazando cotizaciones, nunca borrándolas), desactiva si tiene historial.
export async function handleEliminarVehiculo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ELIMINAR.includes(operador.rol)) {
    return jsonError('Acceso denegado: no puedes dar de baja vehículos', 403, request)
  }
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id } = body
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/eliminar_o_desactivar_vehiculo_atomico`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_cuenta_id: cuenta.cuentaId, p_vehiculo_id: id }),
  })
  const texto = await res.text().catch(() => '')
  if (!res.ok) {
    if (texto.includes('VEHICULO_NO_ENCONTRADO')) {
      return jsonError('Vehículo no encontrado en esta cuenta', 404, request)
    }
    return jsonError(`No se pudo eliminar el vehículo: ${texto}`, 500, request)
  }
  let resultado = {}
  try { resultado = texto ? JSON.parse(texto) : {} } catch { /* respuesta vacía */ }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null
  registrarAuditoria(env, headers, {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    categoria: 'VEHICULO',
    accion: 'ELIMINAR_O_DESACTIVAR_VEHICULO',
    descripcion: resultado.accion === 'eliminado_fisico'
      ? `Vehículo ${id} eliminado (sin viajes en el historial)`
      : `Vehículo ${id} desactivado (tenía ${resultado.viajes_historicos ?? '?'} viajes)`,
    entidadTipo: 'vehiculo',
    entidadId: id,
    meta: resultado,
    ip,
  }).catch(() => {})

  return json({ ok: true, ...resultado }, 200, request)
}

// ── GET /api/reportes/flota-choferes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD ────────
export async function handleReporteFlotaChoferes(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_REPORTE.includes(operador.rol)) {
    return jsonError('Acceso denegado: no tienes permiso para ver este reporte', 403, request)
  }
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error

  const url = new URL(request.url)
  const desde = url.searchParams.get('desde') || '2000-01-01'
  const hasta = url.searchParams.get('hasta')
  if (!fechaValida(desde)) return jsonError('desde inválida (formato YYYY-MM-DD)', 400, request)
  const hastaFinal = hasta || new Date().toISOString().slice(0, 10)
  if (!fechaValida(hastaFinal)) return jsonError('hasta inválida (formato YYYY-MM-DD)', 400, request)
  if (desde > hastaFinal) return jsonError('desde no puede ser mayor que hasta', 400, request)

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/obtener_reporte_flota_y_choferes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_cuenta_id: cuenta.cuentaId,
      p_fecha_inicio: `${desde}T00:00:00${HORA_CARACAS}`,
      p_fecha_fin: `${hastaFinal}T23:59:59.999${HORA_CARACAS}`,
    }),
  })
  const texto = await res.text().catch(() => '')
  if (!res.ok) {
    return jsonError(`No se pudo generar el reporte de flota: ${texto}`, 500, request)
  }
  let resultado = {}
  try { resultado = texto ? JSON.parse(texto) : {} } catch { /* respuesta vacía */ }

  return json({ ok: true, desde, hasta: hastaFinal, ...resultado }, 200, request)
}

// ── GET /api/reportes/flota-viajes?desde&hasta&vehiculo_id=…|sin_camion=true ──
// Detalle viaje por viaje del reporte de flota (para revisar cualquier número).
export async function handleDetalleViajesFlota(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_REPORTE.includes(operador.rol)) {
    return jsonError('Acceso denegado: no tienes permiso para ver este reporte', 403, request)
  }
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error

  const url = new URL(request.url)
  const desde = url.searchParams.get('desde') || '2000-01-01'
  const hastaFinal = url.searchParams.get('hasta') || new Date().toISOString().slice(0, 10)
  if (!fechaValida(desde)) return jsonError('desde inválida (formato YYYY-MM-DD)', 400, request)
  if (!fechaValida(hastaFinal)) return jsonError('hasta inválida (formato YYYY-MM-DD)', 400, request)
  if (desde > hastaFinal) return jsonError('desde no puede ser mayor que hasta', 400, request)
  const vehiculoId = url.searchParams.get('vehiculo_id') || null
  if (vehiculoId && !isValidUuid(vehiculoId)) return jsonError('vehiculo_id inválido', 400, request)
  const soloSinCamion = url.searchParams.get('sin_camion') === 'true'

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/obtener_detalle_viajes_flota`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_cuenta_id: cuenta.cuentaId,
      p_fecha_inicio: `${desde}T00:00:00${HORA_CARACAS}`,
      p_fecha_fin: `${hastaFinal}T23:59:59.999${HORA_CARACAS}`,
      p_vehiculo_id: vehiculoId,
      p_solo_sin_camion: soloSinCamion,
    }),
  })
  const texto = await res.text().catch(() => '')
  if (!res.ok) return jsonError(`No se pudo obtener el detalle de viajes: ${texto}`, 500, request)
  let resultado = {}
  try { resultado = texto ? JSON.parse(texto) : {} } catch { /* respuesta vacía */ }
  return json({ ok: true, desde, hasta: hastaFinal, viajes: resultado.viajes || [] }, 200, request)
}
