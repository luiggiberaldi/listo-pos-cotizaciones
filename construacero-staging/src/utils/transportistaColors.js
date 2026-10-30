const HSL_RE = /^hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)$/

function withAlpha(solid, alpha) {
  const match = HSL_RE.exec(solid)
  if (!match) return solid
  const [, hue, saturation, lightness] = match
  return `hsl(${hue} ${saturation}% ${lightness}% / ${alpha})`
}

export function colorTransportista(nombre = '') {
  const value = String(nombre || '')
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
  }

  const hue = Math.abs(hash % 360)
  const solid = `hsl(${hue}, 65%, 45%)`

  return {
    solid,
    gradientStart: withAlpha(solid, '0.93'),
    gradientEnd: withAlpha(solid, '0.60'),
    border: withAlpha(solid, '0.18'),
    shadow: withAlpha(solid, '0.06'),
  }
}


// Flota propia (choferes locales y camiones de la empresa): un solo color fijo con
// los colores de la marca (azul marino → dorado). Ningún transportista general lo usa,
// porque los generales toman un tono único por nombre en una sola gama.
export const COLORES_FLOTA_PROPIA = {
  solid: '#1B365D',
  gradientStart: '#1B365D',
  gradientEnd: '#B8860B',
  border: 'rgba(184, 134, 11, 0.45)',
  shadow: 'rgba(184, 134, 11, 0.18)',
}
