// src/utils/__tests__/consistencia057.test.js
// OP-2026-057: saldo por línea calculado al mostrar (M1), despachos con dos deudas (M3),
// lecturas por páginas (M7, M2) y fallos de recálculo anotados (M5).
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { saldosCorridos, saldoDeLinea } from '../cxcSaldos.js'
import { repartirCxC } from '../cxcReparto.js'
import { leerPaginado } from '../leerPaginado.js'

const hooks = fs.readFileSync(new URL('../../hooks/useCuentasCobrar.js', import.meta.url), 'utf8')
const cxcUtils = fs.readFileSync(new URL('../../../api/lib/cxcUtils.js', import.meta.url), 'utf8')
const migr = fs.readFileSync(new URL('../../../supabase/migrations/309_reparto_dos_deudas.sql', import.meta.url), 'utf8')

const t = (n) => `2026-11-0${n}T10:00:00Z`

describe('M1 — saldo de cada línea con los movimientos de hoy', () => {
  it('si se anula un abono viejo, las líneas siguientes muestran el saldo correcto', () => {
    const movs = [
      { id: 'c1', tipo: 'cargo', monto_usd: 100, creado_en: t(1), saldo_usd: 100 },
      // el abono de $40 del día 2 se anuló: ya no está en la lista
      { id: 'a2', tipo: 'abono', monto_usd: 10, creado_en: t(3), saldo_usd: 50 },   // saldo "foto" viejo: 50
    ]
    const mapa = saldosCorridos(movs)
    expect(saldoDeLinea(movs[1], mapa)).toBe(90)   // con lo que existe hoy: 100 − 10
  })
  it('saldo a favor en las líneas de crédito y consumo', () => {
    const movs = [
      { id: 'k1', tipo: 'credito', monto_usd: 50, creado_en: t(1) },
      { id: 'k2', tipo: 'consumo_credito', monto_usd: 20, creado_en: t(2) },
    ]
    const mapa = saldosCorridos(movs)
    expect(saldoDeLinea(movs[1], mapa)).toBe(30)
  })
})

describe('M3 — despacho con dos deudas', () => {
  it('un pago de cobro a destino paga primero la deuda de cobro a destino de su despacho', () => {
    const movs = [
      { id: 'cx', tipo: 'cargo', despacho_id: 'D', metodo_pago: 'cxc', monto_usd: 100, creado_en: t(1) },
      { id: 'cd', tipo: 'cargo', despacho_id: 'D', metodo_pago: 'cod', monto_usd: 50, creado_en: t(2) },
      { id: 'ab', tipo: 'abono', despacho_id: 'D', metodo_pago: 'cod', monto_usd: 50, creado_en: t(3) },
    ]
    const { cargos } = repartirCxC(movs)
    expect(cargos.find(c => c.id === 'cd').saldo_pendiente_cargo).toBe(0)
    expect(cargos.find(c => c.id === 'cx').saldo_pendiente_cargo).toBe(100)
  })
  it('lo que sobra paga la otra deuda del MISMO despacho antes que un despacho más viejo', () => {
    const movs = [
      { id: 'viejo', tipo: 'cargo', despacho_id: 'V', metodo_pago: 'cxc', monto_usd: 30, creado_en: t(1) },
      { id: 'cx', tipo: 'cargo', despacho_id: 'D', metodo_pago: 'cxc', monto_usd: 100, creado_en: t(2) },
      { id: 'cd', tipo: 'cargo', despacho_id: 'D', metodo_pago: 'cod', monto_usd: 50, creado_en: t(3) },
      { id: 'ab', tipo: 'abono', despacho_id: 'D', metodo_pago: 'cxc', monto_usd: 120, creado_en: t(4) },
    ]
    const { cargos } = repartirCxC(movs)
    expect(cargos.find(c => c.id === 'cx').saldo_pendiente_cargo).toBe(0)
    expect(cargos.find(c => c.id === 'cd').saldo_pendiente_cargo).toBe(30)
    expect(cargos.find(c => c.id === 'viejo').saldo_pendiente_cargo).toBe(30)
  })
  it('la base usa la misma regla (dos pasadas por despacho)', () => {
    expect(migr).toContain('for pasada in 1..2 loop')
  })
})

describe('M7 / M2 — lecturas por páginas', () => {
  it('leerPaginado junta todas las páginas', async () => {
    const datos = Array.from({ length: 2500 }, (_, i) => i)
    const construir = () => ({ range: async (a, b) => ({ data: datos.slice(a, b + 1), error: null }) })
    expect(await leerPaginado(construir)).toHaveLength(2500)
  })
  it('el historial de la ficha ya no se corta en 100', () => {
    expect(hooks).not.toContain('.limit(100)')
    expect(hooks.match(/leerPaginado\(/g).length).toBeGreaterThanOrEqual(5)
  })
})

describe('M5 — fallos de recálculo visibles', () => {
  it('se anotan en la auditoría', () => {
    expect(cxcUtils).toContain("accion: 'RECALCULO_SALDO_FALLIDO'")
  })
})
