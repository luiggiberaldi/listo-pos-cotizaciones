// src/utils/__tests__/donacionDevolucion.test.js
// OP-2026-054 (N2): la parte donada de lo devuelto no da crédito, salvo autorización.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fraccionDonada, valorDevolucionAcreditable } from '../donacionDevolucion.js'

const despachos = fs.readFileSync(new URL('../../../api/handlers/despachos.js', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../../components/despachos/DevolucionParcialModal.jsx', import.meta.url), 'utf8')

describe('fraccionDonada', () => {
  it('100 % donado, 0 % donado y a medias', () => {
    expect(fraccionDonada([{ metodo: 'Donación', monto: 1350 }])).toBe(1)
    expect(fraccionDonada([{ metodo: 'Cta por cobrar', monto: 634 }])).toBe(0)
    expect(fraccionDonada(JSON.stringify([{ metodo: 'Donación', monto: 317 }, { metodo: 'Zelle', monto: 317 }]))).toBe(0.5)
  })
  it('acepta "Donacion" sin acento, texto simple y datos dañados', () => {
    expect(fraccionDonada([{ metodo: 'donacion', monto: 10 }])).toBe(1)
    expect(fraccionDonada('Donación')).toBe(1)
    expect(fraccionDonada('[roto')).toBe(0)
    expect(fraccionDonada(null)).toBe(0)
  })
})

describe('valorDevolucionAcreditable', () => {
  it('Los Guayos #4211: devolver $450 donados → $0 de crédito', () => {
    expect(valorDevolucionAcreditable(450, [{ metodo: 'Donación', monto: 1350 }])).toEqual({ fraccion: 1, acreditable: 0, donado: 450 })
  })
  it('con autorización se acredita todo', () => {
    expect(valorDevolucionAcreditable(450, [{ metodo: 'Donación', monto: 1350 }], { autorizado: true })).toMatchObject({ acreditable: 450, donado: 0 })
  })
  it('a medias: solo la parte pagada da crédito', () => {
    expect(valorDevolucionAcreditable(17, [{ metodo: 'Donación', monto: 317 }, { metodo: 'Cta por cobrar', monto: 317 }])).toMatchObject({ acreditable: 8.5, donado: 8.5 })
  })
  it('sin donación no cambia nada', () => {
    expect(valorDevolucionAcreditable(340, [{ metodo: 'Zelle', monto: 634 }])).toEqual({ fraccion: 0, acreditable: 340, donado: 0 })
  })
})

describe('contratos (servidor y pantalla usan la misma regla)', () => {
  it('el servidor manda solo la parte acreditable y usa la función con donación', () => {
    expect(despachos).toContain("import { valorDevolucionAcreditable } from '../../src/utils/donacionDevolucion.js'")
    expect(despachos).toContain('p_total_devuelto_usd: totalAcreditableUsd')
    expect(despachos).toContain("'devolucion_con_donacion'")
  })
  it('autorizar crédito por lo donado exige rol y motivo', () => {
    expect(despachos).toContain('Solo administración, jefe o desarrollador pueden autorizar crédito por mercancía donada')
    expect(despachos).toContain('mínimo 10 caracteres')
  })
  it('la pantalla calcula el balance con la parte acreditable', () => {
    expect(modal).toContain('const balanceNetoUsd = Math.round((totalIntercambioUsd - totalAcreditableUsd) * 100) / 100')
    expect(modal).toContain('data-testid="devolucion-donacion"')
  })
})
