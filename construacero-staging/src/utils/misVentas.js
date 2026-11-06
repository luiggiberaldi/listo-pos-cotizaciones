// src/utils/misVentas.js
// Reporte "Mis ventas": arma el detalle de lo que vendió UN vendedor en un rango de fechas
// (despachos con sus artículos, cliente y montos) y los resúmenes por artículo y por cliente.
// Lo usan el servidor (api/handlers/misVentas.js) y el PDF; no consulta la base de datos.

export const ROLES_MIS_VENTAS = ['vendedor', 'vendedor_sin_comision', 'supervisor']
export const MAX_DIAS_MIS_VENTAS = 366

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

export function sumarDiasFecha(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// Valida desde/hasta (YYYY-MM-DD, días de Venezuela). Devuelve { error } o el rango para consultar.
export function validarRangoMisVentas(desde, hasta) {
  if (!FECHA_RE.test(desde || '') || !FECHA_RE.test(hasta || '')) return { error: 'Rango de fechas inválido' }
  if (Number.isNaN(Date.parse(`${desde}T12:00:00Z`)) || Number.isNaN(Date.parse(`${hasta}T12:00:00Z`))) return { error: 'Rango de fechas inválido' }
  if (desde > hasta) return { error: 'La fecha inicial es posterior a la final' }
  const dias = Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000) + 1
  if (dias > MAX_DIAS_MIS_VENTAS) return { error: `El rango no puede pasar de ${MAX_DIAS_MIS_VENTAS} días` }
  return {
    desde, hasta, dias,
    desdeTs: `${desde}T00:00:00-04:00`,
    hastaTs: `${sumarDiasFecha(hasta, 1)}T00:00:00-04:00`,
  }
}

const n = v => Number(v) || 0
const r2 = v => Math.round(v * 100) / 100

// Formas de pago: el despacho guarda un JSON (texto o arreglo) con { metodo, monto }.
export function metodosDePago(formaPago) {
  let fps = formaPago
  if (typeof fps === 'string') {
    try { fps = JSON.parse(fps) } catch { return fps.trim() ? [fps.trim()] : [] }
  }
  if (!Array.isArray(fps)) return []
  return [...new Set(fps.map(f => f?.metodo).filter(Boolean))]
}

export function construirReporteMisVentas({ despachos = [], items = [], clientes = [], cotizaciones = [], comisiones = [], conComision = true }) {
  const clientePorId = new Map(clientes.map(c => [c.id, c]))
  const cotPorId = new Map(cotizaciones.map(c => [c.id, c]))
  const itemsPorDespacho = new Map()
  for (const it of items) {
    if (!itemsPorDespacho.has(it.despacho_id)) itemsPorDespacho.set(it.despacho_id, [])
    itemsPorDespacho.get(it.despacho_id).push(it)
  }
  const comisionPorDespacho = new Map()
  for (const c of comisiones) comisionPorDespacho.set(c.despachoid, n(comisionPorDespacho.get(c.despachoid)) + n(c.totalcomision))

  const ordenados = [...despachos].sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)) || n(a.numero) - n(b.numero))
  const porArticulo = new Map()
  const porCliente = new Map()
  let totalUsd = 0, unidades = 0, comisionUsd = 0

  const detalle = ordenados.map(d => {
    const cliente = clientePorId.get(d.cliente_id)
    const lineas = (itemsPorDespacho.get(d.id) || [])
      .filter(it => n(it.cantidad) > 0)
      .sort((a, b) => n(a.orden) - n(b.orden))
      .map(it => ({
        codigo: it.codigo_snap || '',
        nombre: it.nombre_snap,
        unidad: it.unidad_snap || 'und',
        cantidad: n(it.cantidad),
        precioUnitUsd: n(it.precio_unit_usd),
        descuentoPct: n(it.descuento_pct),
        totalUsd: r2(n(it.total_linea_usd)),
      }))
    const subtotalArticulos = r2(lineas.reduce((s, l) => s + l.totalUsd, 0))
    const comision = comisionPorDespacho.get(d.id) ?? 0

    totalUsd += n(d.total_usd)
    comisionUsd += comision
    for (const l of lineas) {
      unidades += l.cantidad
      const clave = `${l.codigo}|${l.nombre}|${l.unidad}`
      const a = porArticulo.get(clave) || { codigo: l.codigo, nombre: l.nombre, unidad: l.unidad, cantidad: 0, totalUsd: 0, despachos: new Set() }
      a.cantidad += l.cantidad
      a.totalUsd += l.totalUsd
      a.despachos.add(d.id)
      porArticulo.set(clave, a)
    }
    const claveCliente = cliente?.id || d.cliente_id || 'sin-cliente'
    const c = porCliente.get(claveCliente) || { nombre: cliente?.nombre || 'Cliente no disponible', rif: cliente?.rif_cedula || '', despachos: 0, totalUsd: 0 }
    c.despachos++
    c.totalUsd += n(d.total_usd)
    porCliente.set(claveCliente, c)

    const cot = cotPorId.get(d.cotizacion_id)
    return {
      id: d.id,
      numero: d.numero,
      cotizacion: cot?.numero ?? null,
      fecha: d.creado_en,
      estado: d.estado,
      cliente: cliente?.nombre || 'Cliente no disponible',
      clienteRif: cliente?.rif_cedula || '',
      formasPago: metodosDePago(d.forma_pago),
      subtotalArticulosUsd: subtotalArticulos,
      descuentoUsd: r2(n(d.descuento_total_usd)),
      fleteUsd: r2(n(d.flete_usd)),
      totalUsd: r2(n(d.total_usd)),
      comisionUsd: conComision ? r2(comision) : null,
      tieneDevoluciones: Boolean(d.tiene_devoluciones),
      articulos: lineas,
    }
  })

  return {
    resumen: {
      totalUsd: r2(totalUsd),
      despachos: detalle.length,
      clientes: porCliente.size,
      unidades: r2(unidades),
      comisionUsd: conComision ? r2(comisionUsd) : null,
    },
    despachos: detalle,
    porArticulo: [...porArticulo.values()]
      .map(a => ({ codigo: a.codigo, nombre: a.nombre, unidad: a.unidad, cantidad: r2(a.cantidad), totalUsd: r2(a.totalUsd), despachos: a.despachos.size }))
      .sort((a, b) => b.totalUsd - a.totalUsd || a.nombre.localeCompare(b.nombre, 'es')),
    porCliente: [...porCliente.values()]
      .map(c => ({ ...c, totalUsd: r2(c.totalUsd) }))
      .sort((a, b) => b.totalUsd - a.totalUsd || a.nombre.localeCompare(b.nombre, 'es')),
  }
}
