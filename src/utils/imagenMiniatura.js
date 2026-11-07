// src/utils/imagenMiniatura.js
// Miniaturas de fotos de productos (gratis: archivos propios, sin el servicio de
// transformación de imágenes de Supabase).
//   Foto grande : productos/<ruta>.<jpg|jpeg|png|webp>     (ej. productos/productos/TUB0202012.jpg)
//   Miniatura   : productos/thumbs/<ruta>.webp              (240 px, ~5-10 KB)

export const MINIATURA_MAX = 240
export const MINIATURA_CALIDAD = 0.7

const RE_FOTO = /(\/storage\/v1\/object\/public\/productos\/)(?!thumbs\/)([^?#]+)\.(?:jpe?g|png|webp)(?=[?#]|$)/i

/**
 * Dada la URL pública de la foto grande de un producto, devuelve la de su miniatura.
 * Si la URL no tiene la forma esperada (otro bucket, otro dominio, vacía) la devuelve igual.
 */
export function urlMiniatura(url) {
  if (typeof url !== 'string' || !url) return url
  return url.replace(RE_FOTO, '$1thumbs/$2.webp')
}
