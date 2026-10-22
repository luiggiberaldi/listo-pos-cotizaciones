import { afterEach, describe, expect, it, vi } from 'vitest'
import { calcularNetoTransportista, fetchTransportistaConfig } from '../transportistaUtils.js'

afterEach(() => vi.restoreAllMocks())

describe('calcularNetoTransportista', () => {
  it('calcula porcentaje sin exceder el flete', () => {
    expect(calcularNetoTransportista({ es_local: true, tipo_calculo: 'porcentaje', pct_comision: 80 }, 100))
      .toEqual({ neto: 80, pct_aplicado: 80 })
  })

  it('limita la tarifa fija al flete cobrado', () => {
    expect(calcularNetoTransportista({ es_local: true, tipo_calculo: 'fija', tarifa_fija_usd: 50 }, 25))
      .toEqual({ neto: 25, pct_aplicado: null })
  })

  it('rechaza fletes no numéricos o negativos', () => {
    expect(() => calcularNetoTransportista({ es_local: true }, 'abc')).toThrow('FLETE_INVALIDO')
    expect(() => calcularNetoTransportista({ es_local: true }, -1)).toThrow('FLETE_INVALIDO')
  })
})

describe('fetchTransportistaConfig', () => {
  it('exige cuenta y filtra transportista/configuración por la misma cuenta', async () => {
    const cuentaId = '11111111-1111-4111-8111-111111111111'
    const transportistaId = '22222222-2222-4222-8222-222222222222'
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      urls.push(String(url))
      if (String(url).includes('/transportistas?')) return new Response(JSON.stringify([{ es_local: true }]), { status: 200 })
      return new Response(JSON.stringify([{
        transp_tipo_calculo: 'porcentaje',
        transp_pct_comision: 80,
        transp_tarifa_fija_usd: 50,
      }]), { status: 200 })
    }))

    const result = await fetchTransportistaConfig(
      { SUPABASE_URL: 'https://example.supabase.co' },
      {},
      transportistaId,
      cuentaId,
    )

    expect(result.es_local).toBe(true)
    expect(urls.every(url => url.includes(`cuenta_id=eq.${cuentaId}`))).toBe(true)
  })

  it('no aplica configuración por defecto cuando Supabase falla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 503 })))
    await expect(fetchTransportistaConfig(
      { SUPABASE_URL: 'https://example.supabase.co' },
      {},
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    )).rejects.toThrow('TRANSPORTISTA_NO_DISPONIBLE')
  })
})

