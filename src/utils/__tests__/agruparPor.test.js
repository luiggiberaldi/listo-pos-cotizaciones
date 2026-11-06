import { describe, it, expect } from 'vitest'
import { agruparPor } from '../agruparPor'

describe('agruparPor', () => {
  it('agrupa las filas por la clave y conserva el orden', () => {
    const m = agruparPor([{ d: 'a', n: 1 }, { d: 'b', n: 2 }, { d: 'a', n: 3 }], 'd')
    expect(m.get('a').map(x => x.n)).toEqual([1, 3])
    expect(m.get('b')).toHaveLength(1)
    expect(m.get('c')).toBeUndefined()
  })
  it('ignora filas sin clave y listas vacías o nulas', () => {
    expect(agruparPor([{ n: 1 }, { d: null }], 'd').size).toBe(0)
    expect(agruparPor(undefined, 'd').size).toBe(0)
  })
})
