import { describe, expect, it } from 'vitest'
import { mensajesPendientes, pendientesSinAviso, recordarAvisadas, textoAvisoBuzon } from '../avisoBuzon.js'

const m = (id, extra = {}) => ({ id, estado: 'pendiente', tipo: 'sugerencia', mensaje: 'Hola', creado_en: `2026-11-0${id}T10:00:00Z`, usuario: { nombre: 'Josué' }, ...extra })

describe('aviso del Buzón', () => {
  it('solo cuenta los pendientes', () => {
    expect(mensajesPendientes([m(1), m(2, { estado: 'leido' }), m(3, { estado: 'resuelto' })]).map(x => x.id)).toEqual([1])
    expect(mensajesPendientes(null)).toEqual([])
  })

  it('avisa solo de lo que no se había avisado', () => {
    const pend = [m(1), m(2), m(3)]
    expect(pendientesSinAviso(pend, [1, 2]).map(x => x.id)).toEqual([3])
    expect(pendientesSinAviso(pend, []).map(x => x.id)).toEqual([1, 2, 3])
    expect(pendientesSinAviso(pend, undefined)).toHaveLength(3)
  })

  it('recuerda los avisados sin repetirlos ni crecer sin límite', () => {
    expect(recordarAvisadas([1, 2], [m(2), m(3)])).toEqual([1, 2, 3])
    const muchos = Array.from({ length: 300 }, (_, i) => `id${i}`)
    expect(recordarAvisadas(muchos, [])).toHaveLength(200)
  })

  it('un mensaje nuevo: título singular, quién lo dejó y el texto', () => {
    const t = textoAvisoBuzon([m(1)], [m(1, { mensaje: 'Agreguen un botón' })])
    expect(t.title).toBe('📬 Nuevo mensaje en el Buzón')
    expect(t.body).toBe('Sugerencia de Josué: "Agreguen un botón"')
    expect(t.urgente).toBe(false)
  })

  it('varios nuevos: cuenta, muestra el más reciente y los pendientes totales', () => {
    const nuevos = [m(1, { mensaje: 'vieja' }), m(3, { mensaje: 'la más reciente' })]
    const t = textoAvisoBuzon([m(1), m(2), m(3)], nuevos)
    expect(t.title).toBe('📬 2 mensajes nuevos en el Buzón')
    expect(t.body).toContain('la más reciente')
    expect(t.body).toContain('3 pendientes en total')
  })

  it('queja o error técnico es urgente; texto largo se acorta; sin nombre no falla', () => {
    const largo = 'x'.repeat(300)
    const t = textoAvisoBuzon([m(1)], [m(1, { tipo: 'error_tecnico', mensaje: largo, usuario: null })])
    expect(t.urgente).toBe(true)
    expect(t.body.startsWith('Error técnico de un operador: "')).toBe(true)
    expect(t.body.length).toBeLessThan(140)
  })

  it('sin nada nuevo no hay aviso', () => {
    expect(textoAvisoBuzon([m(1)], [])).toBeNull()
  })
})
