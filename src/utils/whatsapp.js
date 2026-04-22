// src/utils/whatsapp.js
// Utilidades para compartir cotizaciones por WhatsApp
// Móvil: Web Share API (comparte PDF como archivo)
// Escritorio: descarga PDF + abre wa.me con mensaje prellenado

/**
 * Formatea un número de teléfono para wa.me
 * Quita espacios, guiones y paréntesis. Asume Venezuela (+58)
 * Acepta: 412-1234567, 04121234567, +584121234567, 584121234567
 */
export function formatearTelefono(telefono) {
  if (!telefono) return ''
  let num = telefono.replace(/[\s\-\(\)\.]/g, '')
  // Si empieza con +, quitar el +
  if (num.startsWith('+')) num = num.slice(1)
  // Si empieza con 0, quitar el 0
  if (num.startsWith('0')) num = num.slice(1)
  // Si ya tiene 58 al inicio y es largo, dejarlo
  if (num.startsWith('58') && num.length >= 12) return num
  // Agregar código de país 58
  if (!num.startsWith('58')) num = '58' + num
  return num
}

/**
 * Genera el mensaje para WhatsApp
 */
export function generarMensaje({ nombreNegocio, nombreCliente, numDisplay, totalUsd, validaHasta, nombreVendedor, items = [] }) {
  const total = `$${Number(totalUsd || 0).toFixed(2)}`
  const empresa = nombreNegocio || 'Construacero Carabobo'
  const saludo = nombreCliente ? `Estimado/a *${nombreCliente}*,` : 'Estimado/a cliente,'

  const vencim = validaHasta
    ? `Valida hasta: *${new Date(validaHasta + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' })}*`
    : ''

  const firma = nombreVendedor
    ? `Atentamente,\n*${nombreVendedor}*\n_${empresa}_`
    : `Atentamente,\n_${empresa}_`

  const intro = nombreVendedor
    ? `Le saluda *${nombreVendedor}* de *${empresa}*. Le enviamos la cotizacion *${numDisplay}*:`
    : `Le enviamos la cotizacion *${numDisplay}* de *${empresa}*:`

  // Líneas de productos (máx 15 para no saturar el mensaje)
  const lineasProductos = items.slice(0, 15).map(it => {
    const cant = Number(it.cantidad || 1)
    const precio = Number(it.precio_unit_usd || it.precioUnitUsd || 0)
    const desc = Number(it.descuento_pct || it.descuentoPct || 0)
    const subtotal = cant * precio * (1 - desc / 100)
    const descStr = desc > 0 ? ` (-${desc}%)` : ''
    return `- ${it.nombre_snap || it.nombreSnap} x${cant}${descStr} -- *$${subtotal.toFixed(2)}*`
  })

  const hayMas = items.length > 15
    ? `_...y ${items.length - 15} producto(s) mas (ver PDF adjunto)_`
    : ''

  return [
    saludo,
    '',
    intro,
    '',
    '*Productos:*',
    ...lineasProductos,
    hayMas || null,
    '',
    `*Total: ${total}*`,
    vencim ? vencim : null,
    '',
    'Adjunto encontrara el documento PDF para su revision.',
    '',
    'Quedamos a su disposicion para cualquier consulta.',
    '',
    firma,
  ].filter(l => l !== null && l !== undefined).join('\n')
}

/**
 * Detecta si estamos en un dispositivo móvil/táctil
 */
function esMobil() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 0 && window.innerWidth < 768)
}

/**
 * Comparte una cotización por WhatsApp
 * Estrategia en 2 pasos para móvil:
 *   1. Web Share API para enviar el PDF como archivo adjunto
 *   2. Luego abre wa.me con el mensaje prellenado al número del cliente
 * En escritorio: descarga PDF + abre wa.me
 */
export async function compartirPorWhatsApp({ pdfBlob, pdfFilename, telefono, mensaje }) {
  const telFormateado = formatearTelefono(telefono)

  // ── MÓVIL: compartir PDF vía Web Share API ──
  if (esMobil() && pdfBlob && navigator.canShare) {
    try {
      const file = new File([pdfBlob], pdfFilename, { type: 'application/pdf' })

      // Intentar compartir archivo + texto juntos (funciona en iOS y algunos Android)
      const shareDataFull = { files: [file], text: mensaje }
      if (navigator.canShare(shareDataFull)) {
        await navigator.share(shareDataFull)
        return { method: 'share_api' }
      }

      // Fallback: compartir solo el archivo (Android a veces rechaza files+text)
      const shareDataFile = { files: [file] }
      if (navigator.canShare(shareDataFile)) {
        await navigator.share(shareDataFile)
        // Después de compartir el archivo, abrir wa.me con el mensaje
        setTimeout(() => {
          const waUrl = telFormateado
            ? `https://wa.me/${telFormateado}?text=${encodeURIComponent(mensaje)}`
            : `https://wa.me/?text=${encodeURIComponent(mensaje)}`
          window.open(waUrl, '_blank', 'noopener')
        }, 800)
        return { method: 'share_api_then_wa' }
      }
    } catch (err) {
      if (err.name === 'AbortError') return { method: 'cancelled' }
      // Si falla, continuar con el método wa.me
    }
  }

  // ── ESCRITORIO / FALLBACK: descargar PDF + abrir wa.me ──
  if (pdfBlob) {
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = pdfFilename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Dar tiempo para que inicie la descarga antes de revocar
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Abrir WhatsApp con el teléfono del cliente
  // Pequeño delay para que el usuario vea la descarga primero
  await new Promise(r => setTimeout(r, 500))
  const waUrl = telFormateado
    ? `https://wa.me/${telFormateado}?text=${encodeURIComponent(mensaje)}`
    : `https://wa.me/?text=${encodeURIComponent(mensaje)}`

  window.open(waUrl, '_blank', 'noopener')
  return { method: 'wa_link' }
}
