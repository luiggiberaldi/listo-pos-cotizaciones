// src/utils/smartSearch.js
// Motor de búsqueda inteligente para materiales de construcción — Venezuela
// Fuzzy matching, sinónimos, tolerancia a errores tipográficos, scoring

// ─── Palabras triviales que se ignoran en la búsqueda ─────────────────────────
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'para', 'con', 'por', 'en', 'al', 'y', 'o', 'que', 'se', 'es',
  'saco', 'sacos', 'kilo', 'kilos', 'kg', 'rollo', 'rollos',
  'unidad', 'unidades', 'und', 'pieza', 'piezas', 'pza',
  'metro', 'metros', 'lineal', 'lineales',
])

// ─── Fracciones multi-palabra (se procesan antes de tokenizar) ────────────────
const FRACCIONES_MULTI = [
  // Fracciones escritas
  ['tres octavos', '3/8'],
  ['cinco octavos', '5/8'],
  ['tres cuartos', '3/4'],
  ['siete octavos', '7/8'],
  ['una pulgada', '1"'],
  ['dos pulgadas', '2"'],
  ['tres pulgadas', '3"'],
  ['cuatro pulgadas', '4"'],
  ['seis pulgadas', '6"'],
  // Medidas compuestas coloquiales
  ['uno y medio', '1 1/2'],
  ['1 y medio', '1 1/2'],
  ['1 y media', '1 1/2'],
  ['pulgada y media', '1 1/2"'],
  ['2 y medio', '2 1/2'],
  ['2 y media', '2 1/2'],
  ['3 y medio', '3 1/2'],
  ['3 y media', '3 1/2'],
  // Aguas (deben ir antes de tokenizar)
  ['aguas negras', 'A/N'],
  ['agua negra', 'A/N'],
  ['aguas blancas', 'A.F'],
  ['agua blanca', 'A.F'],
  ['aguas frias', 'A.F'],
  ['agua fria', 'A.F'],
  ['agua caliente', 'A.C'],
  ['aguas calientes', 'A.C'],
  ['alta presion', 'alta presion'],
  // Medidas con "pulgadas" después del número
  ['pulgadas', '"'],
  ['pulgada', '"'],
  ['pulg', '"'],
]

