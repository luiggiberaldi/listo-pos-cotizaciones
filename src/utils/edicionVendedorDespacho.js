// OP-2026-070 — El vendedor edita productos y cantidades de SUS despachos que esperan aprobación.
//
// Decisión del dueño (2026-11-24): el vendedor puede agregar, quitar y cambiar cantidades,
// solo con los precios de lista que ya puede usar al cotizar (P1/P2/P3, con su recargo si es
// externo y el descuento de cliente personal). No toca formas de pago ni dinero. El supervisor
// sigue aprobando después. Si el despacho tiene un solo método de pago, su monto sigue al nuevo
// total (mismo método); con pagos combinados, adelantos o saldo a favor, el vendedor no puede editar.
//
// Estas reglas se aplican en el servidor (aquí) y, además, la base de datos exige en
// `editar_despacho_profundidad` que el despacho sea suyo, esté pendiente y sin cambio de pagos.

export const ROLES_VENDEDOR = ['vendedor', 'vendedor_sin_comision']
const TOLERANCIA = 0.011

export function esRolVendedor(rol) {
  return ROLES_VENDEDOR.includes(rol)
}

const r4 = (n) => Math.round(Number(n) * 10000) / 10000
const esPrestamo = (it) => !!(it?.es_prestamo || it?.esPrestamo)

/** Precios de lista que el vendedor puede usar para un producto (mismo criterio que la cotización). */
export function preciosPermitidos(producto, { factorMarkup = 1, descPersonalPct = 0, esPersonal = false } = {}) {
  if (!producto) return []
  const bases = [Number(producto.precio_usd)]
  if (producto.precio2_habilitado !== false && producto.precio_2 != null) bases.push(Number(producto.precio_2))
  if (producto.precio3_habilitado !== false && producto.precio_3 != null) bases.push(Number(producto.precio_3))
  const out = new Set()
  for (const b of bases.filter(Number.isFinite)) {
    for (const conMarkup of [b, b * factorMarkup]) {
      out.add(r4(conMarkup))
      if (esPersonal) out.add(r4(conMarkup * (1 - descPersonalPct / 100)))
    }
  }
  return [...out]
}

/**
 * Revisa los renglones que manda el vendedor. Devuelve un mensaje de error o null.
 * - Productos de inventario: precio de lista permitido, o el mismo precio que ese producto ya tenía.
 * - Artículos externos (sin producto): solo los que ya estaban, con el mismo precio.
 * - Préstamos: solo si ese producto ya estaba como préstamo.
 * - Sin descuentos nuevos por renglón.
 */
export function revisarItemsVendedor({ items, productosPorId, itemsActuales, opcionesPrecio }) {
  const actuales = Array.isArray(itemsActuales) ? itemsActuales : []
  for (const [i, it] of items.entries()) {
    const n = i + 1
    const precio = Number(it?.precio_unit_usd ?? it?.precioUnitUsd)
    const desc = Number(it?.descuento_pct || 0)
    const mismoProducto = actuales.filter(a => (a.producto_id || null) === (it.producto_id || null))

    if (desc !== 0 && !mismoProducto.some(a => Math.abs(Number(a.descuento_pct || 0) - desc) < 1e-6)) {
      return `Renglón ${n}: el vendedor no puede poner descuentos por renglón.`
    }
    if (esPrestamo(it) && !mismoProducto.some(esPrestamo)) {
      return `Renglón ${n}: el vendedor no puede agregar préstamos; pide a administración.`
    }

    if (!it.producto_id) {
      const existia = actuales.some(a => !a.producto_id
        && String(a.nombre_snap || '').trim() === String(it.nombre_snap || '').trim()
        && Math.abs(Number(a.precio_unit_usd) - precio) < TOLERANCIA)
      if (!existia) return `Renglón ${n}: el vendedor no puede agregar artículos externos ni cambiar su precio.`
      continue
    }

    const yaTenia = mismoProducto.some(a => Math.abs(Number(a.precio_unit_usd) - precio) < TOLERANCIA)
    if (yaTenia) continue
    const permitidos = preciosPermitidos(productosPorId[it.producto_id], opcionesPrecio)
    if (!permitidos.some(p => Math.abs(p - precio) < TOLERANCIA)) {
      return `Renglón ${n} (${it.nombre_snap || 'producto'}): el precio debe ser uno de los precios de lista.`
    }
  }
  return null
}

