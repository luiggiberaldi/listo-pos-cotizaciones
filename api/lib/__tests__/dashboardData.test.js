import { afterEach, describe, expect, it, vi } from 'vitest'
import { addPeriod, getDashboardPeriod, readAllRows } from '../dashboardData.js'

const env = { SUPABASE_URL: 'https://dashboard.test.invalid' }
afterEach(() => vi.unstubAllGlobals())

describe('complete dashboard reads', () => {
  it('reads beyond 1,000 rows even when the server caps pages below the requested size', async () => {
    const rows = Array.from({ length: 1207 }, (_, i) => ({ id: String(i) }))
    const fetchMock = vi.fn(async input => {
      const url = new URL(input)
      expect(url.origin).toBe(env.SUPABASE_URL)
      expect(url.searchParams.get('cuenta_id')).toBe('eq.account-test')
      expect(url.searchParams.get('order')).toBe('id.asc')
      const start = Number(url.searchParams.get('offset'))
      const batch = rows.slice(start, start + 97)
      return new Response(JSON.stringify(batch), { headers: { 'content-range': `${start}-${start + batch.length - 1}/${rows.length}` } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await readAllRows(env, {}, 'notas_despacho', new URLSearchParams({ cuenta_id: 'eq.account-test' }))
    expect(result).toEqual(rows)
    expect(fetchMock).toHaveBeenCalledTimes(13)
  })
  it('continues short pages until empty if no exact count is available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('[{"id":"1"}]')).mockResolvedValueOnce(new Response('[{"id":"2"}]')).mockResolvedValueOnce(new Response('[]')))
    expect(await readAllRows(env, {}, 'test', new URLSearchParams())).toHaveLength(2)
  })
  it('throws instead of returning a partially collected total on a later page error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('[{"id":"1"}]', { headers: { 'content-range': '0-0/2' } })).mockResolvedValueOnce(new Response('denied', { status: 403 })))
    await expect(readAllRows(env, {}, 'test', new URLSearchParams())).rejects.toThrow('HTTP 403')
  })
  it('rejects incomplete pagination', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { headers: { 'content-range': '*/12' } })))
    await expect(readAllRows(env, {}, 'test', new URLSearchParams())).rejects.toThrow('incompleta')
  })
  it('rejects a period above the bounded resource budget rather than truncating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { headers: { 'content-range': '*/51' } })))
    await expect(readAllRows(env, {}, 'test', new URLSearchParams(), { maxRows: 50 })).rejects.toThrow('límite')
  })
})

describe('Caracas periods and metric definitions', () => {
  it('uses Venezuela month rather than UTC at a month boundary', () => {
    const period = getDashboardPeriod('mes', new Date('2026-09-01T02:00:00Z'))
    expect(period.desde).toBe('2026-08-01T00:00:00-04:00')
    expect(period.hasta).toBe('2026-09-01T00:00:00-04:00')
  })
  it('crosses the year for previous month', () => {
    expect(getDashboardPeriod('anterior', new Date('2026-01-15T12:00:00Z')).desde).toBe('2025-12-01T00:00:00-04:00')
  })
  it('supports the current Caracas day with an exclusive next-day bound', () => {
    const period = getDashboardPeriod('hoy', new Date('2026-09-15T12:00:00Z'))
    expect(period).toMatchObject({ id: 'hoy', label: 'Hoy', desde: '2026-09-15T00:00:00-04:00', hasta: '2026-09-16T00:00:00-04:00' })
  })
  it('preserves both lower and exclusive upper bound for the same field', () => {
    const period = getDashboardPeriod('mes', new Date('2026-09-15T12:00:00Z'))
    const params = addPeriod(new URLSearchParams(), period)
    expect(params.getAll('creado_en')).toEqual(['gte.2026-09-01T00:00:00-04:00', 'lt.2026-10-01T00:00:00-04:00'])
  })
  it('requires an explicit supported period', () => {
    expect(() => getDashboardPeriod('rol=jefe')).toThrow()
  })
})