// ─── Sinónimos y expansiones de jerga venezolana ──────────────────────────────
const SINONIMOS = {
  // === Fracciones ===
  'media':         ['1/2'],
  'medio':         ['1/2'],
  'cuarto':        ['1/4'],
  'octavo':        ['1/8'],

  // === Materiales — jerga venezolana ===
  'cabilla':       ['cabillas', 'cabilla estriada'],
  'cabillas':      ['cabilla', 'cabilla estriada'],
  'varilla':       ['cabilla', 'cabillas', 'cabilla estriada'],
  'varillas':      ['cabilla', 'cabillas'],
  'platina':       ['pletina', 'pletinas', 'platinas'],
  'platinas':      ['pletina', 'pletinas', 'platina'],
  'pletina':       ['platina', 'platinas'],
  'pletinas':      ['platina', 'platinas', 'pletina'],
  'zinc':          ['lamina', 'galv', 'galvanizado', 'galvatecho', 'prepintado'],
  'acerolit':      ['lamina acerolit'],
  'teja':          ['lamina', 'acerolit', 'galvatecho', 'termopanel'],
  'tejas':         ['lamina', 'acerolit', 'galvatecho', 'termopanel'],
  'lamina':        ['lam', 'laminas'],
  'laminas':       ['lam', 'lamina'],
  'lam':           ['lamina', 'laminas'],
  'losacero':      ['losa acero', 'losacero'],
  'perfil':        ['perfiles', 'vigueta'],
  'perfiles':      ['perfil', 'vigueta'],
  'vigueta':       ['perfil', 'perfiles', 'vigueta tipo c'],
  'cercha':        ['cerchas'],
  'cerchas':       ['cercha'],

  // === Tubos ===
  'tubo':          ['tubos'],
  'tubos':         ['tubo'],
  'tuberia':       ['tubo', 'tubos'],
  'tubular':       ['tubo estruc'],
  'estructural':   ['estruc', 'estruc.'],
  'estruc':        ['estructural'],
  'pulido':        ['pulido'],
  'ventilacion':   ['vent', 'vent.'],
  'vent':          ['ventilacion'],
  'electrico':     ['elec', 'elec.', 'electrica', 'emt', 'conduit'],
  'electrica':     ['elec', 'electrico'],
  'elec':          ['electrico', 'electrica'],
  'conduit':       ['elec', 'electrico'],
  'emt':           ['elec', 'electrico', 'conduit'],
  'pvc':           ['pvc'],

  // === Conexiones ===
  'codo':          ['codos'],
  'codos':         ['codo'],
  'tee':           ['te'],
  'te':            ['tee'],
  'reduccion':     ['reducciones'],
  'reducciones':   ['reduccion'],
  'anillo':        ['anillos'],
  'anillos':       ['anillo'],
  'sifon':         ['sifones'],
  'sifones':       ['sifon'],
  'union':         ['uniones'],
  'uniones':       ['union'],
  'tapon':         ['tapones'],
  'tapones':       ['tapon'],
  'niple':         ['niples', 'nipple', 'nipples'],
  'niples':        ['niple'],
  'yee':           ['ye', 'y'],
  'ye':            ['yee'],
  'curva':         ['curvas'],
  'curvas':        ['curva'],
  'adaptador':     ['adaptadores'],

  // === Pegamentos y cementos ===
  'pega':          ['pegamento', 'cemento pvc', 'pega prof'],
  'pegamento':     ['pega', 'pega prof'],
  'cemento':       ['cemento gris'],
  'sikaflex':      ['sika'],
  'sika':          ['sikaflex'],

  // === Metales y acabados ===
  'galvanizado':   ['galv', 'galv.', 'galvanizada'],
  'galvanizada':   ['galv', 'galv.', 'galvanizado'],
  'galv':          ['galvanizado', 'galvanizada'],
  'hierro':        ['hn', 'hro', 'hierro negro'],
  'hn':            ['hierro', 'hierro negro'],
  'acero':         ['ac'],
  'inoxidable':    ['inox'],
  'inox':          ['inoxidable'],
  'estriada':      ['estriado'],
  'estriado':      ['estriada'],
  'negro':         ['negra', 'hn'],
  'negra':         ['negro'],
  'blanco':        ['blanca'],
  'blanca':        ['blanco'],
  'redondo':       ['redonda'],
  'redonda':       ['redondo'],
  'cuadrado':      ['cuadrada', 'cuad', 'cuad.'],
  'cuadrada':      ['cuadrado', 'cuad'],
  'cuad':          ['cuadrado', 'cuadrada'],
  'rectangular':   ['rect', 'rect.'],
  'rect':          ['rectangular'],
  'liso':          ['lisa'],
  'lisa':          ['liso'],
  'roscado':       ['rosc', 'c/rosc', 'roscada'],
  'rosc':          ['roscado', 'c/rosc'],

  // === Tipos de producto ===
  'viga':          ['vigas'],
  'vigas':         ['viga'],
  'angulo':        ['angulos'],
  'angulos':       ['angulo'],
  'malla':         ['mallas', 'truckson'],
  'mallas':        ['malla', 'truckson'],
  'truckson':      ['malla', 'mallas'],
  'alambre':       ['alambre galvanizado', 'alambron'],
  'alambron':      ['alambre'],
  'zuncho':        ['zunchos'],
  'zunchos':       ['zuncho'],
  'cable':         ['cables'],
  'cables':        ['cable'],
  'breaker':       ['breakers'],
  'cajetin':       ['cajetines'],
  'disco':         ['discos'],
  'discos':        ['disco'],
  'electrodo':     ['electrodos'],
  'electrodos':    ['electrodo'],
  'clavo':         ['clavos'],
  'clavos':        ['clavo'],
  'tornillo':      ['tornillos', 'tor'],
  'tornillos':     ['tornillo', 'tor'],
  'tor':           ['tornillo', 'tornillos'],
  'barra':         ['barras'],
  'barras':        ['barra'],
  'drywall':       ['dry wall', 'laminas drywall'],
  'arvidal':       ['arvidal'],

  // === Abreviaciones de inventario ===
  'diametro':      ['diam'],
  'diam':          ['diametro'],
  'espesor':       ['esp'],
  'esp':           ['espesor'],
  'calibre':       ['cal', 'cal.'],
  'cal':           ['calibre'],
  'roscada':       ['rosc', 'c/rosc', 'roscado'],

  // === Vigas específicas ===
  'ipe':           ['ipe'],
  'ipn':           ['ipn'],
  'hea':           ['hea', 'he'],
  'heb':           ['heb', 'he'],
  'wf':            ['wf'],
  'upl':           ['upl'],
  'vp':            ['vp'],
}

