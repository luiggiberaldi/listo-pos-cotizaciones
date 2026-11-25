// OP-2026-070: reglas del vendedor al editar sus despachos que esperan aprobación
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  esRolVendedor, preciosPermitidos, revisarItemsVendedor, planDePagoSimple,
  revisarPagosVendedor, totalConItems, validarEdicionVendedor,
} from '../edicionVendedorDespacho.js'

const PROD = { id: 'p1', precio_usd: 10, precio_2: 9, precio_3: 8, precio2_habilitado: true, precio3_habilitado: false }
const opciones = { factorMarkup: 1, descPersonalPct: 10, esPersonal: false }

describe('quién es vendedor', () => {
  it('vendedor y vendedor sin comisión; no jefe ni administración', () => {
    expect(esRolVendedor('vendedor')).toBe(true)
    expect(esRolVendedor('vendedor_sin_comision')).toBe(true)
    expect(esRolVendedor('jefe')).toBe(false)
    expect(esRolVendedor('administracion')).toBe(false)
  })
})

describe('precios de lista permitidos', () => {
  it('P1 y P2 habilitados; P3 inhabilitado no cuenta', () => {
    expect(preciosPermitidos(PROD, opciones).sort()).toEqual([10, 9].sort())
  })
  it('con recargo de vendedor externo acepta el precio base y el recargado', () => {
    expect(preciosPermitidos({ precio_usd: 10 }, { factorMarkup: 1.05 })).toEqual(expect.arrayContaining([10, 10.5]))
  })
  it('cliente personal: también el precio con su descuento', () => {
    expect(preciosPermitidos({ precio_usd: 10 }, { esPersonal: true, descPersonalPct: 10 })).toEqual(expect.arrayContaining([10, 9]))
  })
})

describe('renglones del vendedor', () => {
  const actuales = [
    { producto_id: 'p1', nombre_snap: 'Cabilla', precio_unit_usd: 9.5, descuento_pct: 0, es_prestamo: false },
    { producto_id: null, nombre_snap: 'Flete especial', precio_unit_usd: 20, descuento_pct: 0, es_prestamo: false },
  ]
  const revisar = (items) => revisarItemsVendedor({ items, productosPorId: { p1: PROD }, itemsActuales: actuales, opcionesPrecio: opciones })

  it('acepta cambiar cantidad manteniendo el precio que ya tenía (aunque no sea de lista)', () => {
    expect(revisar([{ producto_id: 'p1', cantidad: 5, precio_unit_usd: 9.5 }])).toBeNull()
  })
  it('acepta un precio de lista (P2)', () => {
    expect(revisar([{ producto_id: 'p1', cantidad: 5, precio_unit_usd: 9 }])).toBeNull()
  })
  it('rechaza un precio inventado (bajar precio)', () => {
    expect(revisar([{ producto_id: 'p1', cantidad: 5, precio_unit_usd: 5 }])).toMatch(/precios de lista/)
  })
  it('rechaza el P3 inhabilitado', () => {
    expect(revisar([{ producto_id: 'p1', cantidad: 5, precio_unit_usd: 8 }])).toMatch(/precios de lista/)
  })
  it('deja el artículo externo que ya estaba, pero no uno nuevo ni con otro precio', () => {
    expect(revisar([{ producto_id: null, nombre_snap: 'Flete especial', cantidad: 1, precio_unit_usd: 20 }])).toBeNull()
    expect(revisar([{ producto_id: null, nombre_snap: 'Flete especial', cantidad: 1, precio_unit_usd: 5 }])).toMatch(/externos/)
    expect(revisar([{ producto_id: null, nombre_snap: 'Otro', cantidad: 1, precio_unit_usd: 20 }])).toMatch(/externos/)
  })
  it('no deja poner descuentos ni préstamos nuevos', () => {
    expect(revisar([{ producto_id: 'p1', cantidad: 1, precio_unit_usd: 10, descuento_pct: 5 }])).toMatch(/descuentos/)
    expect(revisar([{ producto_id: 'p1', cantidad: 1, precio_unit_usd: 10, es_prestamo: true }])).toMatch(/préstamos/)
  })
})

