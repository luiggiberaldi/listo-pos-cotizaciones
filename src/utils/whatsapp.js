// src/utils/whatsapp.js
// Utilidades para compartir cotizaciones por WhatsApp
// Sube el PDF a Supabase Storage y envía el link por wa.me directo al número del cliente

import supabase from '../services/supabase/client'

/**
 * Formatea un número de teléfono para wa.me
 * Quita espacios, guiones y paréntesis. Asume Venezuela (+58)
 * Acepta: 412-1234567, 04121234567, +584121234567, 584121234567
 */
export function formatearTelefono(telefono) {
  if (!telefono) return ''
  let num = telefono.replace(/[\s\-\(\)\.]/g, '')
  if (num.startsWith('+')) num = num.slice(1)
  if (num.startsWith('0')) num = num.slice(1)
  if (num.startsWith('58') && num.length >= 12) return num
  if (!num.startsWith('58')) num = '58' + num
  return num
}

/**
 * Sube un PDF a Supabase Storage y devuelve la URL pública
 */
async function subirPdfTemporal(pdfBlob, pdfFilename) {
  const id = crypto.randomUUID().slice(0, 8)
  const path = `${id}_${pdfFilename}`

  const { error } = await supabase.storage
    .from('pdf-temp')
    .upload(path, pdfBlob, {
      contentType: 'application/pdf',
      cacheControl: '604800', // 7 días
      upsert: false,
    })

  if (error) throw error

  const { data } = supabase.storage.from('pdf-temp').getPublicUrl(path)
  return data.publicUrl
}

/**
 * Genera el mensaje para WhatsApp (con link al PDF)
 */
export function generarMensaje({ nombreNegocio, nombreCliente, numDisplay, totalUsd, validaHasta, nombreVendedor, items = [], pdfUrl = null }) {
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

  const pdfLine = pdfUrl
    ? `📄 *Ver/Descargar PDF:*\n${pdfUrl}`
    : 'Adjunto encontrara el documento PDF para su revision.'

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
    pdfLine,
    '',
    'Quedamos a su disposicion para cualquier consulta.',
    '',
    firma,
  ].filter(l => l !== null && l !== undefined).join('\n')
}

/**
 * Comparte una cotización por WhatsApp
 * 1. Sube el PDF a Supabase Storage
 * 2. Abre wa.me directo al número del cliente con el link del PDF
 */
export async function compartirPorWhatsApp({ pdfBlob, pdfFilename, telefono, mensaje, mensajeParams = null }) {
  const telFormateado = formatearTelefono(telefono)

  // Intentar subir el PDF y regenerar mensaje con el link
  let mensajeFinal = mensaje
  if (pdfBlob && mensajeParams) {
    try {
      const pdfUrl = await subirPdfTemporal(pdfBlob, pdfFilename)
      mensajeFinal = generarMensaje({ ...mensajeParams, pdfUrl })
    } catch (err) {
      console.warn('[WhatsApp] No se pudo subir el PDF, enviando sin link:', err)
      // Continuar con el mensaje original sin link
    }
  }

  // Abrir WhatsApp directo al número del cliente
  const waUrl = telFormateado
    ? `https://wa.me/${telFormateado}?text=${encodeURIComponent(mensajeFinal)}`
    : `https://wa.me/?text=${encodeURIComponent(mensajeFinal)}`

  window.open(waUrl, '_blank', 'noopener')
  return { method: 'wa_link' }
}
