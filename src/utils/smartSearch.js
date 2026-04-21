// src/utils/smartSearch.js
// Búsqueda inteligente para productos de construcción
// Maneja plurales, sinónimos (media→1/2, metros→mts), y múltiples términos

// ─── Sinónimos comunes en materiales de construcción ─────────────────────────
const SINONIMOS = {
  // Fracciones
  'media':         ['1/2'],
  'medio':         ['1/2'],
  'cuarto':        ['1/4'],
  'octavo':        ['1/8'],
  'tres octavos':  ['3/8'],
  'cinco octavos': ['5/8'],
  'tres cuartos':  ['3/4'],
  'siete octavos': ['7/8'],

  // Unidades de longitud
  'metros':  ['mts', 'm', 'metro'],
  'metro':   ['mts', 'm', 'metros'],
  'mts':     ['m', 'metro', 'metros'],
  'centimetros': ['cm', 'cms'],
  'milimetros':  ['mm', 'mms'],
  'pulgadas': ['pulg', '"', 'pulgada'],
  'pulgada':  ['pulg', '"', 'pulgadas'],
  'pulg':     ['"', 'pulgada', 'pulgadas'],
  'pies':     ['pie', 'ft'],
  'pie':      ['pies', 'ft'],

  // Materiales
  'galvanizado': ['galv', 'galvanizada'],
  'galvanizada': ['galv', 'galvanizado'],
  'galv':        ['galvanizado', 'galvanizada'],
  'acero':       ['ac'],
  'inoxidable':  ['inox'],
  'inox':        ['inoxidable'],
  'hierro':      ['hro'],
  'aluminio':    ['al', 'alum'],
  'estriada':    ['estriado'],
  'estriado':    ['estriada'],
  'negro':       ['negra'],
  'negra':       ['negro'],
  'blanco':      ['blanca'],
  'blanca':      ['blanco'],
  'redondo':     ['redonda'],
  'redonda':     ['redondo'],
  'cuadrado':    ['cuadrada'],
  'cuadrada':    ['cuadrado'],
  'rectangular': ['rect'],
  'estructural': ['estruct'],

  // Tipos de producto
  'lamina':  ['lam', 'laminas'],
  'laminas': ['lam', 'lamina'],
  'tubo':    ['tubos'],
  'tubos':   ['tubo'],
  'perfil':  ['perfiles'],
  'perfiles':['perfil'],
  'viga':    ['vigas'],
  'vigas':   ['viga'],
  'cabilla': ['cabillas'],
  'cabillas':['cabilla'],
  'angulo':  ['angulos'],
  'angulos': ['angulo'],
  'platina': ['platinas'],
  'platinas':['platina'],
  'tornillo':['tornillos'],
  'tornillos':['tornillo'],
  'clavo':   ['clavos'],
  'clavos':  ['clavo'],
  'tuerca':  ['tuercas'],
  'tuercas': ['tuerca'],
  'arandela':['arandelas'],
  'arandelas':['arandela'],
  'conexion':['conexiones'],
  'conexiones':['conexion'],
  'valvula': ['valvulas'],
  'valvulas':['valvula'],

  // Abreviaciones comunes
  'diam':    ['diametro'],
  'diametro':['diam'],
  'espesor': ['esp'],
  'esp':     ['espesor'],
  'largo':   ['lgo', 'long'],
  'ancho':   ['an'],
}

// Mapa de fracciones escritas en palabras a su representación numérica
// Se procesan como multi-palabra antes de tokenizar
const FRACCIONES_MULTI = [
  ['tres octavos', '3/8'],
  ['cinco octavos', '5/8'],
  ['tres cuartos', '3/4'],
  ['siete octavos', '7/8'],
]

/**
 * Normaliza y expande un término de búsqueda en variantes para matching
 * Retorna un array de arrays — cada sub-array son las variantes de un término
 * Todos los términos deben hacer match (lógica AND)
 */
export function parseSearchTerms(query) {
  if (!query || !query.trim()) return []

  let q = query.toLowerCase().trim()

  // Reemplazar fracciones multi-palabra antes de tokenizar
  for (const [frase, reemplazo] of FRACCIONES_MULTI) {
    q = q.replace(new RegExp(frase, 'g'), reemplazo)
  }

  // Normalizar caracteres especiales
  q = q.replace(/[áà]/g, 'a')
       .replace(/[éè]/g, 'e')
       .replace(/[íì]/g, 'i')
       .replace(/[óò]/g, 'o')
       .replace(/[úù]/g, 'u')
       .replace(/ñ/g, 'n')

  // Tokenizar
  const tokens = q.split(/\s+/).filter(Boolean)

  // Para cada token, generar variantes (el token original + sinónimos + deplural)
  return tokens.map(token => {
    const variantes = new Set([token])

    // Sinónimos directos
    const sins = SINONIMOS[token]
    if (sins) sins.forEach(s => variantes.add(s))

    // Si termina en 's', probar sin la 's' (deplural simple)
    if (token.length > 3 && token.endsWith('s')) {
      const singular = token.slice(0, -1)
      variantes.add(singular)
      const sinsSingular = SINONIMOS[singular]
      if (sinsSingular) sinsSingular.forEach(s => variantes.add(s))
    }

    // Si termina en 'es', probar sin 'es' (ej: conexiones → conexion)
    if (token.length > 4 && token.endsWith('es')) {
      const base = token.slice(0, -2)
      variantes.add(base)
      const sinsBase = SINONIMOS[base]
      if (sinsBase) sinsBase.forEach(s => variantes.add(s))
    }

    return [...variantes]
  })
}

/**
 * Normaliza texto para comparación (quita tildes)
 */
function normalizeText(text) {
  return (text || '').toLowerCase()
    .replace(/[áà]/g, 'a')
    .replace(/[éè]/g, 'e')
    .replace(/[íì]/g, 'i')
    .replace(/[óò]/g, 'o')
    .replace(/[úù]/g, 'u')
    .replace(/ñ/g, 'n')
}

/**
 * Búsqueda inteligente client-side
 * Retorna true si el texto contiene TODOS los términos (alguna variante de cada uno)
 */
export function smartMatch(text, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true
  const normalized = normalizeText(text)
  return searchTerms.every(variantes =>
    variantes.some(v => normalized.includes(v))
  )
}

/**
 * Filtra un producto por nombre y código usando búsqueda inteligente
 */
export function smartMatchProducto(producto, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true
  // Concatenar nombre y código para buscar en ambos
  const texto = normalizeText(`${producto.nombre || ''} ${producto.codigo || ''}`)
  return searchTerms.every(variantes =>
    variantes.some(v => texto.includes(v))
  )
}

/**
 * Construye filtro PostgREST para búsqueda inteligente en Supabase
 * Retorna un array de strings para encadenar con .or() por cada término
 * Ejemplo: para "cabillas media 6 metros" retorna condiciones que
 * buscan cada grupo de variantes en nombre o codigo
 */
export function buildSmartFilter(query) {
  const terms = parseSearchTerms(query)
  if (terms.length === 0) return null

  // Cada término genera un OR entre sus variantes (en nombre y codigo)
  // Todos los términos se conectan con AND (encadenando .or() calls)
  return terms.map(variantes => {
    const conditions = variantes.flatMap(v => {
      const safe = v.replace(/[.,()\\%_]/g, '')
      if (!safe) return []
      return [
        `nombre.ilike.%${safe}%`,
        `codigo.ilike.%${safe}%`,
      ]
    })
    return conditions.join(',')
  }).filter(Boolean)
}
