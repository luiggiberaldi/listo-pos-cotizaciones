import { describe, it, expect } from 'vitest'
import { getAction, ACCIONES, PRIMARY_ACTION_COLORS } from '../cotizacionActions'

describe('getAction', () => {
  it('retorna config de vendedor cuando existe', () => {
    const r = getAction('anular', 'vendedor')
    expect(r.label).toBe('Cancelar')
    expect(r.variant).toBe('danger')
  })

  it('retorna config de supervisor cuando existe', () => {
    const r = getAction('anular', 'supervisor')
    expect(r.label).toBe('Anular cotización')
  })

  it('retorna default cuando rol no tiene config especifica', () => {
    const r = getAction('ver', 'vendedor')
    expect(r.label).toBe('Ver')
  })

  it('retorna {} para accion inexistente', () => {
    const r = getAction('accion_falsa', 'vendedor')
    expect(r).toEqual({})
  })

  it('accion "revisar" cambia label por rol', () => {
    expect(getAction('revisar', 'vendedor').label).toBe('Nueva versión')
    expect(getAction('revisar', 'supervisor').label).toBe('Revisar')
  })

  it('PRIMARY_ACTION_COLORS tiene colores para acciones conocidas', () => {
    expect(PRIMARY_ACTION_COLORS.editar).toBeDefined()
    expect(PRIMARY_ACTION_COLORS.editar.bg).toContain('bg-')
  })
})