// ─── Mapa de correcciones tipográficas comunes ────────────────────────────────
const TYPO_MAP = {
  // Errores comunes en teclado español
  'cavilla':     'cabilla',
  'cavillas':    'cabillas',
  'kabilla':     'cabilla',
  'kabillas':    'cabillas',
  'kabiya':      'cabilla',
  'cabiya':      'cabilla',
  'cabiyas':     'cabillas',
  'gavilla':     'cabilla',
  'cabila':      'cabilla',
  'cabilas':     'cabillas',
  'cabyas':      'cabillas',
  'tuvo':        'tubo',
  'tuvos':       'tubos',
  'tibo':        'tubo',
  'tubp':        'tubo',
  'lamima':      'lamina',
  'lanina':      'lamina',
  'lamna':       'lamina',
  'laina':       'lamina',
  'lanima':      'lamina',
  'codo':        'codo',
  'coto':        'codo',
  'angilo':      'angulo',
  'amgulo':      'angulo',
  'anguko':      'angulo',
  'abgulo':      'angulo',
  'vigaa':       'viga',
  'biga':        'viga',
  'bigas':       'vigas',
  'vigs':        'viga',
  'pletima':     'pletina',
  'platima':     'platina',
  'pletna':      'pletina',
  'clavp':       'clavo',
  'clabp':       'clavo',
  'clabo':       'clavo',
  'clabos':      'clavos',
  'almabre':     'alambre',
  'alhambre':    'alambre',
  'alanbre':     'alambre',
  'alembre':     'alambre',
  'cemeto':      'cemento',
  'cemnto':      'cemento',
  'ceemento':    'cemento',
  'semnto':      'cemento',
  'semento':     'cemento',
  'sifo':        'sifon',
  'cifon':       'sifon',
  'peag':        'pega',
  'peg':         'pega',
  'pgea':        'pega',
  'pegaa':       'pega',
  'mala':        'malla',
  'maalla':      'malla',
  'maya':        'malla',
  'mayas':       'mallas',
  'losasero':    'losacero',
  'lozacero':    'losacero',
  'losa':        'losacero',
  'tee':         'tee',
  'breiker':     'breaker',
  'breker':      'breaker',
  'braker':      'breaker',
  'arnes':       'arnes',
  'electrofo':   'electrodo',
  'electrod':    'electrodo',
  'perfl':       'perfil',
  'perfi':       'perfil',
  'disko':       'disco',
  'dico':        'disco',
  'zunco':       'zuncho',
  'suncho':      'zuncho',
  'sunco':       'zuncho',
  'cajetn':      'cajetin',
  'cajehin':     'cajetin',
  'rejila':      'rejilla',
  'rejiya':      'rejilla',
  'galbanizado': 'galvanizado',
  'galvaniado':  'galvanizado',
  'galvnizado':  'galvanizado',
  'estrucrural': 'estructural',
  'estrctural':  'estructural',
  'estructiral': 'estructural',
  'pulifo':      'pulido',
  'pulid':       'pulido',
  'galvatexo':   'galvatecho',
  'galvatehco':  'galvatecho',
  'termopabel':  'termopanel',
  'tremopanel':  'termopanel',
  'drywal':      'drywall',
  'draiwall':    'drywall',
}

// ─── Distancia de Levenshtein ─────────────────────────────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  // Optimización: si la diferencia de longitud es muy grande, no vale la pena
  if (Math.abs(a.length - b.length) > 3) return Math.abs(a.length - b.length)
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// Umbral de distancia según longitud del token
function fuzzyThreshold(token) {
  if (token.length <= 3) return 0   // No fuzzy para tokens muy cortos
  if (token.length <= 5) return 1
  if (token.length <= 8) return 2
  return 3
}

