import { describe, expect, it } from 'vitest'
import {
  STAGING_PROJECT_REF,
  STAGING_FRONTEND_ORIGIN,
  STAGING_WORKER_ORIGIN,
  assertStagingConfig,
  parseEnvFile,
  sanitize,
  selectCommissionSeller,
  commissionStateContract,
} from '../../../scripts/test-e2e-staging.mjs'

describe('test-e2e-staging configuration', () => {
  it('parses local env files without evaluating values', () => {
    expect(parseEnvFile('# comment\nKEY="value"\nEMPTY=\nNUMBER=42')).toEqual({
      KEY: 'value',
      EMPTY: '',
      NUMBER: '42',
    })
  })

  it('accepts only the staging Supabase project and fixed local ports', () => {
    expect(assertStagingConfig({
      supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co`,
      frontendOrigin: STAGING_FRONTEND_ORIGIN,
      workerOrigin: STAGING_WORKER_ORIGIN,
    }).projectRef).toBe(STAGING_PROJECT_REF)
  })

  it('rejects production project references and ambiguous ports', () => {
    expect(() => assertStagingConfig({
      supabaseUrl: 'https://oyfyuszgjwcepjpngclv.supabase.co',
      frontendOrigin: STAGING_FRONTEND_ORIGIN,
      workerOrigin: STAGING_WORKER_ORIGIN,
    })).toThrow(/Guardia staging/)
    expect(() => assertStagingConfig({
      supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co`,
      frontendOrigin: 'http://localhost:5173',
      workerOrigin: STAGING_WORKER_ORIGIN,
    })).toThrow(/5174/)
    expect(() => assertStagingConfig({
      supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co`,
      frontendOrigin: STAGING_FRONTEND_ORIGIN,
      workerOrigin: 'http://localhost:8787',
    })).toThrow(/8789/)
  })

  it('selects a real active seller for commission assertions', () => {
    expect(selectCommissionSeller([
      { id: 'b', nombre: 'Zeta', rol: 'vendedor', activo: true },
      { id: 'a', nombre: 'Alfa', rol: 'vendedor', activo: true },
      { id: 'c', nombre: 'Admin', rol: 'desarrollador', activo: true },
      { id: 'd', nombre: 'Inactivo', rol: 'vendedor', activo: false },
    ])).toEqual({ id: 'a', nombre: 'Alfa', rol: 'vendedor', activo: true })
    expect(selectCommissionSeller([{ id: 'x', nombre: 'Desarrollador', rol: 'desarrollador', activo: true }])).toBeNull()
  })

  it('models CxC commissions as retained until manual release', () => {
    expect(commissionStateContract({ comision_liberada: 0, comision_retenida: 6.9 })).toEqual({
      expectedState: 'cta_cobrar',
      requiresManualRelease: true,
      released: 0,
      retained: 6.9,
    })
    expect(commissionStateContract({ comision_liberada: 6.9, comision_retenida: 0 })).toEqual({
      expectedState: 'pendiente',
      requiresManualRelease: false,
      released: 6.9,
      retained: 0,
    })
  })

  it('removes credentials and hashes from diagnostic objects', () => {
    expect(sanitize({
      id: 'fixture-id',
      access_token: 'jwt',
      pin_hash: 'hash',
      nested: { password: 'secret', value: 20 },
    })).toEqual({ id: 'fixture-id', nested: { value: 20 } })
  })
})
