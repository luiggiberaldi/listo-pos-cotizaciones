// src/utils/entitySearch.js
// Buscador común para entidades administrativas (clientes, proveedores,
// transportistas y documentos). No consulta datos ni cambia reglas de acceso;
// únicamente normaliza, puntúa y ordena la lista que ya recibió la vista.

const DEFAULT_MIN_TOKEN_LENGTH = 1

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function compactSearchText(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, '')
}

function tokenize(query) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= DEFAULT_MIN_TOKEN_LENGTH)
}

function words(value) {
  return normalizeSearchText(value).split(/[^a-z0-9]+/).filter(Boolean)
}

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a || !b) return Math.max(a.length, b.length)
  if (Math.abs(a.length - b.length) > 3) return Math.abs(a.length - b.length)

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current = new Array(b.length + 1)

  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = a[row - 1] === b[column - 1]
        ? previous[column - 1]
        : 1 + Math.min(previous[column - 1], previous[column], current[column - 1])
    }
    ;[previous, current] = [current, previous]
  }

  return previous[b.length]
}

function fuzzyThreshold(token) {
  if (token.length < 4) return 0
  if (token.length <= 6) return 1
  if (token.length <= 10) return 2
  return 3
}

function readField(item, field) {
  if (typeof field === 'function') return field(item)
  if (typeof field === 'string') return item?.[field]
  if (field && typeof field.get === 'function') return field.get(item)
  if (field && field.key) return item?.[field.key]
  return ''
}

function fieldConfig(field) {
  if (typeof field === 'string' || typeof field === 'function') {
    return { source: field, weight: 1 }
  }
  return {
    ...field,
    source: field?.source ?? field?.get ?? field?.key,
    weight: Number(field?.weight) || 1,
  }
}

function scoreField(value, token, compactToken) {
  const normalized = normalizeSearchText(value)
  if (!normalized) return 0

  const compact = compactSearchText(value)
  const tokenIsNumeric = /\d/.test(token)
  const normalizedWords = words(value)

  if (normalized === token || (compactToken.length >= 2 && compact === compactToken)) return 120
  if (normalized.startsWith(token)) return 92
  if (normalizedWords.some(word => word.startsWith(token))) return 78
  if (compactToken.length >= 2 && compact.includes(compactToken)) return 62
  if (normalized.includes(token)) return 52

  // Iniciales: "dc" encuentra "Distrito Capital".
  if (!tokenIsNumeric && token.length >= 2) {
    const initials = normalizedWords.map(word => word[0]).join('')
    if (initials.includes(token)) return 34
  }

  // Los números se comparan solo literalmente para no confundir códigos,
  // teléfonos, RIF o correlativos parecidos.
  if (tokenIsNumeric) return 0

  const threshold = fuzzyThreshold(token)
  if (threshold === 0) return 0
  const fuzzyMatch = normalizedWords.some(word => levenshtein(word, token) <= threshold)
  return fuzzyMatch ? 24 : 0
}

export function scoreSearchEntity(item, query, fields = [], options = {}) {
  const rawQuery = normalizeSearchText(query)
  if (!rawQuery) return { match: true, score: 0, matchedTokens: 0, totalTokens: 0 }

  const configs = fields.map(fieldConfig)
  const tokens = tokenize(rawQuery)
  const compactQuery = compactSearchText(rawQuery)
  const values = configs.map(config => ({
    config,
    value: readField(item, config.source),
  }))

  let score = 0
  let fullQueryBonus = 0

  for (const { config, value } of values) {
    const normalized = normalizeSearchText(value)
    const compact = compactSearchText(value)
    if (normalized && normalized.includes(rawQuery)) {
      fullQueryBonus = Math.max(fullQueryBonus, 100 * config.weight)
    }
    if (compactQuery.length >= 2 && compact && compact.includes(compactQuery)) {
      fullQueryBonus = Math.max(fullQueryBonus, 115 * config.weight)
    }
  }

  let matchedTokens = 0
  for (const token of tokens) {
    const compactToken = compactSearchText(token)
    let best = 0
    for (const { config, value } of values) {
      best = Math.max(best, scoreField(value, token, compactToken) * config.weight)
    }
    if (best > 0) {
      matchedTokens += 1
      score += best
    }
  }

  const requireAll = options.requireAll !== false
  const match = requireAll
    ? matchedTokens === tokens.length
    : matchedTokens > 0

  return {
    match,
    score: score + fullQueryBonus,
    matchedTokens,
    totalTokens: tokens.length,
    coverage: tokens.length ? matchedTokens / tokens.length : 1,
  }
}

export function rankEntities(items = [], query = '', fields = [], options = {}) {
  if (!String(query ?? '').trim()) return [...items]

  const ranked = items
    .map((item, index) => ({
      item,
      index,
      result: scoreSearchEntity(item, query, fields, options),
    }))
    .filter(({ result }) => result.match && result.score >= (options.minScore ?? 1))
    .sort((a, b) => b.result.score - a.result.score || a.index - b.index)

  const limit = Number(options.limit)
  return Number.isFinite(limit) && limit > 0
    ? ranked.slice(0, limit).map(({ item }) => item)
    : ranked.map(({ item }) => item)
}

export function searchEntityFields(fields = []) {
  return fields.map(fieldConfig)
}