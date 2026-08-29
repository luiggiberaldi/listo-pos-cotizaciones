// api/handlers/transportistas.js
// Reporte de choferes locales + liquidación de comisiones de fletes fuera de Carabobo.
// Adicionalmente, el reporte y detalle son de solo lectura para admin/dev/logística.
// El pago (FIFO) requiere admin/dev (igual que cxc/abono).
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

const ROLES_REPORTE = ['administracion', 'desarrollador', 'logistica', 'jefe']
const ROLES_PAGAR   = ['administracion', 'desarrollador']

/** Redondea a 4 decimales (misma precisión que NUMERIC(12,4)). */
function r4(n) { return Math.round(Number(n) * 10000) / 10000 }

function fechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return false
  const [year, month, day] = fecha.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function fechaSiguiente(fecha) {
  const [year, month, day] = fecha.split('-').map(Number)
  const siguiente = new Date(Date.UTC(year, month - 1, day + 1))
  return siguiente.toISOString().slice(0, 10)
}

function requireCuenta(operador, request) {
  if (!isValidUuid(operador?.cuenta_id)) {
    return { error: jsonError('Cuenta del operador no disponible', 403, request) }
  }
  return { cuentaId: operador.cuenta_id, filter: `cuenta_id=eq.${operador.cuenta_id}` }
}

const TRANSPORTISTA_SELECTS = [
  { select: '*', soportaClasificacion: true },
  { select: 'id,nombre,rif,telefono,activo,es_local', soportaClasificacion: true },
  { select: 'id,nombre,rif,telefono,activo', soportaClasificacion: false },
]