describe('pagos del vendedor', () => {
  const unMetodo = JSON.stringify([{ metodo: 'Efectivo $', monto: 100 }])
  const cod = JSON.stringify([{ metodo: 'Cobro a destino', monto: 100, metodo_propuesto: [{ metodo: 'Pago Móvil', monto: 100 }] }])
  const mixto = JSON.stringify([{ metodo: 'Efectivo $', monto: 50 }, { metodo: 'Zelle', monto: 50 }])

  it('plan simple: un solo método, o cobro en destino con un método; no mixtos ni saldo a favor', () => {
    expect(planDePagoSimple(unMetodo)).toBe(true)
    expect(planDePagoSimple(cod)).toBe(true)
    expect(planDePagoSimple(mixto)).toBe(false)
    expect(planDePagoSimple(JSON.stringify([{ metodo: 'Saldo a Favor', monto: 100 }]))).toBe(false)
    expect(planDePagoSimple('Efectivo')).toBe(true)
    expect(planDePagoSimple(null)).toBe(true)
  })
  it('sin pagos nuevos: nada que revisar', () => {
    expect(revisarPagosVendedor({ pagosNuevos: undefined, formaPagoActual: mixto, totalNuevo: 80 })).toBeNull()
  })
  it('mismo método con el nuevo total: permitido', () => {
    expect(revisarPagosVendedor({ pagosNuevos: JSON.stringify([{ metodo: 'Efectivo $', monto: 80 }]), formaPagoActual: unMetodo, totalNuevo: 80 })).toBeNull()
  })
  it('cambiar el método o un monto distinto al total: rechazado', () => {
    expect(revisarPagosVendedor({ pagosNuevos: JSON.stringify([{ metodo: 'Zelle', monto: 80 }]), formaPagoActual: unMetodo, totalNuevo: 80 })).toMatch(/método/)
    expect(revisarPagosVendedor({ pagosNuevos: JSON.stringify([{ metodo: 'Efectivo $', monto: 70 }]), formaPagoActual: unMetodo, totalNuevo: 80 })).toMatch(/nuevo total/)
  })
  it('pagos combinados: el vendedor no puede', () => {
    expect(revisarPagosVendedor({ pagosNuevos: JSON.stringify([{ metodo: 'Efectivo $', monto: 80 }]), formaPagoActual: mixto, totalNuevo: 80 })).toMatch(/administración/)
  })
  it('cobro en destino: misma propuesta con el nuevo total', () => {
    const ok = JSON.stringify([{ metodo: 'Cobro a destino', monto: 80, metodo_propuesto: [{ metodo: 'Pago Móvil', monto: 80 }] }])
    const otro = JSON.stringify([{ metodo: 'Cobro a destino', monto: 80, metodo_propuesto: [{ metodo: 'Zelle', monto: 80 }] }])
    expect(revisarPagosVendedor({ pagosNuevos: ok, formaPagoActual: cod, totalNuevo: 80 })).toBeNull()
    expect(revisarPagosVendedor({ pagosNuevos: otro, formaPagoActual: cod, totalNuevo: 80 })).toMatch(/destino/)
  })
  it('el total incluye flete y corte, sin préstamos', () => {
    expect(totalConItems([{ cantidad: 2, precio_unit_usd: 10 }, { cantidad: 1, precio_unit_usd: 99, es_prestamo: true }], { flete_usd: 5, corte_usd: 1, descuento_total_usd: 2 })).toBe(24)
  })
})

describe('validación completa (servidor)', () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co' }
  const operador = { id: 'v1', rol: 'vendedor', cuenta_id: 'c1' }
  const resp = (d) => new Response(JSON.stringify(d), { status: 200 })
  function simular(despacho) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (u.includes('/notas_despacho?')) return resp(despacho ? [despacho] : [])
      if (u.includes('/notas_despacho_items?')) return resp([{ producto_id: 'p1', nombre_snap: 'Cabilla', precio_unit_usd: 10, descuento_pct: 0 }])
      if (u.includes('/productos?')) return resp([PROD])
      if (u.includes('/configuracion_negocio?')) return resp([{ markup_pct_externo: 5, descuento_personal_pct: 10 }])
      if (u.includes('/clientes?')) return resp([{ tipo_cliente: 'empresa' }])
      if (u.includes('/usuarios?')) return resp([{ es_externo: false, markup_pct: 0 }])
      throw new Error('no esperada ' + u)
    }))
  }
  beforeEach(() => vi.unstubAllGlobals())
  const items = [{ producto_id: 'p1', cantidad: 3, precio_unit_usd: 10 }]

  it('jefe o administración: no aplica (sigue como siempre)', async () => {
    expect(await validarEdicionVendedor({ env, headers: {}, operador: { ...operador, rol: 'jefe' }, despachoId: 'd1', items })).toBeNull()
  })
  it('despacho de otro vendedor: prohibido', async () => {
    simular({ id: 'd1', estado: 'pendiente', vendedor_id: 'otro', forma_pago: null })
    expect((await validarEdicionVendedor({ env, headers: {}, operador, despachoId: 'd1', items }))?.status).toBe(403)
  })
  it('despacho ya aprobado: no puede', async () => {
    simular({ id: 'd1', estado: 'despachada', vendedor_id: 'v1', forma_pago: null })
    expect((await validarEdicionVendedor({ env, headers: {}, operador, despachoId: 'd1', items }))?.error).toMatch(/esperan aprobación/)
  })
  it('suyo, pendiente, precio de lista y pago que sigue al total: permitido', async () => {
    simular({ id: 'd1', estado: 'pendiente', vendedor_id: 'v1', forma_pago: JSON.stringify([{ metodo: 'Efectivo $', monto: 10 }]), flete_usd: 0, corte_usd: 0, descuento_total_usd: 0 })
    const pagos = JSON.stringify([{ metodo: 'Efectivo $', monto: 30 }])
    expect(await validarEdicionVendedor({ env, headers: {}, operador, despachoId: 'd1', items, pagos })).toBeNull()
  })
  it('no puede decidir sobre pagos ya hechos (destino de pagos)', async () => {
    expect((await validarEdicionVendedor({ env, headers: {}, operador, despachoId: 'd1', items, destinoPagos: 'saldo_favor' }))?.status).toBe(403)
  })
})
