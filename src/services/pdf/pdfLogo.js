// src/services/pdf/pdfLogo.js
// Carga el logo de la empresa como base64 para incrustar en PDFs
// Usa logo embebido como fallback si no hay logo_url configurado
import { LOGO_CONSTRUACERO } from './logoBase64'

export async function cargarLogo(logoUrl, maxPx = 400) {
  if (!logoUrl) return LOGO_CONSTRUACERO

  try {
    const res = await fetch(logoUrl)
    if (!res.ok) return LOGO_CONSTRUACERO
    const blob = await res.blob()

    return new Promise((resolve) => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(blob)

      img.onload = () => {
        URL.revokeObjectURL(objectUrl)

        // Calcular dimensiones escaladas manteniendo aspect ratio
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)

        // Dibujar en canvas redimensionado
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)

        resolve(canvas.toDataURL('image/png'))
      }

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        resolve(LOGO_CONSTRUACERO)
      }

      img.src = objectUrl
    })
  } catch {
    return LOGO_CONSTRUACERO
  }
}
