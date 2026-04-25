import { describe, it, expect } from 'vitest'
import { getDespachoLabel, getCotizacionLabel, getFiltrosDespacho } from '../estadoLabels'

// ─── getDespachoLabel ───────────────────────────────────────────────────────

describe('getDespachoLabel', () => {
  it('vendedor ve "Esperando aprobación" para pendiente', () => {
    expect(getDespachoLabel('pendiente', 'vendedor')).toBe('Esperando aprobación')
  })

  it('supervisor ve "Por aprobar" para pendiente', () => {
    expect(getDespachoLabel('pendiente', 'supervisor')).toBe('Por aprobar')
  })

  it('administracion ve "Por aprobar" para pendiente', () => {
    expect(getDespachoLabel('pendiente', 'administracion')).toBe('Por aprobar')
  })

  it('logistica ve "Por entregar" para despachada', () => {
    expect(getDespachoLabel('despachada', 'logistica')).toBe('Por entregar')
  })

  it('vendedor ve "Aprobada" para despachada', () => {
    expect(getDespachoLabel('despachada', 'vendedor')).toBe('Aprobada')
  })

  it('todos ven "Entregada" para entregada', () => {
    expect(getDespachoLabel('entregada', 'vendedor')).toBe('Entregada')
    expect(getDespachoLabel('entregada', 'supervisor')).toBe('Entregada')
    expect(getDespachoLabel('entregada', 'logistica')).toBe('Entregada')
  })

  it('todos ven "Anulada" para anulada', () => {
    expect(getDespachoLabel('anulada', 'vendedor')).toBe('Anulada')
    expect(getDespachoLabel('anulada', 'supervisor')).toBe('Anulada')
  })

  it('rol desconocido usa fallback vendedor', () => {
    expect(getDespachoLabel('pendiente', 'rol_inexistente')).toBe('Esperando aprobación')
  })

  it('estado desconocido retorna el estado mismo', () => {
    expect(getDespachoLabel('estado_raro', 'vendedor')).toBe('estado_raro')
  })
})

// ─── getCotizacionLabel ─────────────────────────────────────────────────────

describe('getCotizacionLabel', () => {
  it('"borrador" → "Borrador"', () => {
    expect(getCotizacionLabel('borrador')).toBe('Borrador')
  })

  it('"enviada" → "Enviada"', () => {
    expect(getCotizacionLabel('enviada')).toBe('Enviada')
  })

  it('"rechazada" → "No aceptada"', () => {
    expect(getCotizacionLabel('rechazada')).toBe('No aceptada')
  })

  it('"anulada" → "Cancelada"', () => {
    expect(getCotizacionLabel('anulada')).toBe('Cancelada')
  })

  it('estado desconocido retorna el estado mismo', () => {
    expect(getCotizacionLabel('desconocido')).toBe('desconocido')
  })
})

// ─── getFiltrosDespacho ─────────────────────────────────────────────────────

describe('getFiltrosDespacho', () => {
  it('logistica solo ve 3 filtros (sin pendiente ni anulada)', () => {
    const filtros = getFiltrosDespacho('logistica')
    expect(filtros.length).toBe(3)
    expect(filtros.map(f => f.valor)).toEqual(['', 'despachada', 'entregada'])
  })

  it('vendedor ve 5 filtros', () => {
    const filtros = getFiltrosDespacho('vendedor')
    expect(filtros.length).toBe(5)
    expect(filtros.map(f => f.valor)).toEqual(['', 'pendiente', 'despachada', 'entregada', 'anulada'])
  })

  it('supervisor ve 5 filtros con labels contextualizados', () => {
    const filtros = getFiltrosDespacho('supervisor')
    expect(filtros.length).toBe(5)
    const pendiente = filtros.find(f => f.valor === 'pendiente')
    expect(pendiente.label).toBe('Por aprobar')
  })

  it('labels de logistica usan etiquetas correctas', () => {
    const filtros = getFiltrosDespacho('logistica')
    expect(filtros[1].label).toBe('Por entregar')
    expect(filtros[2].label).toBe('Entregadas')
  })
})
