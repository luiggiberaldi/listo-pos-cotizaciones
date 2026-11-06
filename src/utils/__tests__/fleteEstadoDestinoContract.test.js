// Contrato de fuente del arreglo del bloqueo del chofer local (regla 2026-10-25,
// actualizado 2026-10-26):
//  1. el destino es el ESTADO DEL CLIENTE registrado (estado/ciudad son
//     obligatorios al registrarlo); el selector de respaldo "Estado del destino"
//     se eliminó (2026-10-26): ya ningún cliente real queda sin estado — el
//     único registro sin estado era un fixture de pruebas, y el fixture ahora
//     crea sus clientes con estado y ciudad;
//  2. con "¿Enviar a otra dirección?" el estado de esa dirección manda;
//  3. los datos del cliente se refrescan al abrir cada modal (la lista trae una
//     copia de hasta 5 minutos que producía bloqueos fantasma);
//  4. "Despachar" desde el modal de "Cotización enviada exitosamente" envía el
//     cliente COMPLETO (id + estado/ciudad), no solo el nombre — esa era la
//     causa raíz del error solo en ese camino.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const leer = (rel) => fs.readFileSync(path.join(projectRoot, rel), 'utf8')

const cotizaciones = leer('src/views/CotizacionesView.jsx')
const cotizacionBuilder = leer('src/components/cotizaciones/CotizacionBuilder.jsx')
const ventaRapida = leer('src/views/VentaRapidaView.jsx')
const editarDespacho = leer('src/components/despachos/EditDespachoModal.jsx')
const cambiarTransp = leer('src/components/despachos/CambiarTransportistaModal.jsx')
const pdfs = [
  'src/services/pdf/despachoPDF.js',
  'src/services/pdf/ordenDespachoPDF.js',
  'src/services/pdf/guiaDespachoPDF.js',
  'src/services/pdf/facturaPDF.js',
].map(leer)

function verificarPantalla(nombre, fuente) {
  it(`${nombre}: refresca el cliente al abrir y aplica la regla compartida del destino`, () => {
    expect(fuente).toContain('useClienteFresco(')
    expect(fuente).toContain('reglaEstadoDestinoFlete({')
    expect(fuente).toContain('estadoCliente: clienteEnvio?.estado')
  })

  it(`${nombre}: sin selector de respaldo "Estado del destino" (eliminado 2026-10-26)`, () => {
    expect(fuente).not.toContain('mostrarSelectorEstadoDestino')
    expect(fuente).not.toContain('El cliente no tiene estado guardado: elige el estado del destino.')
  })

  it(`${nombre}: viaja estadoEnvioEfectivo (vacío = que el servidor use el estado del cliente)`, () => {
    expect(fuente).toContain('estadoEnvioEfectivo || null')
    expect(fuente).not.toContain('direccionEnvioActiva ? direccionEnvioEstado : null')
    expect(fuente).not.toContain('direccionEnvioEstado || null')
  })
}

describe('contrato del bloqueo del chofer local', () => {
  verificarPantalla('CotizacionesView (modal despachar)', cotizaciones)
  verificarPantalla('VentaRapidaView (pago/envío)', ventaRapida)
  verificarPantalla('EditDespachoModal', editarDespacho)

  it('CotizacionesView: refresca el cliente del despacho al abrir el modal', () => {
    expect(cotizaciones).toContain('useClienteFresco(cotizacion?.cliente_id')
  })

  it('VentaRapidaView: refresca el cliente al abrir el paso de pago/envío', () => {
    expect(ventaRapida).toContain('useClienteFresco(clienteId, step === 2)')
  })

  it('EditDespachoModal: el toggle de dirección ya no se fuerza con un estado solo', () => {
    expect(editarDespacho).toContain('const dirAct = !!(despacho.direccion_envio_direccion || despacho.direccion_envio_ciudad)')
    expect(editarDespacho).not.toContain('direccion_envio_direccion || despacho.direccion_envio_ciudad || despacho.direccion_envio_estado')
  })

  it('VentaRapidaView: un borrador con estado solo no fuerza el toggle de dirección', () => {
    expect(ventaRapida).not.toContain('else if (d.direccionEnvioEstado || d.direccionEnvioCiudad || d.direccionEnvioDireccion) setDireccionEnvioActiva(true)')
  })

  it('CotizacionBuilder: "Despachar" envía el cliente completo (id + estado/ciudad), no solo el nombre', () => {
    // Causa raíz del bloqueo desde "Cotización enviada exitosamente": el payload
    // solo traía { nombre }, el modal no tenía cliente_id y el refresco fallaba.
    expect(cotizacionBuilder).not.toContain('cliente: { nombre: clienteSeleccionado?.nombre }')
    expect(cotizacionBuilder).toContain('cliente_id: clienteId,')
    expect(cotizacionBuilder).toContain('estado: clienteSeleccionado?.estado,')
    expect(cotizacionBuilder).toContain('ciudad: clienteSeleccionado?.ciudad,')
  })

  it('CambiarTransportistaModal: refresca el cliente al abrir y solo rellena campos vacíos', () => {
    expect(cambiarTransp).toContain('useClienteFresco(despacho?.cliente_id')
    expect(cambiarTransp).toContain('setEstadoDestino(prev => prev ||')
  })

  it('PDFs: una dirección parcial no borra ciudad ni dirección del cliente', () => {
    for (const pdf of pdfs) {
      expect(pdf).toContain('direccion_envio_estado || cliente.estado')
      expect(pdf).toContain('direccion_envio_ciudad || cliente.ciudad')
      expect(pdf).toContain('direccion_envio_direccion || cliente.direccion')
    }
  })
})
