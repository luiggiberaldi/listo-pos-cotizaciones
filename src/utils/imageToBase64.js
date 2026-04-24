/**
 * Convierte un File/Blob a string base64 (sin el prefijo data:...;base64,)
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Comprime una imagen para OCR (mayor resolución que para thumbnails)
 * Max 1200px, calidad 0.8
 */
export function comprimirParaOCR(file, { maxSize = 1200, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => {
          if (!blob) return reject(new Error('Error comprimiendo imagen'))
          const reader = new FileReader()
          reader.onload = () => resolve({
            base64: reader.result.split(',')[1],
            mimeType: 'image/jpeg',
            sizeKB: Math.round(blob.size / 1024),
          })
          reader.onerror = reject
          reader.readAsDataURL(blob)
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Error cargando imagen'))
    }
    img.src = url
  })
}
