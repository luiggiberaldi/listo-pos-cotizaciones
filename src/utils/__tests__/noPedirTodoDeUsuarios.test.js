// La base de datos no deja leer pin_hash ni pin_salt de la tabla usuarios (migración 241).
// Pedir TODAS las columnas ("*") de usuarios hace que la base rechace el pedido completo
// ("permission denied for table usuarios"). Esta prueba impide volver a hacerlo.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const EXCLUIDAS = new Set(['__tests__', 'node_modules', 'backup'])

function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return EXCLUIDAS.has(d.name) ? [] : archivos(p)
    return /\.(js|jsx)$/.test(d.name) ? [p] : []
  })
}

const RELACION = /usuarios[^()\n]*\(\s*\*\s*\)/
const DIRECTA = /from\(\s*['"]usuarios['"]\s*\)\s*\.select\(\s*['"`]\*['"`]/
const REST = /rest\/v1\/usuarios\?[^'"`\n]*select=\*/

describe('lectura de la tabla usuarios', () => {
  it('ninguna consulta pide "*" de usuarios (ni directa ni como relación)', () => {
    const malos = []
    for (const f of [...archivos('src'), ...archivos('api')]) {
      const t = fs.readFileSync(f, 'utf8')
      if (RELACION.test(t)) malos.push(`${f}: relación usuarios(*)`)
      if (DIRECTA.test(t)) malos.push(`${f}: from('usuarios').select('*')`)
      if (REST.test(t)) malos.push(`${f}: usuarios?select=*`)
    }
    expect(malos).toEqual([])
  })

  it('la prueba sí detecta el patrón malo', () => {
    expect(RELACION.test('vendedor:usuarios!notas_despacho_vendedor_id_fkey(*),')).toBe(true)
    expect(RELACION.test('vendedor:usuarios!fk(id, nombre)')).toBe(false)
  })
})
