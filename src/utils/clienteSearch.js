// src/utils/clienteSearch.js
// Motor de búsqueda inteligente de clientes con scoring y normalización

/**
 * Normaliza un string: minúsculas, sin acentos, sin puntos/guiones
 */
function normalizar(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[-./,\s]+/g, ' ')      // normalizar separadores a espacio
    .trim()
}

/**
 * Calcula el score de relevancia de un cliente para un término de búsqueda.
 * Mayor score = más relevante.
 */
function calcularScore(cliente, termino) {
  const q = normalizar(termino)
  if (!q) return 1

  const campos = [
    { valor: normalizar(cliente.nombre),     peso: 10 },
    { valor: normalizar(cliente.rif_cedula).replace(/\s+/g, ''), peso: 8  },
    { valor: normalizar(cliente.telefono).replace(/\s+/g, ''),   peso: 6  },
    { valor: normalizar(cliente.email),      peso: 4  },
    { valor: normalizar(cliente.ciudad),     peso: 3  },
    { valor: normalizar(cliente.estado),     peso: 2  },
  ]

  let score = 0

  for (const { valor, peso } of campos) {
    if (!valor) continue

    if (valor === q)                        { score += peso * 100; continue } // exacto
    if (valor.startsWith(q))               { score += peso * 50;  continue } // empieza con
    if (valor.split(' ').some(w => w.startsWith(q))) { score += peso * 20; continue } // palabra empieza
    if (valor.includes(q))                 { score += peso * 10; continue }  // contiene
    // Fuzzy: todos los chars del query presentes en orden
    if (contieneFuzzy(valor, q))           { score += peso * 2 }
  }

  // Bonus si múltiples palabras del nombre coinciden
  const palabrasQ = q.split(' ').filter(Boolean)
  if (palabrasQ.length > 1) {
    const nombreNorm = normalizar(cliente.nombre)
    const hits = palabrasQ.filter(p => nombreNorm.includes(p)).length
    score += hits * 15
  }

  return score
}

/**
 * Verifica si todos los caracteres de `query` aparecen en `texto` en orden (fuzzy).
 */
function contieneFuzzy(texto, query) {
  let i = 0
  for (const ch of texto) {
    if (ch === query[i]) i++
    if (i === query.length) return true
  }
  return false
}

/**
 * Busca y ordena clientes por relevancia.
 * @param {Array} clientes - Lista completa de clientes
 * @param {string} query - Término de búsqueda
 * @param {number} minScore - Score mínimo para incluir resultado (default 1)
 * @returns {Array} Clientes ordenados por relevancia (mayor score primero)
 */
export function buscarClientes(clientes = [], query = '', minScore = 1) {
  if (!query.trim()) return clientes

  // Soporta múltiples términos separados por espacio
  const terminos = normalizar(query).split(/\s+/).filter(Boolean)

  return clientes
    .map(c => {
      // Score es la suma del score de cada término individual
      const score = terminos.reduce((acc, t) => acc + calcularScore(c, t), 0)
      return { cliente: c, score }
    })
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map(({ cliente }) => cliente)
}
