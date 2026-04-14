// src/utils/whatsapp.js
// Utilidades para compartir cotizaciones por WhatsApp
// Móvil: Web Share API (comparte PDF como archivo)
// Escritorio: descarga PDF + abre wa.me con mensaje prellenado

/**
 * Formatea un número de teléfono para wa.me
 * Quita espacios, guiones y paréntesis. Si empieza con 0, asume Colombia (+57)
 */
export function formatearTelefono(telefono) {
  if (!telefono) return ''
  let num = telefono.replace(/[\s\-\(\)\.]/g, '')
  // Si empieza con +, quitar el +
  if (num.startsWith('+')) num = num.slice(1)
  // Si empiega con 0, reemplazar con código de Colombia
  if (num.startsWith('0')) num = '57' + num.slice(1)
  // Si no tiene código de país (menos de 11 dígitos), agregar +57
  if (num.length <= 10) num = '57' + num
  return num
}

/**
 * Genera el mensaje para WhatsApp
 */
export function generarMensaje({ nombreNegocio, nombreCliente, numDisplay, totalUsd, validaHasta }) {
  const total = `$${Number(totalUsd || 0).toFixed(2)}`
  const vencim = validaHasta
    ? `\nVálida hasta: ${new Date(validaHasta + 'T12:00:00').toLocaleDateString('es-VE')}`
    : ''
  return `Hola${nombreCliente ? ` ${nombreCliente}` : ''}, te envío la ${numDisplay} de *${nombreNegocio || 'Cotización'}*.\n\nTotal: *${total}*${vencim}\n\nQuedo a tu disposición para cualquier consulta.`
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
 * @param {object} opts
 * @param {Blob|null} opts.pdfBlob - Blob del PDF (si está disponible)
 * @param {string} opts.pdfFilename - Nombre del archivo PDF
 * @param {string} opts.telefono - Teléfono del cliente
 * @param {string} opts.mensaje - Mensaje prellenado
 */
export async function compartirPorWhatsApp({ pdfBlob, pdfFilename, telefono, mensaje }) {
  const telFormateado = formatearTelefono(telefono)

  // Intentar Web Share API en móvil (permite compartir el PDF como archivo)
  if (esMobil() && pdfBlob && navigator.canShare) {
    try {
      const file = new File([pdfBlob], pdfFilename, { type: 'application/pdf' })
      const shareData = { files: [file], text: mensaje }

      if (navigator.canShare(shareData)) {
        await navigator.share(shareData)
        return { method: 'share_api' }
      }
    } catch (err) {
      // Si el usuario cancela o falla, caer al método wa.me
      if (err.name === 'AbortError') return { method: 'cancelled' }
    }
  }

  // Fallback: descargar PDF + abrir WhatsApp con mensaje
  if (pdfBlob) {
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = pdfFilename
    a.click()
    URL.revokeObjectURL(url)
  }

  // Abrir WhatsApp con el teléfono del cliente
  const waUrl = telFormateado
    ? `https://wa.me/${telFormateado}?text=${encodeURIComponent(mensaje)}`
    : `https://wa.me/?text=${encodeURIComponent(mensaje)}`

  window.open(waUrl, '_blank', 'noopener')
  return { method: 'wa_link' }
}
