import { describe, it, expect } from 'vitest'
import {
  normalizeText,
  parseSearchTerms,
  smartMatch,
  smartMatchScore,
  smartMatchProducto,
  smartSearchProductos,
  buildSmartFilter,
} from '../smartSearch'

// ─── normalizeText ──────────────────────────────────────────────────────────

describe('normalizeText', () => {
  it('remueve acentos: "ángulo" → "angulo"', () => {
    expect(normalizeText('ángulo')).toBe('angulo')
  })

  it('convierte a minusculas', () => {
    expect(normalizeText('TUBO GALVANIZADO')).toBe('tubo galvanizado')
  })

  it('remueve ñ: "caño" → "cano"', () => {
    expect(normalizeText('caño')).toBe('cano')
  })

  it('null retorna string vacio', () => {
    expect(normalizeText(null)).toBe('')
  })

  it('undefined retorna string vacio', () => {
    expect(normalizeText(undefined)).toBe('')
  })

  it('maneja multiples acentos', () => {
    expect(normalizeText('cóndición')).toBe('condicion')
  })
})

// ─── parseSearchTerms ───────────────────────────────────────────────────────

describe('parseSearchTerms', () => {
  it('query vacia retorna []', () => {
    expect(parseSearchTerms('')).toEqual([])
  })

  it('query null retorna []', () => {
    expect(parseSearchTerms(null)).toEqual([])
  })

  it('query con solo espacios retorna []', () => {
    expect(parseSearchTerms('   ')).toEqual([])
  })

  it('query con solo stopwords retorna []', () => {
    const result = parseSearchTerms('de la el')
    expect(result).toEqual([])
  })

  it('correccion de typo: "cavilla" expande a incluir "cabilla"', () => {
    const terms = parseSearchTerms('cavilla')
    const allVariants = terms[0]
    expect(allVariants).toContain('cabilla')
  })

  it('sinonimos: "varilla" expande a incluir "cabilla"', () => {
    const terms = parseSearchTerms('varilla')
    const allVariants = terms[0]
    expect(allVariants).toContain('cabilla')
  })

  it('fracciones multi-palabra: "tres octavos" → incluye "3/8"', () => {
    const terms = parseSearchTerms('tres octavos')
    const allVariantsFlat = terms.flat()
    expect(allVariantsFlat).toContain('3/8')
  })

  it('"aguas negras" → incluye "A/N"', () => {
    const terms = parseSearchTerms('aguas negras')
    const allVariantsFlat = terms.flat()
    expect(allVariantsFlat.some(v => v.toLowerCase() === 'a/n')).toBe(true)
  })

  it('deplural: "cabillas" expande a incluir "cabilla"', () => {
    const terms = parseSearchTerms('cabillas')
    const allVariants = terms[0]
    expect(allVariants).toContain('cabilla')
  })

  it('deplural -es: "conexiones" expande a incluir "conexion"', () => {
    const terms = parseSearchTerms('conexiones')
    const allVariants = terms[0]
    expect(allVariants).toContain('conexion')
  })

  it('multiples tokens generan multiples grupos', () => {
    const terms = parseSearchTerms('tubo galvanizado')
    expect(terms.length).toBe(2)
  })
})

// ─── smartMatch ─────────────────────────────────────────────────────────────

describe('smartMatch', () => {
  it('searchTerms vacio retorna true (match-all)', () => {
    expect(smartMatch('cualquier texto', [])).toBe(true)
  })

  it('searchTerms null retorna true', () => {
    expect(smartMatch('cualquier texto', null)).toBe(true)
  })

  it('match exacto funciona', () => {
    const terms = parseSearchTerms('tubo')
    expect(smartMatch('tubo galvanizado 1/2"', terms)).toBe(true)
  })

  it('no matchea si falta termino', () => {
    const terms = parseSearchTerms('tubo cobre')
    expect(smartMatch('tubo galvanizado', terms)).toBe(false)
  })

  it('match es case insensitive', () => {
    const terms = parseSearchTerms('TUBO')
    expect(smartMatch('Tubo Galvanizado', terms)).toBe(true)
  })
})

// ─── smartMatchScore ────────────────────────────────────────────────────────

