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

