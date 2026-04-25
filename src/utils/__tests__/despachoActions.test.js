import { describe, it, expect } from 'vitest'
import { getDespachoAction, ACCIONES, PRIMARY_ACTION_COLORS } from '../despachoActions'

describe('getDespachoAction', () => {
  it('supervisor ve "Aprobar despacho" para despachar', () => {
    const r = getDespachoAction('despachar', 'supervisor')
    expect(r.label).toBe('Aprobar despacho')
    expect(r.variant).toBe('success')
  })

  it('administracion ve "Aprobar despacho" para despachar', () => {
    const r = getDespachoAction('despachar', 'administracion')
    expect(r.label).toBe('Aprobar despacho')
  })

  it('logistica ve "Confirmar entrega" para entregar', () => {
    const r = getDespachoAction('entregar', 'logistica')
    expect(r.label).toBe('Confirmar entrega')
  })

  it('vendedor ve "Cancelar despacho" para anular', () => {
    const r = getDespachoAction('anular', 'vendedor')
    expect(r.label).toBe('Cancelar despacho')
    expect(r.variant).toBe('danger')
  })

  it('supervisor ve "Anular despacho" para anular', () => {
    const r = getDespachoAction('anular', 'supervisor')
    expect(r.label).toBe('Anular despacho')
  })

  it('retorna {} para accion inexistente', () => {
    expect(getDespachoAction('accion_falsa', 'vendedor')).toEqual({})
  })

  it('retorna default cuando existe para accion sin config de rol', () => {
    const r = getDespachoAction('pdf', 'vendedor')
    expect(r.label).toBe('Descargar PDF')
  })

  it('ver retorna default con label "Ver detalle"', () => {
    const r = getDespachoAction('ver', 'logistica')
    expect(r.label).toBe('Ver detalle')
  })

  it('PRIMARY_ACTION_COLORS tiene colores definidos', () => {
    expect(PRIMARY_ACTION_COLORS.despachar).toBeDefined()
    expect(PRIMARY_ACTION_COLORS.entregar.bg).toContain('emerald')
  })
})