// ─── Normalización de texto ───────────────────────────────────────────────────
export function normalizeText(text) {
  return (text || '').toLowerCase()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u')
    .replace(/ñ/g, 'n')
}

// ─── Pre-procesar query: fracciones, medidas, limpieza ────────────────────────
function preprocessQuery(query) {
  let q = normalizeText(query)

  // Fracciones multi-palabra y sustituciones contextuales
  for (const [frase, reemplazo] of FRACCIONES_MULTI) {
    q = q.replace(new RegExp(frase, 'gi'), reemplazo)
  }

  // Números + " como pulgadas: "4"" → "4\""
  // Already handled by FRACCIONES_MULTI pulgadas→"

  // Detectar medidas compuestas: "1 1/2", "2 1/2" — no separar
  // Se manejan en tokenización

  return q
}

// ─── Tokenización inteligente ─────────────────────────────────────────────────
function tokenize(q) {
  // Primero detectar medidas compuestas como "1 1/2", "2 1/4" etc
  const compoundPattern = /(\d+)\s+(\d+\/\d+)/g
  const compounds = []
  q = q.replace(compoundPattern, (match, whole, frac) => {
    const compound = `${whole} ${frac}`
    compounds.push(compound)
    return `__COMPOUND${compounds.length - 1}__`
  })

  // Tokenizar
  const rawTokens = q.split(/[\s,;]+/).filter(Boolean)

  // Restaurar compounds y filtrar stopwords
  return rawTokens.map(t => {
    const compoundMatch = t.match(/^__COMPOUND(\d+)__$/)
    if (compoundMatch) return compounds[parseInt(compoundMatch[1])]
    return t
  }).filter(t => !STOPWORDS.has(t) && t.length > 0)
}

// ─── Expandir un token en variantes ───────────────────────────────────────────
function expandToken(token) {
  const variantes = new Set([token])

  // 1. Corrección de typos conocidos
  const corrected = TYPO_MAP[token]
  if (corrected) {
    variantes.add(corrected)
    // También expandir sinónimos del corregido
    const sins = SINONIMOS[corrected]
    if (sins) sins.forEach(s => variantes.add(s))
  }

  // 2. Sinónimos directos
  const sins = SINONIMOS[token]
  if (sins) sins.forEach(s => variantes.add(s))

  // 3. Deplural: "cabillas" → "cabilla"
  if (token.length > 3 && token.endsWith('s')) {
    const singular = token.slice(0, -1)
    variantes.add(singular)
    const sinsSingular = SINONIMOS[singular]
    if (sinsSingular) sinsSingular.forEach(s => variantes.add(s))
    const typoSingular = TYPO_MAP[singular]
    if (typoSingular) variantes.add(typoSingular)
  }

  // 4. Deplural "es": "conexiones" → "conexion"
  if (token.length > 4 && token.endsWith('es')) {
    const base = token.slice(0, -2)
    variantes.add(base)
    const sinsBase = SINONIMOS[base]
    if (sinsBase) sinsBase.forEach(s => variantes.add(s))
  }

  return [...variantes]
}

// ─── Parser de términos de búsqueda ───────────────────────────────────────────
export function parseSearchTerms(query) {
  if (!query || !query.trim()) return []

  const q = preprocessQuery(query)
  const tokens = tokenize(q)

  return tokens.map(token => expandToken(token))
}

// ─── Búsqueda con match exacto (includes) ────────────────────────────────────
export function smartMatch(text, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true
  const normalized = normalizeText(text)
  return searchTerms.every(variantes =>
    variantes.some(v => normalized.includes(v))
  )
}

