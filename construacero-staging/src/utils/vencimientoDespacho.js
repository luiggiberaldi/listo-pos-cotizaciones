// src/utils/vencimientoDespacho.js
// Fecha de vencimiento de un despacho a crédito. UNA sola cuenta para la ficha, el detalle y el PDF.
// Fecha de vencimiento = día de creación (hora de Venezuela) + días de crédito. Los días restantes
// se cuentan en días calendario de Venezuela, así una venta de la noche no se corre un día.

// (copia de los ayudantes de src/utils/cobranza.js, que esta copia de pruebas no tiene)
function fechaCaracas(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export const DIAS_POR_VENCER = 3 // desde aquí la ficha se pone amarilla

function leerFormaPago(forma) {
  if (Array.isArray(forma)) return forma
  if (typeof forma === 'string' && forma.trim().startsWith('[')) {
    try { const v = JSON.parse(forma); return Array.isArray(v) ? v : [] } catch { return [] }
  }
  return []
}

const diasEntre = (desde, hasta) =>
  Math.round((new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)) / 86400000)

const fmtFechaCorta = iso => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
const fmtMonto = n => `$${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * @returns null si el despacho no es a crédito con días de vencimiento; si no:
 * { dias, fechaVencimiento (YYYY-MM-DD), fechaTexto (DD/MM/AAAA), restantes (negativo = vencido),
 *   estado: 'vencido' | 'por_vencer' | 'normal', montoCredito, esMixto,
 *   textoCorto ("15 días · 15d restantes"), textoPdf ("Crédito 15 días · Vence: 21/11/2026"),
 *   textoDetalle ("Vence el 21/11/2026 · quedan 15 días") }
 */
export function vencimientoDespacho(despacho, ahora = new Date()) {
  if (!despacho?.creado_en) return null
  const formas = leerFormaPago(despacho.forma_pago)
  const cta = formas.find(f => f?.metodo === 'Cta por cobrar')
  const dias = Number(cta?.diasVencimiento)
  if (!cta || !Number.isFinite(dias) || dias <= 0) return null

  const fechaCreacion = fechaCaracas(new Date(despacho.creado_en))
  const fechaVencimiento = sumarDias(fechaCreacion, Math.round(dias))
  const restantes = diasEntre(fechaCaracas(ahora), fechaVencimiento)
  const estado = restantes < 0 ? 'vencido' : restantes <= DIAS_POR_VENCER ? 'por_vencer' : 'normal'
  const montoCredito = Number(cta.monto) || 0
  const esMixto = formas.length > 1
  const fechaTexto = fmtFechaCorta(fechaVencimiento)

  const cuanto = restantes < 0
    ? `vencido hace ${Math.abs(restantes)} ${Math.abs(restantes) === 1 ? 'día' : 'días'}`
    : restantes === 0 ? 'vence hoy'
      : `${restantes}d restantes`
  const cuantoLargo = restantes < 0
    ? `vencido hace ${Math.abs(restantes)} ${Math.abs(restantes) === 1 ? 'día' : 'días'}`
    : restantes === 0 ? 'vence hoy'
      : `quedan ${restantes} ${restantes === 1 ? 'día' : 'días'}`

  return {
    dias: Math.round(dias),
    fechaVencimiento,
    fechaTexto,
    restantes,
    estado,
    montoCredito,
    esMixto,
    textoCorto: `${Math.round(dias)} días · ${cuanto}`,
    textoPdf: esMixto && montoCredito > 0
      ? `${fmtMonto(montoCredito)} a crédito · Vence: ${fechaTexto}`
      : `Crédito ${Math.round(dias)} días · Vence: ${fechaTexto}`,
    textoDetalle: `Vence el ${fechaTexto} · ${cuantoLargo}`,
  }
}
