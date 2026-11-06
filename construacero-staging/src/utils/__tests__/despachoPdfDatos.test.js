import { describe, it, expect } from 'vitest'
import { combinarDespachoFresco, MENSAJE_SIN_LECTURA, SELECT_DESPACHO_PARA_PDF } from '../despachoPdfDatos'

const tarjeta = {
  id: 'd1', total_usd: 24875, forma_pago: [{ metodo: 'Cobro a destino', monto: 24875 }],
  cliente_id: 'c1', cliente: { id: 'c1', nombre: 'ALIRIO' },
  cliente_factura_id: null, cliente_factura: null,
  vendedor_id: 'v1', vendedor: { id: 'v1', nombre: 'NIKI', telefono: '0424' },
  transportista_id: 't1', transportista: { id: 't1', nombre: 'CHOFER VIEJO' },
}

describe('combinarDespachoFresco', () => {
  it('los montos y ids salen de la lectura fresca; lo enriquecido de la tarjeta se conserva', () => {
    const r = combinarDespachoFresco(tarjeta, {
      id: 'd1', total_usd: 24995, forma_pago: [{ metodo: 'Cobro a destino', monto: 24995 }],
      cliente_id: 'c1', vendedor_id: 'v1', cliente_factura_id: null, transportista_id: 't1',
      transportista: { id: 't1', nombre: 'CHOFER NUEVO' },
    })
    expect(r.total_usd).toBe(24995)
    expect(r.forma_pago[0].monto).toBe(24995)
    expect(r.vendedor.telefono).toBe('0424') // dato enriquecido: se conserva
    expect(r.cliente.nombre).toBe('ALIRIO')
  })

  it('el transportista viene de la lectura fresca (no queda el nombre viejo)', () => {
    const r = combinarDespachoFresco(tarjeta, {
      cliente_id: 'c1', vendedor_id: 'v1', transportista_id: 't2',
      transportista: { id: 't2', nombre: 'CHOFER NUEVO' },
    })
    expect(r.transportista.nombre).toBe('CHOFER NUEVO')
  })

  it('si quitaron el transportista, queda null (no el viejo)', () => {
    const r = combinarDespachoFresco(tarjeta, { cliente_id: 'c1', vendedor_id: 'v1', transportista_id: null, transportista: null })
    expect(r.transportista).toBeNull()
  })

  it('sin lectura fresca: no se imprime', () => {
    expect(() => combinarDespachoFresco(tarjeta, null)).toThrow(MENSAJE_SIN_LECTURA)
    expect(() => combinarDespachoFresco(tarjeta, undefined)).toThrow(MENSAJE_SIN_LECTURA)
  })

  it('si cambió el cliente o el vendedor, no se imprime con datos de la persona equivocada', () => {
    expect(() => combinarDespachoFresco(tarjeta, { cliente_id: 'c2', vendedor_id: 'v1' })).toThrow(/el cliente/)
    expect(() => combinarDespachoFresco(tarjeta, { cliente_id: 'c1', vendedor_id: 'v9' })).toThrow(/el vendedor/)
  })

  it('cliente de factura: solo se verifica si la tarjeta tenía uno', () => {
    const conFactura = { ...tarjeta, cliente_factura_id: 'f1', cliente_factura: { id: 'f1', nombre: 'EMPRESA' } }
    expect(() => combinarDespachoFresco(conFactura, { cliente_id: 'c1', vendedor_id: 'v1', cliente_factura_id: 'f2' })).toThrow(/factura/)
    expect(() => combinarDespachoFresco(tarjeta, { cliente_id: 'c1', vendedor_id: 'v1', cliente_factura_id: 'f2' })).not.toThrow()
  })

  it('objetos enriquecidos sin id no bloquean la impresión', () => {
    const sinId = { ...tarjeta, cliente: { nombre: 'ALIRIO' } }
    expect(() => combinarDespachoFresco(sinId, { cliente_id: 'c9', vendedor_id: 'v1' })).not.toThrow()
  })

  it('la consulta pide el transportista y el vehículo del viaje', () => {
    expect(SELECT_DESPACHO_PARA_PDF).toContain('transportista:transportistas!notas_despacho_transportista_id_fkey')
    expect(SELECT_DESPACHO_PARA_PDF).toContain('vehiculo_viaje:vehiculos!notas_despacho_vehiculo_id_fkey')
  })
})
