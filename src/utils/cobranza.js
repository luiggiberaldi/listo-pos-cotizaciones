// src/utils/cobranza.js
// Resumen de cobranza: cuentas por cobrar vencidas y por vencer.
// Lo usan el aviso diario del servidor y la campanita, con el mismo cálculo que el reporte de Crédito:
// el saldo_usd de cada fila es el saldo del CLIENTE en ese momento, no lo que falta de ese cargo,
// así que lo pendiente de cada cargo se reconstruye aplicando los abonos (primero al despacho, luego FIFO).

export const DIAS_AVISO_COBRANZA = 3
export const ROLES_AVISO_COBRANZA = ['jefe', 'administracion']

// Fecha de hoy en Venezuela (YYYY-MM-DD)
export function fechaCaracas(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const redondear4 = n => Math.round(n * 10000) / 10000

// Recibe cargos y abonos de UN cliente; devuelve los cargos con lo que les falta por cobrar.
export function cargosPendientes(transacciones) {
  const ordenadas = [...transacciones].sort((a, b) =>
    String(a.creado_en || '').localeCompare(String(b.creado_en || '')) || String(a.id || '').localeCompare(String(b.id || '')))
  const cargos = []
  const abonos = []
  for (const t of ordenadas) {
    if (t.tipo === 'cargo') cargos.push({ ...t, pendiente: Number(t.monto_usd || 0) })
    else if (t.tipo === 'abono') abonos.push({ restante: Number(t.monto_usd || 0), despacho_id: t.despacho_id })
  }
  const aplicar = (cargo, abono) => {
    const monto = Math.min(cargo.pendiente, abono.restante)
    cargo.pendiente = redondear4(cargo.pendiente - monto)
    abono.restante = redondear4(abono.restante - monto)
  }
  // Fase 1: abonos vinculados a un despacho
  for (const abono of abonos) {
    if (!abono.despacho_id) continue
    const cargo = cargos.find(c => c.despacho_id === abono.despacho_id)
    if (cargo && cargo.pendiente > 0) aplicar(cargo, abono)
  }
  // Fase 2: lo que sobra, en orden cronológico
  for (const abono of abonos) {
    for (const cargo of cargos) {
      if (abono.restante <= 0) break
      if (cargo.pendiente > 0) aplicar(cargo, abono)
    }
  }
  return cargos.filter(c => c.pendiente > 0.005)
}

// Cargos pendientes de varios clientes a la vez (agrupa por cliente y aplica cargosPendientes).
export function cargosPendientesDeTodos(transacciones) {
  const porCliente = new Map()
  for (const t of transacciones) {
    if (!porCliente.has(t.cliente_id)) porCliente.set(t.cliente_id, [])
    porCliente.get(t.cliente_id).push(t)
  }
  return [...porCliente.values()].flatMap(cargosPendientes)
}

// Agrupa cargos YA pendientes en vencidos (antes de hoy) y por vencer (de hoy a hoy + dias).
export function resumirCargos(cargos, hoy, dias = DIAS_AVISO_COBRANZA) {
  const limite = sumarDias(hoy, dias)
  const resumen = { hoy, dias, vencidas: { cantidad: 0, totalUsd: 0 }, porVencer: { cantidad: 0, totalUsd: 0 } }
  for (const cargo of cargos) {
    const vence = typeof cargo.fecha_vencimiento === 'string' ? cargo.fecha_vencimiento.slice(0, 10) : null
    if (!vence) continue
    const grupo = vence < hoy ? resumen.vencidas : vence <= limite ? resumen.porVencer : null
    if (!grupo) continue
    grupo.cantidad++
    grupo.totalUsd += cargo.pendiente
  }
  resumen.vencidas.totalUsd = Math.round(resumen.vencidas.totalUsd * 100) / 100
  resumen.porVencer.totalUsd = Math.round(resumen.porVencer.totalUsd * 100) / 100
  return resumen
}

// Igual que resumirCargos, partiendo de los cargos y abonos crudos.
export function resumirCobranza(transacciones, hoy, dias = DIAS_AVISO_COBRANZA) {
  return resumirCargos(cargosPendientesDeTodos(transacciones), hoy, dias)
}

const usd = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

// Textos del aviso. Devuelve null si no hay nada que avisar.
export function textoCobranza(resumen) {
  const { vencidas, porVencer, dias } = resumen
  if (!vencidas.cantidad && !porVencer.cantidad) return null
  const partes = []
  if (vencidas.cantidad) partes.push(`${plural(vencidas.cantidad, 'vencida', 'vencidas')} (${usd(vencidas.totalUsd)})`)
  if (porVencer.cantidad) partes.push(`${plural(porVencer.cantidad, 'vence', 'vencen')} en los próximos ${dias} días (${usd(porVencer.totalUsd)})`)
  const title = vencidas.cantidad
    ? `💰 Cobranza: ${plural(vencidas.cantidad, 'cuenta vencida', 'cuentas vencidas')}`
    : `💰 Cobranza: ${plural(porVencer.cantidad, 'cuenta por vencer', 'cuentas por vencer')}`
  return { title, body: partes.join(' · '), urgente: vencidas.cantidad > 0 }
}
