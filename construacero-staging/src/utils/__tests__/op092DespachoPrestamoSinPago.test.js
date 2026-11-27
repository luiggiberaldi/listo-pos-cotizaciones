// OP-2026-092 + OP-2026-095 Fase 4 — un despacho con total $0 no exige método de pago en ninguna pantalla.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const leer = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8')

describe('OP-2026-092 / OP-2026-095 despacho sin cobro en todas las pantallas', () => {
  const editarItems = leer('src/components/despachos/EditarItemsDespachoModal.jsx')
  const editarDesp = leer('src/components/despachos/EditDespachoModal.jsx')
  const cotizaciones = leer('src/views/CotizacionesView.jsx')
  const ventaRapida = leer('src/views/VentaRapidaView.jsx')
  const srv = leer('api/handlers/despachos.js')

  it('EditarItemsDespachoModal usa evaluarSinCobro, guarda pagos vacíos y ya no deja avisos viejos', () => {
    expect(editarItems).toContain('evaluarSinCobro({ esCod, total, items })')
    expect(editarItems).toContain(': (pagoInmediatoCuadrado || sinCobro)')
    expect(editarItems).toContain('JSON.stringify(totales.sinCobro ? [] : formasPagoFinales)')
    expect(editarItems).toContain('!totales.estaCuadrado')
    expect(editarItems).not.toContain('Lo prestado se factura después')
  })

  it('EditDespachoModal usa evaluarSinCobro y guarda sin pagos con total $0', () => {
    expect(editarDesp).toContain('evaluarSinCobro({ esCod, total: totalConFlete')
    expect(editarDesp).toContain('(pagoInmediatoCuadrado || sinCobro)')
    expect(editarDesp).toContain('JSON.stringify(sinCobro ? [] : formasPagoFinales)')
    expect(editarDesp).not.toContain('Lo prestado se factura después')
  })

  it('CotizacionesView y VentaRapidaView permiten crear despacho con total $0 sin método de pago', () => {
    expect(cotizaciones).toContain('evaluarSinCobro({ esCod, total: totalConFlete, items })')
    expect(cotizaciones).toContain('(pagoInmediatoCuadrado || sinCobro)')
    expect(cotizaciones).toContain('JSON.stringify(sinCobro ? [] : formasPagoFinales)')
    expect(ventaRapida).toContain('sinCobroVentaRapida')
  })

  it('editar el pago no borra la comisión sumada por un préstamo facturado', () => {
    expect(srv).toContain('cliente_prestamos?despacho_id=eq.${despachoId}&cantidad_facturada=gt.0')
    expect(srv).toContain('tienePrestamoFacturado && Array.isArray(comEntries)')
  })
})
