export const PREFIJOS_RIF = ['V', 'J', 'E', 'G', 'P']

export function formatearConPuntos(num) {
  if (!num) return ''
  return num.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function parsearRif(rif) {
  if (!rif) return { prefijo: 'V', numero: '' }
  const limpio = rif.trim().toUpperCase()
  const match = limpio.match(/^([VJEGP])-?(.*)$/)
  if (match) return { prefijo: match[1], numero: match[2].replace(/\./g, '') }
  return { prefijo: 'V', numero: limpio.replace(/\./g, '') }
}

export function formatearRif(prefijo, numero) {
  const limpio = numero.replace(/[^\d-]/g, '')
  if (!limpio) return ''
  if (prefijo === 'V') return `V${formatearConPuntos(limpio)}`
  return `${prefijo}-${limpio}`
}
