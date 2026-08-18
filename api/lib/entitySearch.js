// api/lib/entitySearch.js
// Variante ligera del buscador compartido para filtrar listas ya limitadas al
// tenant actual dentro del Worker.

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function compact(value) {
  return normalize(value).replace(/[^a-z0-9]/g, '')
}

function words(value) {
  return normalize(value).split(/[^a-z0-9]+/).filter(Boolean)
}

function distance(a, b) {
  if (a === b) return 0
  if (!a || !b || Math.abs(a.length - b.length) > 2) return Math.max(a.length, b.length)
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], current[j - 1])
    }
    ;[prev, current] = [current, prev]
  }
  return prev[b.length]
}

function read(item, field) {
  if (typeof field === 'function') return field(item)
  return item?.[field]
}

function score(value, token) {
  const text = normalize(value)
  if (!text) return 0
  const compactText = compact(value)
  const compactToken = compact(token)
  const textWords = words(value)
  const numeric = /\d/.test(token)

  if (text === token || (compactToken.length >= 2 && compactText === compactToken)) return 120
  if (text.startsWith(token)) return 92
  if (textWords.some(word => word.startsWith(token))) return 78
  if (compactToken.length >= 2 && compactText.includes(compactToken)) return 62
  if (text.includes(token)) return 52
  if (numeric || token.length < 4) return 0
  return textWords.some(word => distance(word, token) <= (token.length <= 6 ? 1 : 2)) ? 24 : 0
}

export function rankSearch(rows = [], query = '', fields = []) {
  const raw = normalize(query)
  if (!raw) return rows
  const tokens = raw.split(/\s+/).filter(Boolean)
  const compactQuery = compact(raw)

  return rows
    .map((row, index) => {
      let total = 0
      let matched = 0
      let fullBonus = 0
      for (const token of tokens) {
        let best = 0
        for (const field of fields) {
          const weight = Number(field.weight) || 1
          const value = read(row, field.key ?? field.get)
          best = Math.max(best, score(value, token) * weight)
        }
        if (best > 0) {
          matched += 1
          total += best
        }
      }
      for (const field of fields) {
        const value = read(row, field.key ?? field.get)
        if (normalize(value).includes(raw) || (compactQuery.length >= 2 && compact(value).includes(compactQuery))) {
          fullBonus = Math.max(fullBonus, 100 * (Number(field.weight) || 1))
        }
      }
      return { row, index, score: total + fullBonus, matched }
    })
    .filter(result => result.matched === tokens.length)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(result => result.row)
}
