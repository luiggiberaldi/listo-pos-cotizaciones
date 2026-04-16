// src/services/pdf/pdfLogo.js
// Carga el logo de la empresa como base64 para incrustar en PDFs
// Redimensiona a max 400px para evitar PDFs enormes (logo 4500px → PDF de 77MB)
export async function cargarLogo(logoUrl, maxPx = 400) {
  if (!logoUrl) return null
  try {
    const res = await fetch(logoUrl)
    if (!res.ok) return null
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
        resolve(null)
      }

      img.src = objectUrl
    })
  } catch {
    return null
  }
}
