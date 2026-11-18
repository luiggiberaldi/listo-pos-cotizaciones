import { describe, expect, it } from 'vitest'
import { destinoComision, textoDestinoComision } from '../destinoComision.js'

// Caso real OP-2026-032: Wendy vende a Jesus Enrique Chirino, cliente de Niki.
const wendy = { id: 'wendy', nombre: 'Wendy Lozano', rol: 'vendedor' }
const niki = { id: 'niki', nombre: 'Niki Ramírez', rol: 'supervisor' }
const empresa = { id: 'empresa', nombre: 'EMPRESA', rol: 'vendedor_sin_comision' }
const clienteDeNiki = { id: 'c1', nombre: 'Jesus Enrique Chirino', vendedor_id: 'niki', vendedor: niki }
const clienteDeWendy = { id: 'c2', nombre: 'Cliente propio', vendedor_id: 'wendy', vendedor: { id: 'wendy', nombre: 'Wendy Lozano' } }
const clienteEmpresa = { id: 'c3', nombre: 'Cliente casa', vendedor_id: 'empresa', vendedor: empresa }

describe('a quién le corresponde la comisión', () => {
  it('cliente de otro vendedor → la comisión es del dueño', () => {
    const d = destinoComision(clienteDeNiki, wendy)
    expect(d).toEqual({ tipo: 'ajeno', duenoNombre: 'Niki Ramírez' })
    expect(textoDestinoComision(d)).toBe('Comisión para Niki Ramírez (dueño del cliente)')
  })

  it('cliente propio → se muestra la comisión estimada normal', () => {
    const d = destinoComision(clienteDeWendy, wendy)
    expect(d.tipo).toBe('propio')
    expect(textoDestinoComision(d)).toBeNull()
  })

  it('cliente de EMPRESA → sin comisión para nadie', () => {
    const d = destinoComision(clienteEmpresa, wendy)
    expect(d.tipo).toBe('sin_comision')
    expect(textoDestinoComision(d)).toBe('Sin comisión (cliente de EMPRESA)')
  })

  it('cliente de un rol administrativo → sin comisión', () => {
    const d = destinoComision({ vendedor_id: 'j', vendedor: { id: 'j', nombre: 'Gabi', rol: 'jefe' } }, wendy)
    expect(d.tipo).toBe('sin_comision')
  })

  it('supervisor que vende a su propio cliente → propio', () => {
    expect(destinoComision(clienteDeNiki, niki).tipo).toBe('propio')
  })

  it('sin cliente elegido todavía → no cambia nada', () => {
    expect(destinoComision(null, wendy).tipo).toBe('propio')
    expect(destinoComision({ id: 'x' }, wendy).tipo).toBe('propio')
  })

  it('vendedor externo sin comisión con cliente propio → sí comisiona', () => {
    const ext = { id: 'e', nombre: 'Externo', rol: 'vendedor_sin_comision', es_externo: true }
    expect(destinoComision({ vendedor_id: 'e', vendedor: { id: 'e', nombre: 'Externo' } }, ext).tipo).toBe('propio')
  })
})
