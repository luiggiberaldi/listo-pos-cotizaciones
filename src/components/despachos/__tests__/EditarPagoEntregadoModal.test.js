// src/components/despachos/__tests__/EditarPagoEntregadoModal.test.js
// Contratos de fuente del modal de corrección de pago entregado: guarda de campos
// permitidos, entrada COD intacta y el cuadre automático de CxC (abono o reversión
// en el mismo paso del guardado).
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(new URL('../EditarPagoEntregadoModal.jsx', import.meta.url), 'utf8')
const hooks = fs.readFileSync(new URL('../../../hooks/useCuentasCobrar.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../../../../worker.js', import.meta.url), 'utf8')
const cxcHandler = fs.readFileSync(new URL('../../../../api/handlers/cxc.js', import.meta.url), 'utf8')

describe('EditarPagoEntregadoModal — guardarraíles de la corrección', () => {
  it('solo envía los campos permitidos en la edición de pago entregado', () => {
    expect(source).toContain('soloPagoEntregado: true')
    expect(source).toContain('referenciaPago: referenciaPago.trim() || null')
    expect(source).not.toContain('transportistaId:')
    expect(source).not.toContain('fleteUsd:')
  })

  it('lee el estado real de CxC y mantiene la entrada COD intacta', () => {
    expect(source).toContain('/api/despachos/resumen-financiero')
    expect(source).toContain('deuda_cxc_usd')
    expect(source).toContain('[...pagos, ...codItems]')
    expect(source).toContain("const esCod = (f) => f?.metodo === 'Cobro a destino'")
  })

  it('no resetea el paso de cuadre cuando la lista de despachos se refresca', () => {
    expect(source).toContain("!(paso === 'cuadre' && mismoDespachoQueCargado)")
  })
})

describe('EditarPagoEntregadoModal — cuadre automático de CxC (paso 2)', () => {
  it('ofrece el cuadre solo cuando la corrección cambió la parte a crédito con deuda o cargo en libros', () => {
    expect(source).toContain('cambiaCxc && (cargoCxc > 0 || deudaCxc > 0)')
    expect(source).toContain("setPaso('cuadre')")
    expect(source).toContain('aria-label="Cuadre de cuentas por cobrar"')
    expect(source).toContain('La corrección dejó')
  })

  it('ofrece el abono y la reversión en lenguaje claro, con salida sin cuadrar', () => {
    expect(source).toContain('Registrar abono (el cliente pagó)')
    expect(source).toContain('Revertir el cargo (fue error de captura)')
    expect(source).toContain('Dejar para después')
    expect(source).toContain('Cuadre registrado')
  })

  it('el abono usa la clave de idempotencia estable por operación', () => {
    expect(source).toContain('idempotencyKey: abonoKey')
    expect(source).toContain('clienteId: cuadre.clienteId')
    expect(source).toContain('despachoId: despacho.id')
    expect(hooks).toContain("authFetch('/api/cxc/abono'")
    expect(hooks).toContain("...(idempotencyKey ? { idempotencyKey } : {})")
  })

  it('la reversión exige motivo y manda el monto objetivo al servidor', () => {
    expect(source).toContain('revertMotivo.trim().length >= 4')
    expect(source).toContain('montoNuevo: cuadreRevertMonto')
    expect(hooks).toContain("authFetch('/api/cxc/revertir-cargo'")
    expect(hooks).toContain('export function useRevertirCargoCxc()')
  })

  it('el servidor cablea la reversión con rol validado y bitácora', () => {
    expect(worker).toContain("'/api/cxc/revertir-cargo' && request.method === 'POST'")
    expect(worker).toContain('handleRevertirCargoCxc(request, env)')
    expect(cxcHandler).toContain("accion: 'REVERTIR_CARGO_CXC'")
    expect(cxcHandler).toContain("tipo=eq.cargo&metodo_pago=eq.cxc")
  })
})
