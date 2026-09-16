import { describe, expect, it } from 'vitest'
import { canOpenDashboard, dashboardIdentityMatches, getDashboardAccess, mayPersistQuery } from '../dashboardAccess.js'

describe('explicit home permission matrix', () => {
  it('allows company profit only for jefe', () => {
    expect(getDashboardAccess('jefe').profit).toBe(true)
    for (const role of ['supervisor', 'vendedor', 'vendedor_sin_comision', 'administracion', 'logistica', 'desarrollador', 'admin', '__proto__', null]) {
      expect(getDashboardAccess(role).profit).not.toBe(true)
    }
  })
  it('limits both seller aliases to own scope', () => {
    for (const role of ['vendedor', 'vendedor_sin_comision']) {
      expect(getDashboardAccess(role).scope).toBe('propio')
      expect(getDashboardAccess(role).team).not.toBe(true)
    }
  })
  it('grants supervisor seller breakdown, not company profit', () => {
    expect(getDashboardAccess('supervisor')).toMatchObject({ scope: 'equipo', team: true })
  })
  it('denies missing, unknown and inactive profiles', () => {
    expect(canOpenDashboard(null)).toBe(false)
    expect(canOpenDashboard({ id: '1', rol: 'admin' })).toBe(false)
    expect(canOpenDashboard({ id: '1', rol: 'jefe', activo: false })).toBe(false)
  })
  it('rejects cache entries from a different account, role, operator or session', () => {
    const identity = { accountId: 'account', operatorId: 'seller', rol: 'vendedor', sessionId: 'session' }
    const data = { schemaVersion: 1, identity, scope: 'propio' }
    expect(dashboardIdentityMatches(data, identity)).toBe(true)
    for (const key of Object.keys(identity)) expect(dashboardIdentityMatches(data, { ...identity, [key]: 'different' })).toBe(false)
    expect(dashboardIdentityMatches({ ...data, scope: 'empresa' }, identity)).toBe(false)
  })
  it.each(['dashboard_metrics', 'dashboard_metricas', 'comisiones', 'cuentas-cobrar', 'despachos', 'cotizaciones', 'clientes', 'usuarios'])('never persists private %s query', key => {
    expect(mayPersistQuery({ queryKey: [key], state: { status: 'success' } })).toBe(false)
  })
  it('honors sensitive metadata even for a new query key', () => {
    expect(mayPersistQuery({ queryKey: ['other'], meta: { sensitive: true }, state: { status: 'success' } })).toBe(false)
  })
})
