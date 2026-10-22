import { describe, it, expect } from 'vitest'

// Reglas y guardarraíles de Devoluciones y Reembolsos
describe('Guardarraíles Financieros: Devoluciones Parciales y Reembolsos', () => {
  const METODOS_REEMBOLSO = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT']
  const REFERENCIA_REQUERIDA_REEMBOLSO = ['Transf. / Pago Móvil', 'Zelle', 'USDT']

  function validarReembolso({ balanceNetoUsd, destinoSaldo, reembolsoMetodo, reembolsoReferencia }) {
    if (balanceNetoUsd >= 0) return true
    if (destinoSaldo !== 'reembolso') return true
    if (!reembolsoMetodo || !METODOS_REEMBOLSO.includes(reembolsoMetodo)) return false
    if (REFERENCIA_REQUERIDA_REEMBOLSO.includes(reembolsoMetodo)) {
      return String(reembolsoReferencia || '').trim().length > 0
    }
    return true
  }

  function calcularDistribucionFinancieraDevolucion({
    totalDevolverUsd,
    totalIntercambioUsd,
    despachoDeudaPendiente = 0,
    saldoFavorActual = 0,
    destinoSaldo = 'saldo_a_favor',
    reembolsoMetodo = 'Efectivo $'
  }) {
    const balanceNeto = Math.round((totalIntercambioUsd - totalDevolverUsd) * 100) / 100

    if (balanceNeto >= 0) {
      return {
        tipo: 'cobro_diferencia',
        cargoUsd: balanceNeto,
        abonoUsd: 0,
        creditoUsd: 0,
        reembolsoUsd: 0,
        nuevoSaldoFavor: saldoFavorActual
      }
    }

    const montoDevolucionAFavor = Math.abs(balanceNeto)

    // Guardarraíl 1: Amortizar deuda del despacho primero si tenía
    const abonoUsd = Math.min(montoDevolucionAFavor, Math.max(0, despachoDeudaPendiente))
    const excedente = Math.round((montoDevolucionAFavor - abonoUsd) * 100) / 100

    if (destinoSaldo === 'reembolso') {
      // Guardarraíl 2: Si se reembolsa en efectivo/banco, el saldo a favor del cliente NO aumenta
      return {
        tipo: 'reembolso',
        abonoUsd,
        creditoUsd: 0,
        reembolsoUsd: excedente,
        reembolsoMetodo,
        nuevoSaldoFavor: saldoFavorActual, // Queda idéntico, evita doble cobro
        egresoCajaUsd: excedente
      }
    } else {
      // Dejar como Saldo a Favor
      return {
        tipo: 'saldo_a_favor',
        abonoUsd,
        creditoUsd: excedente,
        reembolsoUsd: 0,
        reembolsoMetodo: null,
        nuevoSaldoFavor: Math.round((saldoFavorActual + excedente) * 100) / 100,
        egresoCajaUsd: 0
      }
    }
  }

  function validarReembolsoMultiMetodo({ balanceNetoUsd, destinoSaldo, pagosReembolso }) {
    if (balanceNetoUsd >= 0) return true
    if (destinoSaldo !== 'reembolso') return true
    if (!Array.isArray(pagosReembolso) || pagosReembolso.length === 0) return false

    const montoAFavor = Math.abs(balanceNetoUsd)
    const totalReembolsado = Math.round(pagosReembolso.reduce((s, p) => s + (Number(p.monto) || 0), 0) * 100) / 100

    if (totalReembolsado <= 0) return false
    if (totalReembolsado > montoAFavor + 0.011) return false

    const metodosUnicos = new Set(pagosReembolso.map(p => p.metodo)).size === pagosReembolso.length
    if (!metodosUnicos) return false

    return pagosReembolso.every(p => {
      if (!p.metodo || !METODOS_REEMBOLSO.includes(p.metodo)) return false
      const m = Number(p.monto)
      if (isNaN(m) || m <= 0) return false
      if (REFERENCIA_REQUERIDA_REEMBOLSO.includes(p.metodo)) {
        return String(p.referencia || '').trim().length > 0
      }
      return true
    })
  }

  function calcularDistribucionFinancieraDevolucionMultiMetodo({
    totalDevolverUsd,
    totalIntercambioUsd,
    despachoDeudaPendiente = 0,
    saldoFavorActual = 0,
    destinoSaldo = 'saldo_a_favor',
    pagosReembolso = []
  }) {
    const balanceNeto = Math.round((totalIntercambioUsd - totalDevolverUsd) * 100) / 100

    if (balanceNeto >= 0) {
      return {
        tipo: 'cobro_diferencia',
        cargoUsd: balanceNeto,
        abonoUsd: 0,
        creditoUsd: 0,
        totalReembolsoUsd: 0,
        remanenteSaldoFavorUsd: 0,
        nuevoSaldoFavor: saldoFavorActual,
        egresosPorMetodo: []
      }
    }

    const montoDevolucionAFavor = Math.abs(balanceNeto)

    // Guardarraíl 1: Amortizar deuda del despacho primero si tenía
    const abonoUsd = Math.min(montoDevolucionAFavor, Math.max(0, despachoDeudaPendiente))
    const excedenteCredito = Math.round((montoDevolucionAFavor - abonoUsd) * 100) / 100

    if (destinoSaldo === 'reembolso') {
      const sumaReembolsos = Math.round(
        pagosReembolso.reduce((s, p) => s + (Number(p.monto) || 0), 0) * 100
      ) / 100
      const totalReembolsoUsd = Math.min(sumaReembolsos, excedenteCredito)
      const remanenteSaldoFavor = Math.max(0, Math.round((excedenteCredito - totalReembolsoUsd) * 100) / 100)

      return {
        tipo: 'reembolso_multi_metodo',
        abonoUsd,
        creditoUsd: excedenteCredito, // Se acredita en CxC
        totalReembolsoUsd,
        remanenteSaldoFavorUsd: remanenteSaldoFavor,
        nuevoSaldoFavor: Math.round((saldoFavorActual + remanenteSaldoFavor) * 100) / 100,
        egresosPorMetodo: pagosReembolso.map(p => ({
          metodo: p.metodo,
          monto: Number(p.monto),
          referencia: p.referencia || null
        }))
      }
    } else {
      // Dejar 100% como Saldo a Favor
      return {
        tipo: 'saldo_a_favor',
        abonoUsd,
        creditoUsd: excedenteCredito,
        totalReembolsoUsd: 0,
        remanenteSaldoFavorUsd: excedenteCredito,
        nuevoSaldoFavor: Math.round((saldoFavorActual + excedenteCredito) * 100) / 100,
        egresosPorMetodo: []
      }
    }
  }

  describe('Validaciones de Formulario', () => {
    it('debe ser válido si el balance neto es favorable y el destino es Saldo a Favor', () => {
      const valido = validarReembolso({
        balanceNetoUsd: -25.20,
        destinoSaldo: 'saldo_a_favor'
      })
      expect(valido).toBe(true)
    })

    it('debe ser válido si es Reembolso en Efectivo $ sin referencia (referencia opcional)', () => {
      const valido = validarReembolso({
        balanceNetoUsd: -25.20,
        destinoSaldo: 'reembolso',
        reembolsoMetodo: 'Efectivo $',
        reembolsoReferencia: ''
      })
      expect(valido).toBe(true)
    })

    it('debe ser inválido si es Reembolso por Transferencia/Pago Móvil sin referencia', () => {
      const valido = validarReembolso({
        balanceNetoUsd: -25.20,
        destinoSaldo: 'reembolso',
        reembolsoMetodo: 'Transf. / Pago Móvil',
        reembolsoReferencia: '   '
      })
      expect(valido).toBe(false)
    })

    it('debe ser válido si es Reembolso por Transferencia con referencia', () => {
      const valido = validarReembolso({
        balanceNetoUsd: -25.20,
        destinoSaldo: 'reembolso',
        reembolsoMetodo: 'Transf. / Pago Móvil',
        reembolsoReferencia: 'REF-984321'
      })
      expect(valido).toBe(true)
    })

    it('Multi-Método: debe ser válido con Efectivo $ y Pago Móvil con referencia', () => {
      const valido = validarReembolsoMultiMetodo({
        balanceNetoUsd: -37.80,
        destinoSaldo: 'reembolso',
        pagosReembolso: [
          { metodo: 'Efectivo $', monto: 20.00, referencia: '' },
          { metodo: 'Transf. / Pago Móvil', monto: 17.80, referencia: 'REF-123456' }
        ]
      })
      expect(valido).toBe(true)
    })

    it('Multi-Método: debe ser inválido si algún método digital carece de referencia', () => {
      const valido = validarReembolsoMultiMetodo({
        balanceNetoUsd: -37.80,
        destinoSaldo: 'reembolso',
        pagosReembolso: [
          { metodo: 'Efectivo $', monto: 20.00, referencia: '' },
          { metodo: 'Transf. / Pago Móvil', monto: 17.80, referencia: '   ' }
        ]
      })
      expect(valido).toBe(false)
    })

    it('Multi-Método: debe ser inválido si la suma de reembolsos supera el saldo a favor', () => {
      const valido = validarReembolsoMultiMetodo({
        balanceNetoUsd: -37.80,
        destinoSaldo: 'reembolso',
        pagosReembolso: [
          { metodo: 'Efectivo $', monto: 25.00, referencia: '' },
          { metodo: 'Zelle', monto: 15.00, referencia: 'ZELLE-888' }
        ]
      })
      // 25 + 15 = 40 > 37.80 -> Inválido
      expect(valido).toBe(false)
    })

    it('Multi-Método: debe ser válido si es un reembolso parcial (menor al saldo a favor)', () => {
      const valido = validarReembolsoMultiMetodo({
        balanceNetoUsd: -37.80,
        destinoSaldo: 'reembolso',
        pagosReembolso: [
          { metodo: 'Efectivo $', monto: 20.00, referencia: '' }
        ]
      })
      // 20 <= 37.80 -> Válido (el resto queda como saldo a favor)
      expect(valido).toBe(true)
    })

    it('Multi-Método: debe ser inválido si se repite algún método de pago (Opción A)', () => {
      const valido = validarReembolsoMultiMetodo({
        balanceNetoUsd: -37.80,
        destinoSaldo: 'reembolso',
        pagosReembolso: [
          { metodo: 'Efectivo $', monto: 30.00, referencia: '' },
          { metodo: 'Efectivo $', monto: 7.80, referencia: '' }
        ]
      })
      expect(valido).toBe(false)
    })
  })

  describe('Cálculos Financieros y Guardarraíles Contables', () => {
    it('Caso A: Despacho 100% pagado, reembolso de $25.20 en Efectivo $', () => {
      const res = calcularDistribucionFinancieraDevolucion({
        totalDevolverUsd: 25.20,
        totalIntercambioUsd: 0,
        despachoDeudaPendiente: 0,
        saldoFavorActual: 50.00,
        destinoSaldo: 'reembolso',
        reembolsoMetodo: 'Efectivo $'
      })

      expect(res.abonoUsd).toBe(0)
      expect(res.reembolsoUsd).toBe(25.20)
      expect(res.egresoCajaUsd).toBe(25.20)
      // El saldo a favor del cliente NO aumenta a 75.20 porque ya se le dio el efectivo
      expect(res.nuevoSaldoFavor).toBe(50.00)
    })

    it('Caso B: Despacho 100% pagado, destino Saldo a Favor de $25.20', () => {
      const res = calcularDistribucionFinancieraDevolucion({
        totalDevolverUsd: 25.20,
        totalIntercambioUsd: 0,
        despachoDeudaPendiente: 0,
        saldoFavorActual: 50.00,
        destinoSaldo: 'saldo_a_favor'
      })

      expect(res.abonoUsd).toBe(0)
      expect(res.reembolsoUsd).toBe(0)
      expect(res.egresoCajaUsd).toBe(0)
      // El saldo a favor sí aumenta porque no se le entregó dinero físico
      expect(res.nuevoSaldoFavor).toBe(75.20)
    })

    it('Caso C: Despacho a crédito con $10 pendientes, devolución de $25.20 y reembolso del resto', () => {
      const res = calcularDistribucionFinancieraDevolucion({
        totalDevolverUsd: 25.20,
        totalIntercambioUsd: 0,
        despachoDeudaPendiente: 10.00,
        saldoFavorActual: 0,
        destinoSaldo: 'reembolso',
        reembolsoMetodo: 'Efectivo $'
      })

      // Primero se amortizan los $10 de deuda
      expect(res.abonoUsd).toBe(10.00)
      // Solo el excedente neto ($15.20) se entrega en efectivo
      expect(res.reembolsoUsd).toBe(15.20)
      expect(res.egresoCajaUsd).toBe(15.20)
      expect(res.nuevoSaldoFavor).toBe(0)
    })

    it('Caso D (Multi-Método Total): $37.80 reembolsado como $20 Efectivo + $17.80 Pago Móvil', () => {
      const res = calcularDistribucionFinancieraDevolucionMultiMetodo({
        totalDevolverUsd: 37.80,
        totalIntercambioUsd: 0,
        despachoDeudaPendiente: 0,
        saldoFavorActual: 10.00,
        destinoSaldo: 'reembolso',
        pagosReembolso: [
          { metodo: 'Efectivo $', monto: 20.00, referencia: null },
          { metodo: 'Transf. / Pago Móvil', monto: 17.80, referencia: 'REF-PM99' }
        ]
      })

      expect(res.abonoUsd).toBe(0)
      expect(res.totalReembolsoUsd).toBe(37.80)
      expect(res.remanenteSaldoFavorUsd).toBe(0)
      // Saldo a favor queda idéntico (10.00) porque se reembolsó el 100%
      expect(res.nuevoSaldoFavor).toBe(10.00)
      expect(res.egresosPorMetodo).toHaveLength(2)
      expect(res.egresosPorMetodo[0]).toEqual({ metodo: 'Efectivo $', monto: 20.00, referencia: null })
      expect(res.egresosPorMetodo[1]).toEqual({ metodo: 'Transf. / Pago Móvil', monto: 17.80, referencia: 'REF-PM99' })
    })

    it('Caso E (Multi-Método Mixto / Parcial): $37.80 de saldo, reembolsa $20 Efectivo y $17.80 a Saldo a Favor', () => {
      const res = calcularDistribucionFinancieraDevolucionMultiMetodo({
        totalDevolverUsd: 37.80,
        totalIntercambioUsd: 0,
        despachoDeudaPendiente: 0,
        saldoFavorActual: 10.00,
        destinoSaldo: 'reembolso',
        pagosReembolso: [
          { metodo: 'Efectivo $', monto: 20.00, referencia: null }
        ]
      })

      expect(res.abonoUsd).toBe(0)
      expect(res.totalReembolsoUsd).toBe(20.00)
      expect(res.remanenteSaldoFavorUsd).toBe(17.80)
      // Saldo a favor aumenta únicamente por el remanente no entregado en mano ($10.00 + $17.80 = $27.80)
      expect(res.nuevoSaldoFavor).toBe(27.80)
      expect(res.egresosPorMetodo).toHaveLength(1)
    })

    it('Caso F (Multi-Método con Amortización Previa): Despacho con $10 deuda, devolución $37.80, reembolso $27.80', () => {
      const res = calcularDistribucionFinancieraDevolucionMultiMetodo({
        totalDevolverUsd: 37.80,
        totalIntercambioUsd: 0,
        despachoDeudaPendiente: 10.00,
        saldoFavorActual: 0,
        destinoSaldo: 'reembolso',
        pagosReembolso: [
          { metodo: 'Efectivo $', monto: 15.00, referencia: null },
          { metodo: 'Zelle', monto: 12.80, referencia: 'ZEL-1122' }
        ]
      })

      // Primero se amortizan los $10 de deuda del despacho
      expect(res.abonoUsd).toBe(10.00)
      // Excedente para reembolso es $27.80
      expect(res.totalReembolsoUsd).toBe(27.80)
      expect(res.remanenteSaldoFavorUsd).toBe(0)
      expect(res.nuevoSaldoFavor).toBe(0)
      expect(res.egresosPorMetodo).toHaveLength(2)
    })
  })
})