// ─── Búsqueda con scoring (para ranking) ──────────────────────────────────────
export function smartMatchScore(text, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return { match: true, score: 0 }
  const normalized = normalizeText(text)
  let totalScore = 0
  let matchedTerms = 0

  for (const variantes of searchTerms) {
    let bestScore = 0
    let found = false

    for (const v of variantes) {
      if (normalized.includes(v)) {
        found = true
        // Bonus por match exacto de palabra vs substring
        const wordBoundary = new RegExp(`(^|[\\s.,;/\\-"])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s.,;/\\-"])`)
        if (wordBoundary.test(normalized)) {
          bestScore = Math.max(bestScore, 10 + v.length) // match exacto de palabra
        } else {
          bestScore = Math.max(bestScore, 5 + v.length) // match como substring
        }
        break
      }
    }

    if (found) {
      matchedTerms++
      totalScore += bestScore
    } else {
      // No encontrado exacto — intentar fuzzy
      const words = normalized.split(/[\s.,;/\-"]+/).filter(Boolean)
      let bestFuzzy = Infinity
      let fuzzyFound = false

      for (const v of variantes) {
        const threshold = fuzzyThreshold(v)
        if (threshold === 0) continue // No fuzzy para tokens cortos

        for (const word of words) {
          const dist = levenshtein(v, word)
          if (dist <= threshold && dist < bestFuzzy) {
            bestFuzzy = dist
            fuzzyFound = true
          }
        }
      }

      if (fuzzyFound) {
        matchedTerms++
        totalScore += Math.max(1, 5 - bestFuzzy) // Menor score por fuzzy
      }
    }
  }

  if (matchedTerms === 0) return { match: false, score: 0 }

  // Score final: % de términos que matchearon * score acumulado
  const coverage = matchedTerms / searchTerms.length
  return {
    match: coverage >= 0.5, // Al menos 50% de los términos deben matchear
    score: totalScore * coverage,
    coverage,
    matchedTerms,
    totalTerms: searchTerms.length,
  }
}

// ─── Búsqueda de producto con fuzzy fallback ─────────────────────────────────
export function smartMatchProducto(producto, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true
  const texto = normalizeText(`${producto.nombre || ''} ${producto.codigo || ''} ${producto.categoria || ''} ${producto.descripcion || ''}`)

  // Primero intentar match exacto (rápido)
  const exactMatch = searchTerms.every(variantes =>
    variantes.some(v => texto.includes(v))
  )
  if (exactMatch) return true

  // Fallback: fuzzy match — al menos 60% de los términos deben matchear
  const words = texto.split(/[\s.,;/\-"]+/).filter(Boolean)
  let matched = 0
  for (const variantes of searchTerms) {
    let found = false
    for (const v of variantes) {
      if (texto.includes(v)) { found = true; break }
      // Fuzzy solo para tokens >= 4 chars
      const threshold = fuzzyThreshold(v)
      if (threshold > 0) {
        for (const word of words) {
          if (levenshtein(v, word) <= threshold) { found = true; break }
        }
        if (found) break
      }
    }
    if (found) matched++
  }
  return matched >= Math.ceil(searchTerms.length * 0.6)
}

// ─── Búsqueda con ranking para listas de productos ───────────────────────────
export function smartSearchProductos(productos, query) {
  const searchTerms = parseSearchTerms(query)
  if (searchTerms.length === 0) return productos

  return productos
    .map(p => {
      const texto = `${p.nombre || ''} ${p.codigo || ''} ${p.categoria || ''} ${p.descripcion || ''}`
      const result = smartMatchScore(texto, searchTerms)
      return { ...p, _score: result.score, _match: result.match, _coverage: result.coverage }
    })
    .filter(p => p._match)
    .sort((a, b) => {
      // Primero por coverage (todos los términos encontrados primero)
      if (b._coverage !== a._coverage) return b._coverage - a._coverage
      // Luego por score
      if (b._score !== a._score) return b._score - a._score
      // Finalmente por stock
      return (b.stock_actual || 0) - (a.stock_actual || 0)
    })
}

// ─── Filtro PostgREST para Supabase ───────────────────────────────────────────
export function buildSmartFilter(query) {
  const terms = parseSearchTerms(query)
  if (terms.length === 0) return null

  return terms.map(variantes => {
    const conditions = variantes.flatMap(v => {
      // Limpiar caracteres especiales de PostgREST pero mantener fracciones y pulgadas
      const safe = v.replace(/[\\%_]/g, '').replace(/\./g, '*')
      if (!safe || safe.length < 1) return []
      return [
        `nombre.ilike.*${safe}*`,
        `codigo.ilike.*${safe}*`,
      ]
    })
    return conditions.join(',')
  }).filter(Boolean)
}
