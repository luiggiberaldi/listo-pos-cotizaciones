// Foto de producto para LISTAS: pide la miniatura (liviana) y, si no existe o falla,
// cae automáticamente a la foto grande. Si también falla, llama al onError que se le pase.
import { useState } from 'react'
import { urlMiniatura } from '../../utils/imagenMiniatura'

export default function ImgProducto({ src, onError, ...props }) {
  const [srcFallida, setSrcFallida] = useState(null)
  const usarOriginal = srcFallida === src
  return (
    <img
      {...props}
      src={usarOriginal ? src : urlMiniatura(src)}
      onError={(e) => {
        if (!usarOriginal && urlMiniatura(src) !== src) setSrcFallida(src)
        else onError?.(e)
      }}
    />
  )
}
