import { describe, it, expect } from 'vitest'
import { isSameOriginRequest } from '../utils.js'

const req = (origin, url = 'https://api.ejemplo.test/api/despachos/crear') => {
  const headers = new Headers()
  if (origin !== undefined) headers.set('Origin', origin)
  return new Request(url, { method: 'POST', headers })
}

describe('isSameOriginRequest', () => {
  it('permite peticiones sin cabecera Origin (clientes no navegador)', () => {
    expect(isSameOriginRequest(req(undefined))).toBe(true)
  })
  it('permite el origen propio de la petición', () => {
    expect(isSameOriginRequest(req('https://api.ejemplo.test'))).toBe(true)
  })
  it('permite orígenes de ALLOWED_ORIGINS', () => {
    expect(isSameOriginRequest(req('http://localhost:5173'))).toBe(true)
    expect(isSameOriginRequest(req('https://listo-pos-cotizaciones.vercel.app'))).toBe(true)
  })
  it('rechaza un origen cross-site ajeno', () => {
    expect(isSameOriginRequest(req('https://evil.example'))).toBe(false)
  })
  it('rechaza un origen que solo comparte prefijo', () => {
    expect(isSameOriginRequest(req('https://api.ejemplo.test.evil.example'))).toBe(false)
  })
})
