import { describe, it, expect } from 'vitest'
import {
  construirVentasDia, columnaDeMetodo, validarFechaVentasDia, numerosSinUsar,
  montoMostrado, montoFila, subtotalMostrado, fechaVenezuela, fmtDiaHora,
} from '../ventasDia.js'

const fp = arr => JSON.stringify(arr)
const DIA = '2026-10-24'
// Nota creada y entregada el 24-10 (hora de Venezuela) salvo que se indique otra cosa
const D = (numero, pagos, extra = {}) => ({
  id: `d${numero}`, numero, cliente_id: 'c1', estado: 'entregada',
  creado_en: '2026-10-24T14:00:00+00:00', entregada_en: '2026-10-24T14:30:00+00:00',
  total_usd: pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0),
  forma_pago: fp(pagos), ...extra,
})

describe('ventasDia: formas de pago y fechas', () => {
  it('clasifica cada forma de pago en su columna', () => {
    expect(columnaDeMetodo('Efectivo $')).toBe('efectivoUsd')
    expect(columnaDeMetodo('Efectivo Bs')).toBe('efectivoBs')
    expect(columnaDeMetodo('Transf. / Pago Móvil')).toBe('pagoMovil')
    expect(columnaDeMetodo('Punto de Venta')).toBe('punto')
    expect(columnaDeMetodo('Zelle')).toBe('zelle')
    expect(columnaDeMetodo('USDT')).toBe('usdt')
    expect(columnaDeMetodo('Cta por cobrar')).toBe('porCobrar')
    expect(columnaDeMetodo('Cobro a destino')).toBe('cobroDestino')
    expect(columnaDeMetodo('Donación')).toBe('otros')
  })

  it('valida la fecha y usa el día de Venezuela', () => {
    expect(validarFechaVentasDia(DIA)).toEqual({ fecha: DIA, desdeTs: '2026-10-24T00:00:00-04:00', hastaTs: '2026-10-25T00:00:00-04:00' })
    expect(validarFechaVentasDia('24-10-2026').error).toBeTruthy()
    expect(fechaVenezuela('2026-10-25T02:00:00Z')).toBe('2026-10-24')
    expect(fmtDiaHora('2026-10-24T13:34:00Z')).toBe('24/10 09:34')
    expect(fmtDiaHora(null)).toBeNull()
  })
})