describe('smartMatchScore', () => {
  it('searchTerms vacio retorna match true con score 0', () => {
    const r = smartMatchScore('texto', [])
    expect(r.match).toBe(true)
    expect(r.score).toBe(0)
  })

  it('match exacto de palabra da score positivo', () => {
    const terms = parseSearchTerms('cabilla')
    const r = smartMatchScore('cabilla estriada 3/8', terms)
    expect(r.match).toBe(true)
    expect(r.score).toBeGreaterThan(0)
  })

  it('sin match retorna match false', () => {
    const terms = parseSearchTerms('inexistente producto xyz')
    const r = smartMatchScore('cabilla estriada', terms)
    expect(r.match).toBe(false)
  })

  it('coverage < 50% retorna match false', () => {
    const terms = parseSearchTerms('cabilla galvanizada rectangular grande')
    const r = smartMatchScore('tornillo', terms)
    expect(r.match).toBe(false)
  })

  it('retorna coverage y matchedTerms', () => {
    const terms = parseSearchTerms('tubo galvanizado')
    const r = smartMatchScore('tubo galvanizado 1/2', terms)
    expect(r).toHaveProperty('coverage')
    expect(r).toHaveProperty('matchedTerms')
    expect(r.coverage).toBe(1) // 100% match
  })
})

// ─── smartMatchProducto ─────────────────────────────────────────────────────

describe('smartMatchProducto', () => {
  const producto = {
    nombre: 'Cabilla estriada 3/8"',
    codigo: 'CAB-001',
    categoria: 'Cabillas',
    descripcion: 'Cabilla de acero',
  }

  it('searchTerms vacio retorna true', () => {
    expect(smartMatchProducto(producto, [])).toBe(true)
  })

  it('match en nombre del producto', () => {
    const terms = parseSearchTerms('cabilla')
    expect(smartMatchProducto(producto, terms)).toBe(true)
  })

  it('match en codigo del producto', () => {
    const terms = parseSearchTerms('CAB-001')
    expect(smartMatchProducto(producto, terms)).toBe(true)
  })

  it('match en categoria del producto', () => {
    const terms = parseSearchTerms('cabillas')
    expect(smartMatchProducto(producto, terms)).toBe(true)
  })

  it('producto con campos null no crashea', () => {
    const prod = { nombre: null, codigo: null, categoria: null, descripcion: null }
    const terms = parseSearchTerms('tubo')
    expect(() => smartMatchProducto(prod, terms)).not.toThrow()
  })

  it('typo "cavilla" matchea producto "cabilla"', () => {
    const terms = parseSearchTerms('cavilla')
    expect(smartMatchProducto(producto, terms)).toBe(true)
  })
})

// ─── smartSearchProductos ───────────────────────────────────────────────────

describe('smartSearchProductos', () => {
  const productos = [
    { nombre: 'Cabilla estriada 3/8"', codigo: 'CAB-001', categoria: 'Cabillas', stock_actual: 100 },
    { nombre: 'Tubo galvanizado 1/2"', codigo: 'TUB-001', categoria: 'Tubos', stock_actual: 50 },
    { nombre: 'Cabilla estriada 1/2"', codigo: 'CAB-002', categoria: 'Cabillas', stock_actual: 200 },
    { nombre: 'Clavo de acero 3"', codigo: 'CLV-001', categoria: 'Clavos', stock_actual: 500 },
  ]

  it('query vacia retorna todos los productos', () => {
    const r = smartSearchProductos(productos, '')
    expect(r.length).toBe(4)
  })

  it('filtra productos que no matchean', () => {
    const r = smartSearchProductos(productos, 'cabilla')
    expect(r.every(p => p.nombre.toLowerCase().includes('cabilla'))).toBe(true)
  })

  it('ordena por coverage y score', () => {
    const r = smartSearchProductos(productos, 'cabilla 3/8')
    // El que tiene 3/8 deberia estar primero
    expect(r[0].codigo).toBe('CAB-001')
  })

  it('query sin resultados retorna array vacio', () => {
    const r = smartSearchProductos(productos, 'producto inexistente xyz123')
    expect(r.length).toBe(0)
  })
})

// ─── buildSmartFilter ───────────────────────────────────────────────────────

describe('buildSmartFilter', () => {
  it('query vacia retorna null', () => {
    expect(buildSmartFilter('')).toBeNull()
  })

  it('query null retorna null', () => {
    expect(buildSmartFilter(null)).toBeNull()
  })

  it('genera condiciones ilike para nombre y codigo', () => {
    const filters = buildSmartFilter('tubo')
    expect(filters).not.toBeNull()
    expect(filters.length).toBeGreaterThan(0)
    const firstFilter = filters[0]
    expect(firstFilter).toContain('nombre.ilike')
    expect(firstFilter).toContain('codigo.ilike')
  })

  it('genera un grupo de filtros por cada termino', () => {
    const filters = buildSmartFilter('tubo galvanizado')
    expect(filters.length).toBe(2)
  })
})