const METODOS_NO_EDITABLES = ['Saldo a Favor', 'Cruce']
const normalizarMetodo = (m) => (m === 'Efectivo' ? 'Efectivo $' : String(m || ''))

function leerPagos(texto) {
  if (texto == null || texto === '') return []
  if (Array.isArray(texto)) return texto
  try {
    const v = JSON.parse(texto)
    return Array.isArray(v) ? v : []
  } catch {
    return [{ metodo: String(texto), monto: null }]
  }
}

/** ¿El despacho tiene un plan de pago "simple" (un solo método) que puede seguir al total? */
export function planDePagoSimple(formaPagoActual) {
  const pagos = leerPagos(formaPagoActual)
  if (pagos.length === 0) return true
  if (pagos.length !== 1) return false
  const p = pagos[0]
  if (METODOS_NO_EDITABLES.includes(p.metodo) || p.vuelto_a_favor) return false
  if (p.metodo === 'Cobro a destino') {
    const prop = Array.isArray(p.metodo_propuesto) ? p.metodo_propuesto : []
    return prop.length <= 1 && !prop.some(x => METODOS_NO_EDITABLES.includes(x?.metodo))
  }
  return true
}

/**
 * El vendedor no elige pagos: solo puede mandar el MISMO método con el monto del nuevo total.
 * Devuelve un mensaje de error o null.
 */
export function revisarPagosVendedor({ pagosNuevos, formaPagoActual, totalNuevo }) {
  if (pagosNuevos === undefined || pagosNuevos === null) return null
  if (!planDePagoSimple(formaPagoActual)) {
    return 'Este despacho tiene pagos combinados, adelantos o saldo a favor. Pide a administración que lo edite.'
  }
  const antes = leerPagos(formaPagoActual)
  const nuevos = leerPagos(pagosNuevos)
  if (antes.length === 0) {
    return nuevos.length === 0 ? null : 'El vendedor no puede agregar pagos. Pide a administración.'
  }
  if (nuevos.length !== 1 || normalizarMetodo(nuevos[0].metodo) !== normalizarMetodo(antes[0].metodo)) {
    return 'El vendedor no puede cambiar el método de pago. Pide a administración.'
  }
  const n = nuevos[0]
  if (Math.abs(Number(n.monto) - Number(totalNuevo)) > 0.02) {
    return 'El monto del pago debe ser igual al nuevo total del despacho.'
  }
  if (antes[0].metodo === 'Cobro a destino') {
    const pa = Array.isArray(antes[0].metodo_propuesto) ? antes[0].metodo_propuesto : []
    const pn = Array.isArray(n.metodo_propuesto) ? n.metodo_propuesto : []
    if (pa.length !== pn.length || (pa[0] && normalizarMetodo(pa[0].metodo) !== normalizarMetodo(pn[0]?.metodo))) {
      return 'El vendedor no puede cambiar cómo se cobrará en destino. Pide a administración.'
    }
    if (pn[0] && Math.abs(Number(pn[0].monto) - Number(totalNuevo)) > 0.02) {
      return 'El monto a cobrar en destino debe ser igual al nuevo total del despacho.'
    }
  }
  if (antes[0].diasVencimiento !== undefined && Number(n.diasVencimiento) !== Number(antes[0].diasVencimiento)) {
    return 'El vendedor no puede cambiar los días de crédito. Pide a administración.'
  }
  return null
}