describe('ventasDia: regla creadas Y entregadas el mismo día', () => {
  it('la hoja trae solo las creadas y entregadas ese día; el resto va aparte y no suma', () => {
    const despachos = [
      D(100, [{ metodo: 'Efectivo $', monto: 50 }]),
      D(101, [{ metodo: 'Punto de Venta', monto: 30 }]),
      // creada ese día, aún pendiente de aprobar
      D(102, [{ metodo: 'Zelle', monto: 40 }], { estado: 'pendiente', entregada_en: null }),
      // creada ese día, aprobada pero sin entregar
      D(103, [{ metodo: 'Zelle', monto: 25 }], { estado: 'despachada', entregada_en: null }),
      // creada ese día, entregada DESPUÉS (otro día)
      D(104, [{ metodo: 'Efectivo $', monto: 15 }], { entregada_en: '2026-10-26T15:00:00+00:00' }),
      // creada el viernes, entregada ese día
      D(99, [{ metodo: 'Efectivo $', monto: 70 }], { creado_en: '2026-10-23T14:00:00+00:00' }),
      // anulada ese día
      D(105, [{ metodo: 'Zelle', monto: 10 }], { estado: 'anulada', entregada_en: null }),
    ]
    const r = construirVentasDia({ fecha: DIA, despachos, clientes: [{ id: 'c1', nombre: 'Cliente' }] })
    expect(r.filas.map(f => f.numero)).toEqual([100, 101])
    expect(r.resumen.totalVendidoUsd).toBe(80)
    expect(r.resumen.efectivoUsdEsperado).toBe(50)
    expect(r.sinEntregar.map(f => [f.numero, f.estado])).toEqual([[102, 'pendiente'], [103, 'despachada'], [104, 'entregada']])
    expect(r.sinEntregar[2].entregadaEn).toBe('2026-10-26T15:00:00+00:00')
    expect(r.entregadasOtroDia.map(f => f.numero)).toEqual([99])
    expect(r.entregadasOtroDia[0].creadaEn).toBe('2026-10-23T14:00:00+00:00')
    expect(r.anuladas).toBe(1)
    // las notas "aparte" no suman
    expect(r.resumen.cobradoUsd).toBe(80)
  })

  it('una nota entregada con parte a crédito entra y esa parte suma a "por cobrar"', () => {
    const r = construirVentasDia({ fecha: DIA, despachos: [D(1, [{ metodo: 'Cta por cobrar', monto: 20, diasVencimiento: 10 }])] })
    expect(r.filas).toHaveLength(1)
    expect(r.resumen.porCobrarUsd).toBe(20)
    expect(r.resumen.cobradoUsd).toBe(0)
    expect(r.resumen.totalVendidoUsd).toBe(20)
    expect(r.filas[0].avisos).toEqual([])
  })

  it('cuenta los saltos del contador solo entre las notas creadas ese día', () => {
    expect(numerosSinUsar([{ numero: 100 }, { numero: 102 }, { numero: 105 }])).toEqual([101, 103, 104])
    const r = construirVentasDia({ fecha: DIA, despachos: [D(100, [{ metodo: 'Zelle', monto: 1 }]), D(103, [{ metodo: 'Zelle', monto: 1 }])] })
    expect(r.saltos).toBe(2)
    // una nota de otro día con número lejano no infla los saltos
    const r2 = construirVentasDia({ fecha: DIA, despachos: [D(100, [{ metodo: 'Zelle', monto: 1 }]), D(5, [{ metodo: 'Zelle', monto: 1 }], { creado_en: '2026-10-20T14:00:00Z' })] })
    expect(r2.saltos).toBe(0)
  })

  it('reproduce el 24-10-2026 real: 16 notas, efectivo 813,76 y por cobrar 20 en la 4270', () => {
    const t = (n, pagos) => D(n, pagos)
    const despachos = [
      t(4248, [{ metodo: 'Punto de Venta', monto: 20.9 }]),
      t(4251, [{ metodo: 'Efectivo $', monto: '41' }, { metodo: 'Efectivo Bs', monto: 0.29 }]),
      t(4252, [{ metodo: 'Efectivo $', monto: 499.8 }]),
      t(4255, [{ metodo: 'Punto de Venta', monto: 5 }]),
      t(4256, [{ metodo: 'Efectivo $', monto: 116.96 }]),
      t(4257, [{ metodo: 'Punto de Venta', monto: 106.83 }]),
      t(4259, [{ metodo: 'Efectivo $', monto: '51' }, { metodo: 'Efectivo Bs', monto: 1 }]),
      t(4260, [{ metodo: 'Punto de Venta', monto: 10 }]),
      t(4261, [{ metodo: 'Punto de Venta', monto: 119.9 }]),
      t(4262, [{ metodo: 'Punto de Venta', monto: 32.5 }]),
      t(4263, [{ metodo: 'Punto de Venta', monto: 13.99 }]),
      t(4264, [{ metodo: 'Punto de Venta', monto: 31 }]),
      t(4265, [{ metodo: 'Efectivo $', monto: '12' }, { metodo: 'Efectivo Bs', monto: 0.2 }]),
      t(4266, [{ metodo: 'Efectivo $', monto: 13 }]),
      t(4268, [{ metodo: 'Efectivo $', monto: '80' }, { metodo: 'Efectivo Bs', monto: 0.6 }]),
      t(4270, [{ metodo: 'Cta por cobrar', monto: 20, diasVencimiento: 10 }]),
      // la 4269 es del 26-10: no entra
      D(4269, [{ metodo: 'Efectivo $', monto: 471 }], { creado_en: '2026-10-26T17:00:00Z', entregada_en: '2026-10-26T17:56:00Z' }),
    ]
    const r = construirVentasDia({ fecha: DIA, despachos })
    expect(r.filas).toHaveLength(16)
    expect(r.resumen.efectivoUsdEsperado).toBe(813.76)
    expect(r.resumen.porCobrarUsd).toBe(20)
    expect(r.resumen.totalVendidoUsd).toBe(1175.97)
    expect(r.filas.find(f => f.numero === 4270).montos.porCobrar).toBe(20)
    expect(r.filas.find(f => f.numero === 4268).montos.porCobrar).toBe(0)
    expect(r.sinEntregar).toEqual([])
    expect(r.entregadasOtroDia).toEqual([])
    // bolívares con la tasa del día (1.012): el punto de venta de la 4248 son 21.150,80 Bs
    expect(montoFila(r.filas[0], 'punto', 1012)).toBe(21150.8)
    expect(r.columnasUsadas).toEqual(['efectivoUsd', 'efectivoBs', 'punto', 'porCobrar'])
  })

  it('junta las referencias y avisa si no hay pago o no cuadra', () => {
    const r = construirVentasDia({
      fecha: DIA,
      despachos: [
        { ...D(1, [{ metodo: 'Transf. / Pago Móvil', monto: 50, referencia: ' 123456 ' }]), referencia_pago: '999' },
        D(2, [{ metodo: 'Efectivo $', monto: 40 }], { total_usd: 50 }),
        D(3, [{ metodo: 'Efectivo $', monto: 0 }], { total_usd: 25 }),
      ],
    })
    expect(r.filas[0].referencias).toEqual(['123456', '999'])
    expect(r.filas[1].avisos[0]).toMatch(/no cuadran/)
    expect(r.filas[2].avisos).toContain('Sin pago registrado')
  })

  it('bolívares: usa monto_bs si el pago lo trae y la tasa si no', () => {
    const r = construirVentasDia({
      fecha: DIA,
      despachos: [
        D(1, [{ metodo: 'Transf. / Pago Móvil', monto: 0.99, monto_bs: 1000 }]),
        D(2, [{ metodo: 'Transf. / Pago Móvil', monto: 1 }]),
      ],
    })
    expect(montoFila(r.filas[0], 'pagoMovil', 1012)).toBe(1000)
    expect(montoFila(r.filas[1], 'pagoMovil', 1012)).toBe(1012)
    expect(subtotalMostrado(r, 'pagoMovil', 1012)).toBe(2012)
    expect(subtotalMostrado(r, 'pagoMovil', 0)).toBeNull()
    expect(montoMostrado('efectivoUsd', 10, 0)).toBe(10)
  })
})