// Las migraciones de clasificación pueden desplegarse después del frontend/API.
// Reintentamos únicamente el SELECT reducido cuando PostgREST devuelve 400 por
// una columna aún inexistente; no ocultamos errores de autenticación o de red.
async function leerTransportistas(env, cuenta, headers) {
  let ultimoRes
  for (const plan of TRANSPORTISTA_SELECTS) {
    ultimoRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/transportistas?${cuenta.filter}&order=nombre.asc&select=${plan.select}`,
      { headers }
    )
    if (ultimoRes.ok) {
      return { data: await ultimoRes.json(), soportaClasificacion: plan.soportaClasificacion }
    }
    if (ultimoRes.status !== 400) break
  }
  return { response: ultimoRes }
}

// ── GET /api/transportistas/reporte ──────────────────────────────────────────
// Devuelve por transportista: nº despachos, flete total, neto a pagar, pagado, saldo.
export async function handleReporteTransportistas(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_REPORTE.includes(operador.rol)) {
    return jsonError('Acceso denegado: no tienes permiso para ver este reporte', 403, request)
  }
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error

  // Incluir inactivos: una desactivación no debe ocultar saldos históricos.
  const transportistasResult = await leerTransportistas(env, cuenta, headers)
  if (transportistasResult.response && !transportistasResult.response.ok) {
    const detalle = await transportistasResult.response.text().catch(() => '')
    console.error('[TRANSPORTISTAS][REPORTE] Error leyendo transportistas:', detalle)
    return jsonError('Error al leer transportistas. Verifica que las migraciones de clasificación estén aplicadas.', 500, request)
  }
  const transportistas = transportistasResult.data || []
  if (!transportistasResult.soportaClasificacion) {
    return jsonError('La base de datos aún no tiene la clasificación de transportistas locales. Aplica las migraciones 206 y 220.', 503, request)
  }

  // Traer config global (tipo de cálculo + valor) para los locales — filtrada por tenant.
  const cRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?limit=1&${cuenta.filter}` +
    `&select=transp_tipo_calculo,transp_pct_comision,transp_tarifa_fija_usd`,
    { headers }
  )
  const cData = cRes.ok ? await cRes.json() : []
  const configTransp = cData[0] || null
  const tipoCalculo = configTransp?.transp_tipo_calculo === 'fija' ? 'fija' : 'porcentaje'
  const pctComision = Number(configTransp?.transp_pct_comision) || 0
  const tarifaFija  = Number(configTransp?.transp_tarifa_fija_usd) || 0

  // Traer despachos no anulados con transportista asignado.
  // Filtramos los campos estrictamente necesarios para reducir payload.
  // Soporte para filtro de fechas opcional (desde/hasta en formato YYYY-MM-DD).
  const reqUrl = new URL(request.url)
  const desde   = reqUrl.searchParams.get('desde') // YYYY-MM-DD
  const hasta   = reqUrl.searchParams.get('hasta')
  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) {
    return jsonError('Rango de fechas inválido', 400, request)
  }
  if (desde && hasta && desde > hasta) return jsonError('La fecha inicial no puede ser mayor que la final', 400, request)
  // Usar límite exclusivo al día siguiente evita perder registros con
  // milisegundos posteriores a 23:59:59 del día "hasta".
  const fechaFiltro = [
    desde ? `&creado_en=gte.${desde}T00:00:00` : '',
    hasta ? `&creado_en=lt.${fechaSiguiente(hasta)}T00:00:00` : '',
  ].join('')

  const dRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/notas_despacho` +
    `?${cuenta.filter}&transportista_id=not.is.null&estado=neq.anulada${fechaFiltro}` +
    `&select=id,transportista_id,flete_usd,flete_neto_transportista_usd,flete_comisionable,flete_regla_aplicada,flete_pagado,estado,creado_en&limit=5000`,
    { headers }
  )
  if (!dRes.ok) {
    const detalle = await dRes.text().catch(() => '')
    console.error('[TRANSPORTISTAS][REPORTE] Error leyendo despachos:', detalle)
    return jsonError('Error al leer despachos del reporte. Verifica que la migración de liquidación esté aplicada.', 500, request)
  }
  const despachos = await dRes.json()

  // Agregar por transportista (Map preserva orden de inserción).
  const mapa = new Map(transportistas.map(t => [t.id, {
    id: t.id, nombre: t.nombre, rif: t.rif, telefono: t.telefono,
    activo: t.activo !== false,
    es_local: !!t.es_local,
    tipo_relacion: t.tipo_relacion || 'proveedor',
    // El neto de cada despacho viene del snapshot; no inventar una
    // configuración "0%" si la cuenta aún no tiene las columnas nuevas.
    config: configTransp
      ? (tipoCalculo === 'porcentaje'
        ? { tipo_calculo: 'porcentaje', pct_comision: pctComision }
        : { tipo_calculo: 'fija', tarifa_fija_usd: tarifaFija })
      : null,
    despachos: 0, despachos_comisionables: 0, despachos_nomina: 0,
    flete_total_usd: 0, flete_nomina_usd: 0, neto_total_usd: 0,
    pagado_usd: 0, saldo_usd: 0,
  }]))

  for (const d of despachos) {
    const row = mapa.get(d.transportista_id)
    if (!row) continue // transportista inactivo o borrado: lo saltamos
    row.despachos += 1
    row.flete_total_usd += Number(d.flete_usd || 0)
    const neto = Number(d.flete_neto_transportista_usd || 0)
    if (d.flete_comisionable) {
      row.despachos_comisionables += 1
      row.neto_total_usd += neto
      if (d.flete_pagado) row.pagado_usd += neto
      else row.saldo_usd += neto
    } else if (d.flete_regla_aplicada === 'nomina_carabobo') {
      row.despachos_nomina += 1
      row.flete_nomina_usd += Number(d.flete_usd || 0)
    }
  }

  // Redondear y filtrar: solo transportistas locales (los demás no se liquidan aquí)
  const out = [...mapa.values()]
    .map(r => ({
      ...r,
      despachos_comisionables: r.despachos_comisionables,
      despachos_nomina:        r.despachos_nomina,
      flete_total_usd:         r4(r.flete_total_usd),
      flete_nomina_usd:        r4(r.flete_nomina_usd),
      neto_total_usd:          r4(r.neto_total_usd),
      pagado_usd:              r4(r.pagado_usd),
      saldo_usd:               r4(r.saldo_usd),
    }))
    .filter(r => r.es_local)

  return json({ items: out }, 200, request)
}

// ── GET /api/transportistas/detalle?id=UUID ──────────────────────────────────
// Despachos pendientes de pagar del transportista (para FIFO al liquidar) +
// histórico de pagos registrados.
export async function handleDetalleTransportista(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_REPORTE.includes(operador.rol)) {
    return jsonError('Acceso denegado', 403, request)
  }
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error

  const url = new URL(request.url)
  const transportistaId = url.searchParams.get('id')
  if (!transportistaId || !isValidUuid(transportistaId)) {
    return jsonError('id inválido', 400, request)
  }

  // Despachos del transportista (pendientes + ya pagados), orden FIFO.
  const dRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/notas_despacho` +
    `?${cuenta.filter}&transportista_id=eq.${transportistaId}&estado=neq.anulada` +
    `&order=creado_en.asc` +
    `&select=id,numero,creado_en,flete_usd,flete_neto_transportista_usd,flete_comisionable,flete_estado_destino_snapshot,flete_regla_aplicada,flete_pagado,estado&limit=1000`,
    { headers }
  )
  if (!dRes.ok) return jsonError('Error al leer despachos', 500, request)
  const despachos = await dRes.json()

  // Pagos históricos — incluir campos de reversión (migration 207).
  const pagosRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pagos_transportistas?${cuenta.filter}&transportista_id=eq.${transportistaId}` +
    `&order=fecha.desc,creado_en.desc&limit=1000` +
    `&select=id,fecha,monto_usd,monto_aplicado_usd,excedente_usd,referencia,nota,creado_en,revertido,revertido_en,revertido_por_nombre`,
    { headers }
  )
  const pagos = pagosRes.ok ? await pagosRes.json() : []

  const pendientes = despachos
    .filter(d => d.flete_comisionable && !d.flete_pagado && Number(d.flete_neto_transportista_usd || 0) > 0)
    .map(d => ({
      id: d.id,
      numero: d.numero,
      creado_en: d.creado_en,
      flete_usd:      Number(d.flete_usd || 0),
      neto_usd:       Number(d.flete_neto_transportista_usd || 0),
      estado_destino: d.flete_estado_destino_snapshot || null,
      regla:          d.flete_regla_aplicada || null,
      estado:         d.estado,
    }))
  const saldoPendiente = pendientes.reduce((s, d) => s + d.neto_usd, 0)

  return json({
    despachos_pendientes: pendientes,
    saldo_pendiente_usd: r4(saldoPendiente),
    despachos_nomina: despachos
      .filter(d => d.flete_regla_aplicada === 'nomina_carabobo')
      .map(d => ({
        id: d.id,
        numero: d.numero,
        creado_en: d.creado_en,
        flete_usd: Number(d.flete_usd || 0),
        estado_destino: d.flete_estado_destino_snapshot || null,
        estado: d.estado,
      })),
    historico_pagos: (pagos || []).map(p => ({
      id:                   p.id,
      fecha:                p.fecha,
      monto_usd:            Number(p.monto_usd),
      monto_aplicado_usd:   Number(p.monto_aplicado_usd ?? p.monto_usd),
      excedente_usd:        Number(p.excedente_usd || 0),
      referencia:           p.referencia,
      nota:                 p.nota,
      creado_en:            p.creado_en,
      revertido:            !!p.revertido,
      revertido_en:         p.revertido_en || null,
      revertido_por_nombre: p.revertido_por_nombre || null,
    })),
  }, 200, request)
}

// ── POST /api/transportistas/pagar ───────────────────────────────────────────
// Body: { transportistaId, monto, referencia?, nota?, despachoIds? (opcional, FIFO si se omite) }
// Marca FIFO solo sobre comisiones de fletes fuera de Carabobo. La nómina local no se registra aquí.
// Se ejecuta con service_role para bypassar trigger de defensa en profundidad.
export async function handlePagarTransportista(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, ip } = v
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error
  if (!ROLES_PAGAR.includes(operador.rol)) {
    return jsonError('Solo administración o desarrollador pueden liquidar a transportistas', 403, request)
  }

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { transportistaId, monto, referencia, nota, despachoIds, idempotencyKey } = body
  if (!transportistaId || !isValidUuid(transportistaId)) return jsonError('transportistaId inválido', 400, request)
  const montoNum = Number(monto)
  if (!Number.isFinite(montoNum) || montoNum <= 0 || montoNum > 1000000000) return jsonError('Monto inválido', 400, request)
  if (Math.round(montoNum * 10000) !== montoNum * 10000) return jsonError('El monto admite hasta 4 decimales', 400, request)
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 100) {
    return jsonError('idempotencyKey requerida', 400, request)
  }
  if (referencia && String(referencia).length > 160) return jsonError('Referencia demasiado larga', 400, request)
  if (nota && String(nota).length > 500) return jsonError('Nota demasiado larga', 400, request)
  const idsValidos = Array.isArray(despachoIds) ? despachoIds.filter(isValidUuid) : null
  if (Array.isArray(despachoIds) && idsValidos.length !== despachoIds.length) return jsonError('despachoIds inválidos', 400, request)

  // S2-T7: Validar que el transportista es local + activo antes de liquidar
  const svcHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }

  // La liquidación nueva es transaccional y queda activa por defecto.
  // Puede desactivarse temporalmente durante un rollback controlado.
  if (env.TRANSPORTISTAS_ATOMICOS !== 'false') {
    const atomicRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/liquidar_transportista`, {
      method: 'POST',
      headers: svcHeaders,
      body: JSON.stringify({
        p_transportista_id: transportistaId,
        p_cuenta_id: cuenta.cuentaId,
        p_monto: montoNum,
        p_referencia: referencia || null,
        p_nota: nota || null,
        p_creado_por: operador.id,
        p_idempotency_key: idempotencyKey,
        p_despacho_ids: idsValidos && idsValidos.length ? idsValidos : null,
      }),
    })
    if (!atomicRes.ok) {
      const err = await atomicRes.text()
      return jsonError(`Error al registrar el pago: ${err}`, atomicRes.status >= 400 && atomicRes.status < 500 ? atomicRes.status : 500, request)
    }
    const raw = await atomicRes.json()
    const result = Array.isArray(raw) ? raw[0] : raw
    if (!result?.pago_id) return jsonError('La liquidación no devolvió un pago válido', 500, request)
    registrarAuditoria(env, svcHeaders, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'TRANSPORTISTA', accion: 'PAGAR_TRANSPORTISTA',
      entidadTipo: 'transportista', entidadId: transportistaId,
      meta: result, ip,
    }).catch(() => {})
    return json({ ok: true, ...result }, 200, request)
  }

  // Rollback controlado: TRANSPORTISTAS_ATOMICOS=false mantiene el flujo legado
  // únicamente durante una emergencia y debe retirarse después de aplicar la migración 221.

  const transpRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/transportistas?${cuenta.filter}&id=eq.${transportistaId}&select=es_local,activo,tipo_relacion&limit=1`,
    { headers: svcHeaders }
  )
  if (!transpRes.ok) return jsonError('Error al verificar transportista', 500, request)
  const [transp] = await transpRes.json()
  if (!transp) return jsonError('Transportista no encontrado', 404, request)
  if (!transp.es_local) return jsonError('Solo se puede liquidar a transportistas locales', 400, request)
  if (!transp.activo) return jsonError('El transportista está inactivo', 400, request)

  // 1. Traer despachos pendientes del transportista, ordenados FIFO.
  let idsFilter
  if (Array.isArray(despachoIds) && despachoIds.length > 0) {
    const ids = despachoIds.filter(isValidUuid)
    if (ids.length === 0) return jsonError('despachoIds inválidos', 400, request)
    idsFilter = `${cuenta.filter}&id=in.(${ids.join(',')})&transportista_id=eq.${transportistaId}`
  } else {
    idsFilter = `${cuenta.filter}&transportista_id=eq.${transportistaId}`
  }
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/notas_despacho?${idsFilter}` +
    `&flete_pagado=eq.false&flete_comisionable=eq.true&estado=neq.anulada` +
    `&order=creado_en.asc` +
    `&select=id,flete_neto_transportista_usd`,
    { headers: svcHeaders }
  )
  if (!r.ok) return jsonError('Error al leer despachos', 500, request)
  const despachosAfectar = await r.json()

  // 2. Asignar monto FIFO: solo marcar despachos cuyo neto cabe en el saldo restante.
  //    Guard crítico: si el neto supera lo restante, NO marcar (evita despachos "pagados a medias").
  let restante = montoNum
  const marcados = []
  for (const d of despachosAfectar) {
    if (restante <= 0.0001) break
    const neto = Number(d.flete_neto_transportista_usd || 0)
    if (neto <= 0) continue
    if (neto > restante + 0.0001) break  // S1-T1: despacho no cabe — detener FIFO aquí
    marcados.push(d.id)
    restante -= neto
  }
  if (marcados.length === 0) {
    return jsonError('El transportista no tiene despachos pendientes por liquidar', 400, request)
  }
  const montoAplicado = Math.max(0, montoNum - restante)
  // El excedente (si monto > saldo) se registra en pagos_transportistas como "abono a cuenta"
  // análogo al flujo de cxc/abono (no se descarta).

  // 3. Marcar despachos como pagados. Service_role bypassa el trigger de defensa en profundidad.
  const markRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/notas_despacho?${cuenta.filter}&id=in.(${marcados.join(',')})`,
    {
      method: 'PATCH', headers: svcHeaders,
      body: JSON.stringify({ flete_pagado: true }),
    }
  )
  if (!markRes.ok) {
    const err = await markRes.text()
    return jsonError(`Error al marcar despachos como pagados: ${err}`, 500, request)
  }

  // 3b. Registrar en tabla join qué despachos se marcaron en este pago (S2-T6).
  //     Permite revertir el pago de forma precisa sin afectar otros pagos.
  const joinRows = marcados.map(did => {
    const d = despachosAfectar.find(x => x.id === did)
    return {
      pago_id: null, // se actualizará después de insertar el pago
      despacho_id: did,
      neto_usd: Number(d?.flete_neto_transportista_usd || 0),
      cuenta_id: cuenta.cuentaId,
    }
  })

  // 4. Insertar en pagos_transportistas (append-only).
  const notaFinal = nota
    ? nota
    : `Liquidación FIFO de ${marcados.length} despacho(s). Excedente: ${(restante > 0 ? restante : 0).toFixed(2)}`
  const pagRes = await fetch(`${env.SUPABASE_URL}/rest/v1/pagos_transportistas`, {
    method: 'POST',
    headers: { ...svcHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      transportista_id: transportistaId,
      monto_usd: montoNum,
      referencia: referencia || null,
      nota: notaFinal,
      cuenta_id: cuenta.cuentaId,
      creado_por: operador.id,
      idempotency_key: idempotencyKey,
    }),
  })
  if (!pagRes.ok) {
    const err = await pagRes.text()
    return jsonError(`Error al registrar el pago: ${err}`, 500, request)
  }
  const [pago] = await pagRes.json()

  // 4b. Insertar vínculos pago-despacho en tabla join (S2-T6)
  if (marcados.length > 0 && pago?.id) {
    joinRows.forEach(r => r.pago_id = pago.id)
    const joinRes = await fetch(`${env.SUPABASE_URL}/rest/v1/pagos_transportistas_despachos`, {
      method: 'POST',
      headers: svcHeaders,
      body: JSON.stringify(joinRows),
    })
    if (!joinRes.ok) return jsonError('El pago se registró pero no se pudieron registrar sus despachos vinculados', 500, request)
  }

  // 5. Auditoría (fire-and-forget)
  const svcHeadersAudit = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
  registrarAuditoria(env, svcHeadersAudit, {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    categoria: 'TRANSPORTISTA', accion: 'PAGAR_TRANSPORTISTA',
    entidadTipo: 'transportista', entidadId: transportistaId,
    meta: { monto: montoNum, despachos_marcados: marcados.length, pago_id: pago.id },
    ip,
  }).catch(() => {})

  return json({
    ok: true,
    pago_id: pago.id,
    despachos_marcados: marcados.length,
    monto_aplicado_usd: r4(montoAplicado),
    excedente_usd: r4(restante > 0 ? restante : 0),
  }, 200, request)
}

// ── POST /api/transportistas/revertir-pago ───────────────────────────────────
// Body: { pagoId }
// Revierte un pago: marca pago.revertido=true y resetea flete_pagado en los despachos vinculados.
// Solo admin/desarrollador.
export async function handleRevertirPagoTransportista(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, ip } = v
  const cuenta = requireCuenta(operador, request)
  if (cuenta.error) return cuenta.error
  if (!ROLES_PAGAR.includes(operador.rol)) {
    return jsonError('Solo administración o desarrollador pueden revertir pagos', 403, request)
  }

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { pagoId } = body
  if (!pagoId || !isValidUuid(pagoId)) return jsonError('pagoId inválido', 400, request)

  if (env.TRANSPORTISTAS_ATOMICOS !== 'false') {
    const atomicRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/revertir_pago_transportista`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        p_pago_id: pagoId,
        p_cuenta_id: cuenta.cuentaId,
        p_revertido_por: operador.id,
        p_revertido_por_nombre: operador.nombre,
      }),
    })
    if (!atomicRes.ok) {
      const err = await atomicRes.text()
      return jsonError(`Error al revertir el pago: ${err}`, atomicRes.status >= 400 && atomicRes.status < 500 ? atomicRes.status : 500, request)
    }
    const raw = await atomicRes.json()
    const result = Array.isArray(raw) ? raw[0] : raw
    registrarAuditoria(env, {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    }, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'TRANSPORTISTA', accion: 'REVERTIR_PAGO_TRANSPORTISTA',
      entidadTipo: 'pago_transportista', entidadId: pagoId, meta: result, ip,
    }).catch(() => {})
    return json({ ok: true, ...result }, 200, request)
  }

  // Rollback controlado: la reversa legada solo queda disponible con la bandera explícita.

  const svcHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  }

  // 1. Verificar que el pago existe, pertenece al tenant y no está ya revertido
  const pagoRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pagos_transportistas?${cuenta.filter}&id=eq.${pagoId}&select=id,transportista_id,monto_usd,revertido,cuenta_id&limit=1`,
    { headers: svcHeaders }
  )
  const [pago] = await pagoRes.json()
  if (!pago) return jsonError('Pago no encontrado', 404, request)
  if (pago.cuenta_id !== cuenta.cuentaId) {
    return jsonError('Acceso denegado: el pago pertenece a otra cuenta', 403, request)
  }
  if (pago.revertido) return jsonError('Este pago ya fue revertido', 400, request)

  // 2. Obtener los despachos vinculados a este pago (vía join table)
  const joinRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pagos_transportistas_despachos?${cuenta.filter}&pago_id=eq.${pagoId}&select=despacho_id`,
    { headers: svcHeaders }
  )
  const joinRows = joinRes.ok ? await joinRes.json() : []
  const despachoIds = joinRows.map(r => r.despacho_id).filter(Boolean)

  // Incluso el fallback legado debe respetar la misma frontera financiera:
  // solo se pueden revertir vínculos de comisiones externas válidas.
  if (despachoIds.length > 0) {
    const linkedRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/notas_despacho?${cuenta.filter}&id=in.(${despachoIds.join(',')})` +
      `&transportista_id=eq.${pago.transportista_id}&select=id,flete_comisionable,flete_neto_transportista_usd`,
      { headers: svcHeaders }
    )
    if (!linkedRes.ok) return jsonError('Error al verificar despachos del pago', 500, request)
    const linked = await linkedRes.json()
    if (linked.length !== despachoIds.length || linked.some(d => d.flete_comisionable !== true || Number(d.flete_neto_transportista_usd || 0) <= 0)) {
      return jsonError('El pago contiene un despacho que no corresponde a una comisión fuera de Carabobo', 400, request)
    }
  }

  // 3. Resetear flete_pagado en los despachos vinculados
  if (despachoIds.length > 0) {
    const resetRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/notas_despacho?${cuenta.filter}&id=in.(${despachoIds.join(',')})`,
      {
        method: 'PATCH',
        headers: svcHeaders,
        body: JSON.stringify({ flete_pagado: false }),
      }
    )
    if (!resetRes.ok) {
      const err = await resetRes.text()
      return jsonError(`Error al resetear despachos: ${err}`, 500, request)
    }
  }

  // 4. Marcar el pago como revertido
  const updatePagoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/pagos_transportistas?${cuenta.filter}&id=eq.${pagoId}`, {
    method: 'PATCH',
    headers: svcHeaders,
    body: JSON.stringify({
      revertido: true,
      revertido_en: new Date().toISOString(),
      revertido_por: operador.id,
      revertido_por_nombre: operador.nombre,
    }),
  })
  if (!updatePagoRes.ok) return jsonError('Error al marcar el pago como revertido', 500, request)

  // 5. Auditoría
  registrarAuditoria(env, svcHeaders, {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    categoria: 'TRANSPORTISTA',
    accion: 'REVERTIR_PAGO_TRANSPORTISTA',
    entidadTipo: 'pago_transportista',
    entidadId: pagoId,
    meta: { transportista_id: pago.transportista_id, monto: pago.monto_usd, despachos_reseteados: despachoIds.length },
    ip,
  }).catch(() => {})

  return json({ ok: true, despachos_reseteados: despachoIds.length }, 200, request)
}