/** Total del despacho con los renglones nuevos (mismo cálculo que el servidor de edición profunda). */
export function totalConItems(items, despacho) {
  const totalItems = items.reduce((sum, it) => {
    if (esPrestamo(it)) return sum
    const cantidad = Number(it?.cantidad || 0)
    const precio = Number(it?.precio_unit_usd ?? it?.precioUnitUsd ?? 0)
    const descuento = Number(it?.descuento_pct || 0)
    return sum + Math.max(0, cantidad * precio * (1 - descuento / 100))
  }, 0)
  return totalItems + Number(despacho?.flete_usd || 0) + Number(despacho?.corte_usd || 0) - Number(despacho?.descuento_total_usd || 0)
}

/**
 * Validación completa para un vendedor. Devuelve { error, status } o null si puede seguir.
 * `headers` debe poder leer las tablas de la cuenta (las del servidor).
 */
export async function validarEdicionVendedor({ env, headers, operador, despachoId, items, pagos, destinoPagos }) {
  if (!esRolVendedor(operador?.rol)) return null
  if (destinoPagos) {
    return { error: 'El vendedor no puede decidir sobre pagos ya hechos. Pide a administración.', status: 403 }
  }
  const base = env.SUPABASE_URL + '/rest/v1/'
  const leer = async (ruta) => {
    const r = await fetch(base + ruta, { headers })
    if (!r.ok) throw new Error(`No se pudo leer ${ruta.split('?')[0]}`)
    return r.json()
  }
  const [despacho] = await leer(`notas_despacho?id=eq.${despachoId}&cuenta_id=eq.${operador.cuenta_id}&select=id,estado,vendedor_id,cliente_id,forma_pago,forma_pago_cliente,flete_usd,corte_usd,descuento_total_usd`)
  if (!despacho) return { error: 'Despacho no encontrado', status: 404 }
  if (despacho.vendedor_id !== operador.id) return { error: 'Solo puedes editar tus propios despachos.', status: 403 }
  if (despacho.estado !== 'pendiente') {
    return { error: 'Solo puedes editar despachos que esperan aprobación. Si ya fue aprobado, pide a administración.', status: 400 }
  }

  const idsProducto = [...new Set(items.map(it => it.producto_id).filter(Boolean))]
  const [itemsActuales, productos, configRows, clienteRows, perfilRows] = await Promise.all([
    leer(`notas_despacho_items?despacho_id=eq.${despachoId}&select=producto_id,nombre_snap,precio_unit_usd,descuento_pct,es_prestamo`),
    idsProducto.length ? leer(`productos?id=in.(${idsProducto.join(',')})&select=*`) : Promise.resolve([]),
    leer(`configuracion_negocio?cuenta_id=eq.${operador.cuenta_id}&select=markup_pct_externo,descuento_personal_pct&limit=1`),
    despacho.cliente_id ? leer(`clientes?id=eq.${despacho.cliente_id}&select=tipo_cliente`) : Promise.resolve([]),
    leer(`usuarios?id=eq.${operador.id}&select=es_externo,markup_pct`),
  ])
  const config = configRows[0] || {}
  const perfil = perfilRows[0] || {}
  const pct = perfil.es_externo ? Number(config.markup_pct_externo ?? 5) : Number(perfil.markup_pct || 0)
  const opcionesPrecio = {
    factorMarkup: pct > 0 ? 1 + pct / 100 : 1,
    descPersonalPct: Number(config.descuento_personal_pct ?? 10),
    esPersonal: clienteRows[0]?.tipo_cliente === 'personal',
  }
  const productosPorId = Object.fromEntries(productos.map(p => [p.id, p]))
  const error = revisarItemsVendedor({ items, productosPorId, itemsActuales, opcionesPrecio })
    || revisarPagosVendedor({
      pagosNuevos: pagos,
      formaPagoActual: despacho.forma_pago_cliente || despacho.forma_pago,
      totalNuevo: totalConItems(items, despacho),
    })
  return error ? { error, status: 400 } : null
}
