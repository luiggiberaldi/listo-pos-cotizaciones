// src/utils/imageCompress.js
// Comprime imagen a WebP (max 300px, calidad 0.55) para Supabase Storage
// Optimizado para plan gratuito: ~10-15KB por imagen

/**
 * Comprime un File de imagen a WebP
 * @param {File} file - archivo de imagen original
 * @returns {Promise<{ blob: Blob, dataUrl: string, revoke: () => void }>}
 */
export function comprimirImagen(file, { maxSize = 300, quality = 0.55 } = {}) {
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
        (blob) => {
          if (!blob) return reject(new Error('Error al comprimir imagen'))
          const dataUrl = URL.createObjectURL(blob)
          resolve({ blob, dataUrl, revoke: () => URL.revokeObjectURL(dataUrl) })
        },
        'image/webp',
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo cargar la imagen'))
    }

    img.src = url
  })
}

/**
 * Sube imagen comprimida a Supabase Storage
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} productoId - UUID del producto
 * @param {Blob} blob - imagen comprimida
 * @returns {Promise<string>} URL pública de la imagen
 */
export async function subirImagenProducto(supabase, productoId, blob) {
  const path = `${productoId}.webp`

  // Upsert: sobreescribe si ya existe
  const { error } = await supabase.storage
    .from('productos')
    .upload(path, blob, {
      contentType: 'image/webp',
      upsert: true,
      cacheControl: '31536000', // 1 año cache (la imagen cambia con upsert)
    })

  if (error) throw error

  const { data } = supabase.storage.from('productos').getPublicUrl(path)
  // Agregar timestamp para bust cache cuando se actualiza
  return `${data.publicUrl}?v=${Date.now()}`
}

/**
 * Elimina imagen de Supabase Storage
 */
export async function eliminarImagenProducto(supabase, productoId) {
  const path = `${productoId}.webp`
  await supabase.storage.from('productos').remove([path])
}
