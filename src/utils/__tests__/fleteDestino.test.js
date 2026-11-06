import { describe, expect, it } from 'vitest'
import { reglaEstadoDestinoFlete, requiereEstadoDestinoFlete, resolverEstadoDestinoFlete } from '../fleteDestino'

describe('requiereEstadoDestinoFlete', () => {
  it('exige estado solo con chofer local y flete mayor que 0', () => {
    expect(requiereEstadoDestinoFlete({ esLocal: true, fleteUsd: 50 })).toBe(true)
    expect(requiereEstadoDestinoFlete({ esLocal: true, fleteUsd: '12.5' })).toBe(true)
  })

  it('no exige estado sin chofer local, sin flete o con flete en 0', () => {
    expect(requiereEstadoDestinoFlete({ esLocal: false, fleteUsd: 50 })).toBe(false)
    expect(requiereEstadoDestinoFlete({ esLocal: true, fleteUsd: 0 })).toBe(false)
    expect(requiereEstadoDestinoFlete({ esLocal: true, fleteUsd: '' })).toBe(false)
    expect(requiereEstadoDestinoFlete({ esLocal: true, fleteUsd: null })).toBe(false)
    expect(requiereEstadoDestinoFlete({})).toBe(false)
  })
})

describe('resolverEstadoDestinoFlete', () => {
  it('el estado del envío tiene prioridad sobre el del cliente', () => {
    expect(resolverEstadoDestinoFlete({ estadoEnvio: 'Aragua', estadoCliente: 'Carabobo' })).toBe('Aragua')
  })

  it('usa el estado del cliente cuando el envío no trae estado', () => {
    expect(resolverEstadoDestinoFlete({ estadoEnvio: '', estadoCliente: 'Carabobo' })).toBe('Carabobo')
    expect(resolverEstadoDestinoFlete({ estadoEnvio: null, estadoCliente: 'Carabobo' })).toBe('Carabobo')
  })

  it('recorta espacios y devuelve vacío cuando no hay estado en ningún lado', () => {
    expect(resolverEstadoDestinoFlete({ estadoEnvio: '  Carabobo  ', estadoCliente: 'Aragua' })).toBe('Carabobo')
    expect(resolverEstadoDestinoFlete({ estadoEnvio: '   ', estadoCliente: '  ' })).toBe('')
    expect(resolverEstadoDestinoFlete()).toBe('')
  })
})

describe('reglaEstadoDestinoFlete (2026-10-26: el destino es el del cliente, sin respaldo)', () => {
  const base = { esLocal: true, fleteUsd: 10 }

  it('con cliente que tiene estado: usa el estado del cliente', () => {
    const r = reglaEstadoDestinoFlete({ ...base, estadoCliente: 'Carabobo' })
    expect(r.estadoDestino).toBe('Carabobo')
    expect(r.estadoEnvioEfectivo).toBe('')
    expect(r.valido).toBe(true)
  })

  it('un estado de envío oculto (sin dirección alternativa) NO pisa al estado del cliente', () => {
    const r = reglaEstadoDestinoFlete({ ...base, estadoEnvio: 'Aragua', estadoCliente: 'Carabobo' })
    expect(r.estadoDestino).toBe('Carabobo')
    expect(r.estadoEnvioEfectivo).toBe('')
  })

  it('con "enviar a otra dirección" el estado elegido SÍ viaja y manda', () => {
    const r = reglaEstadoDestinoFlete({ ...base, direccionEnvioActiva: true, estadoEnvio: 'Aragua', estadoCliente: 'Carabobo' })
    expect(r.estadoDestino).toBe('Aragua')
    expect(r.estadoEnvioEfectivo).toBe('Aragua')
    expect(r.valido).toBe(true)
  })

  it('con dirección alternativa sin estado todavía: bloquea (hay que elegirlo en su bloque)', () => {
    const r = reglaEstadoDestinoFlete({ ...base, direccionEnvioActiva: true, estadoEnvio: '', estadoCliente: 'Carabobo' })
    expect(r.valido).toBe(false)
  })

  it('cliente sin estado (ya no debería existir): bloquea; el respaldo se eliminó', () => {
    const r = reglaEstadoDestinoFlete({ ...base, estadoCliente: '' })
    expect(r.valido).toBe(false)
    expect(r.estadoDestino).toBe('')
    // El selector de respaldo ya no existe en la regla
    expect(r).not.toHaveProperty('mostrarSelector')
  })

  it('sin chofer local o sin flete: no requiere nada', () => {
    expect(reglaEstadoDestinoFlete({ esLocal: false, fleteUsd: 10, estadoCliente: '' }).valido).toBe(true)
    expect(reglaEstadoDestinoFlete({ esLocal: true, fleteUsd: 0, estadoCliente: '' }).valido).toBe(true)
  })
})
