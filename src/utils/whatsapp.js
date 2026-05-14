// src/utils/whatsapp.js
// Utilidades para compartir cotizaciones por WhatsApp
// Sube el PDF al worker y envía el link por wa.me directo al número del cliente

import supabase from '../services/supabase/client'
import { showToast } from '../components/ui/Toast'

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
 * Sube un PDF al worker (que usa service key) y devuelve la URL pública
 */
async function subirPdfTemporal(pdfBlob, pdfFilename) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const headers = {
    'Content-Type': 'application/pdf',
    'X-Filename': pdfFilename,
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch('/api/pdf-temp', {
    method: 'POST',
    headers,
    body: pdfBlob,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err)
  }

  const { url } = await res.json()
  return url
}

/**
 * Genera el mensaje para WhatsApp (con link al PDF)
 */
export function generarMensaje({ nombreNegocio, nombreCliente, numDisplay, totalUsd, nombreVendedor, items = [], pdfUrl = null, tipo = 'cotización' }) {
  const empresa = nombreNegocio || 'Construacero Carabobo'
  const saludo = nombreCliente ? `Estimado/a *${nombreCliente}*,` : 'Estimado/a cliente,'

  const firma = nombreVendedor
    ? `Atentamente,\n*${nombreVendedor}*\n_${empresa}_`
    : `Atentamente,\n_${empresa}_`

  const sustantivo = tipo.toLowerCase().includes('orden') ? 'la orden de despacho' : (tipo.toLowerCase().includes('nota') || tipo.toLowerCase().includes('despacho')) ? 'el despacho' : 'la cotización'
  const intro = nombreVendedor
    ? `Le saluda *${nombreVendedor}* de *${empresa}*. Le enviamos ${sustantivo} *${numDisplay}*:`
    : `Le enviamos ${sustantivo} *${numDisplay}* de *${empresa}*:`

  const pdfLine = pdfUrl
    ? `*Pulse acá para ver su ${tipo.toLowerCase()}:*\n${pdfUrl}`
    : 'Adjunto encontrará el documento PDF para su revisión.'

  return [
    saludo,
    '',
    intro,
    '',
    pdfLine,
    '',
    'Quedamos a su disposición para cualquier consulta.',
    '',
    firma,
  ].filter(l => l !== null && l !== undefined).join('\n')
}

/**
 * Comparte una cotización por WhatsApp
 * - Móvil: usa Web Share API para adjuntar el PDF directamente
 * - PC: descarga el PDF automáticamente y abre wa.me con el mensaje
 */
export async function compartirPorWhatsApp({ pdfBlob, pdfFilename, telefono, mensaje, mensajeParams = null }) {
  const telFormateado = formatearTelefono(telefono)
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

  // ── Móvil: intentar Web Share API con archivo adjunto ──
  if (isMobile && pdfBlob && navigator.canShare) {
    try {
      // 1. Copiar al portapapeles
      let copiado = false
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(mensaje)
          copiado = true
        }
      } catch (err) {
        console.warn('[WhatsApp] No se pudo copiar al portapapeles', err)
      }

      const pdfFile = new File([pdfBlob], pdfFilename || 'cotizacion.pdf', { type: 'application/pdf' })
      const shareData = {
        text: mensaje,
        files: [pdfFile],
      }
      if (navigator.canShare(shareData)) {
        if (copiado) {
          showToast('Texto copiado. Dale a "Pegar" en WhatsApp', 'success')
          await new Promise(r => setTimeout(r, 800)) // delay to let user read
        }
        await navigator.share(shareData)
        return { method: 'web_share_api' }
      }
    } catch (err) {
      if (err.name === 'AbortError') return { method: 'web_share_cancelled' }
      console.warn('[WhatsApp] Web Share API falló, usando fallback:', err?.message)
    }
  }

  // ── PC: siempre descargar PDF + abrir WhatsApp Web con mensaje ──
  let mensajeFinal = mensaje
  if (pdfBlob && mensajeParams) {
    try {
      const pdfUrl = await subirPdfTemporal(pdfBlob, pdfFilename)
      mensajeFinal = generarMensaje({ ...mensajeParams, pdfUrl })
    } catch (err) {
      console.error('[WhatsApp] Error subiendo PDF:', err?.message || err)
    }
  }

  // En PC: descargar el PDF automáticamente para que lo pueda adjuntar
  if (!isMobile && pdfBlob) {
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = pdfFilename || 'cotizacion.pdf'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  // Abrir WhatsApp directo al número del cliente
  const waUrl = telFormateado
    ? `https://wa.me/${telFormateado}?text=${encodeURIComponent(mensajeFinal)}`
    : `https://wa.me/?text=${encodeURIComponent(mensajeFinal)}`

  window.open(waUrl, '_blank', 'noopener')
  return { method: isMobile ? 'wa_link_mobile' : 'wa_link_desktop' }
}
