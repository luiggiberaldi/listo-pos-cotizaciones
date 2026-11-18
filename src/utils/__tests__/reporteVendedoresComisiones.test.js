import { describe, expect, it } from 'vitest'
import { construirComisionesGuardadas } from '../reporteVendedoresComisiones.js'

// Caso real del 18-nov-2026 (OP-2026-032), "Hoy" en producción.
const vendedores = {
  josue: { id: 'josue', nombre: 'Josué Marciales', rol: 'vendedor' },
  niki: { id: 'niki', nombre: 'Niki Ramírez', rol: 'supervisor' },
  wendy: { id: 'wendy', nombre: 'Wendy Lozano', rol: 'vendedor' },
  eiker: { id: 'eiker', nombre: 'Eiker Montaner', rol: 'vendedor' },
  edgar: { id: 'edgar', nombre: 'Edgar Ramírez', rol: 'vendedor' },
  empresa: { id: 'empresa', nombre: 'EMPRESA', rol: 'vendedor_sin_comision' },
}
const despachos = [
  { despacho_id: 'd4802', asesor_id: 'eiker', estado: 'entregada' },
  { despacho_id: 'd4803', asesor_id: 'josue', estado: 'entregada' }, // cliente de Niki
  { despacho_id: 'd4804', asesor_id: 'empresa', estado: 'entregada' },
  { despacho_id: 'd4805', asesor_id: 'josue', estado: 'entregada' },
  { despacho_id: 'd4806', asesor_id: 'eiker', estado: 'entregada' },
  { despacho_id: 'd4807', asesor_id: 'empresa', estado: 'entregada' },
  { despacho_id: 'd4808', asesor_id: 'wendy', estado: 'entregada', forma_pago_cliente: '[{"metodo":"Cobro a destino","monto":36,"cobro_destino_pagado":false}]' },
  { despacho_id: 'd4810', asesor_id: 'josue', estado: 'entregada' },
  { despacho_id: 'd4811', asesor_id: 'eiker', estado: 'entregada' },
  { despacho_id: 'd4812', asesor_id: 'edgar', estado: 'entregada' },
]
const guardadas = [
  { despachoid: 'd4802', vendedorid: 'eiker', totalcomision: '3.60', pctotros: 2 },
  { despachoid: 'd4803', vendedorid: 'niki', totalcomision: '5.19', pctotros: 2 },
  { despachoid: 'd4805', vendedorid: 'josue', totalcomision: '12.80', pctotros: 2 },
  { despachoid: 'd4806', vendedorid: 'eiker', totalcomision: '0.24', pctotros: 2 },
  { despachoid: 'd4810', vendedorid: 'josue', totalcomision: '1.07', pctotros: 2 },
  { despachoid: 'd4811', vendedorid: 'eiker', totalcomision: '1.22', pctotros: 2 },
  { despachoid: 'd4812', vendedorid: 'edgar', totalcomision: '0.58', pctotros: 2 },
]

function porVendedor(filas) {
  const out = {}
  for (const f of filas) out[f.vendedorid] = Math.round(((out[f.vendedorid] || 0) + f.totalcomision) * 100) / 100
  return out
}

describe('comisiones del Reporte de Vendedores (solo guardadas)', () => {
  const filas = construirComisionesGuardadas(despachos, guardadas, vendedores)

  it('no inventa comisión para Wendy (cobro a destino pendiente, cliente ajeno)', () => {
    expect(filas.some(f => f.vendedorid === 'wendy')).toBe(false)
  })

  it('no inventa comisión para despachos de EMPRESA', () => {
    expect(filas.some(f => f.despachoid === 'd4804' || f.despachoid === 'd4807')).toBe(false)
  })

  it('atribuye la comisión al dueño del cliente, no a quien vendió', () => {
    const d4803 = filas.find(f => f.despachoid === 'd4803')
    expect(d4803.vendedorid).toBe('niki')
    expect(d4803.vendedor.nombre).toBe('Niki Ramírez')
  })

  it('cuadra al centavo con Reportes → Comisiones ($24,70 en 7 despachos)', () => {
    expect(porVendedor(filas)).toEqual({ josue: 13.87, niki: 5.19, eiker: 5.06, edgar: 0.58 })
    const total = Math.round(filas.reduce((s, f) => s + f.totalcomision, 0) * 100) / 100
    expect(total).toBe(24.7)
    expect(new Set(filas.map(f => f.despachoid)).size).toBe(7)
  })

  it('ignora comisiones de despachos fuera del período', () => {
    const fuera = construirComisionesGuardadas(despachos, [...guardadas, { despachoid: 'otro', vendedorid: 'wendy', totalcomision: 9 }], vendedores)
    expect(fuera.some(f => f.vendedorid === 'wendy')).toBe(false)
  })

  it('marca filas de sábado (split) aparte', () => {
    const [f] = construirComisionesGuardadas([{ despacho_id: 'x', asesor_id: 'josue' }], [{ despachoid: 'x', vendedorid: 'niki', totalcomision: 1, tipo: 'cliente_ajeno_dueno' }], vendedores)
    expect(f.es_split).toBe(true)
  })
})
