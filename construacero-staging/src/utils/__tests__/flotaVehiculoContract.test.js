// Contrato de fuente de la Fase 3 del plan de flota (pantallas):
//  1. el camión habitual del chofer local se AUTOCOMPLETA al elegir el chofer
//     en cada formulario de viaje (venta rápida, cotización, modal de despacho,
//     edición de despacho y cambio de chofer);
//  2. cambiar el camión SIN la casilla aplica solo a ese viaje y nunca toca la
//     ficha del chofer (raíl R12): los envíos mandan actualizarVehiculoHabitual
//     derivado únicamente de la casilla;
//  3. la casilla "Dejar este vehículo como el nuevo camión fijo de este chofer"
//     sí actualiza la ficha;
//  4. la franja "Vehículos de la Empresa" da de baja con la semántica exacta de
//     la Fase 1 (borrado sin historial, desactivación con historial);
//  5. el vehículo habitual solo se ofrece a choferes locales (R2).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const leer = (rel) => fs.readFileSync(path.join(projectRoot, rel), 'utf8')

const vehiculoViajeSelect = leer('src/components/vehiculos/VehiculoViajeSelect.jsx')
const vehiculosFranja = leer('src/components/transportistas/VehiculosFranja.jsx')
const formCompact = leer('src/components/transportistas/TransportistaFormCompact.jsx')
const transportistasView = leer('src/views/TransportistasView.jsx')
const ventaRapidaView = leer('src/views/VentaRapidaView.jsx')
const ventaRapidaHook = leer('src/hooks/useVentaRapida.js')
const cotizacionesView = leer('src/views/CotizacionesView.jsx')
const builder = leer('src/components/cotizaciones/CotizacionBuilder.jsx')
const editarDespacho = leer('src/components/despachos/EditDespachoModal.jsx')
const cambiarTransp = leer('src/components/despachos/CambiarTransportistaModal.jsx')
const useDespachos = leer('src/hooks/useDespachos.js')

describe('Vehículo por viaje — el camión habitual se autocompleta al elegir chofer', () => {
  it('cada formulario de viaje rellena vehiculo_habitual_id al seleccionar el chofer', () => {
    for (const fuente of [ventaRapidaView, cotizacionesView, editarDespacho, cambiarTransp]) {
      expect(fuente).toContain('vehiculo_habitual_id')
    }
  })

  it('solo los choferes locales muestran el selector de camión propio', () => {
    expect(vehiculoViajeSelect).toContain("if (!transportista?.es_local) return null")
    expect(vehiculoViajeSelect).toContain('es_local')
  })
})

describe('Cambio por viaje — sin la casilla nunca se toca la ficha del chofer', () => {
  it('la casilla existe y se llama "Dejar este vehículo como el nuevo camión fijo de este chofer"', () => {
    expect(vehiculoViajeSelect).toContain('Dejar este vehículo como el nuevo camión fijo de este chofer')
  })

  it('los envíos mandan actualizarVehiculoHabitual solo desde la casilla (default false)', () => {
    expect(ventaRapidaHook).toContain('actualizarVehiculoHabitual = false')
    expect(ventaRapidaHook).toContain('actualizarVehiculoHabitual: !!actualizarVehiculoHabitual')
    expect(useDespachos).toContain('actualizarVehiculoHabitual: !!actualizarVehiculoHabitual')
    // Venta rápida y modales de despacho derivan el flag del checkbox:
    expect(ventaRapidaView).toContain('actualizarVehiculoHabitual: fijarVehiculoFijo')
    expect(editarDespacho).toContain('actualizarVehiculoHabitual: fijarVehiculoFijo')
    expect(cambiarTransp).toContain('actualizarVehiculoHabitual: fijarVehiculoFijo')
  })

  it('el constructor de cotizaciones solo actualiza la ficha si la casilla está marcada', () => {
    expect(builder).toContain('if (!fijarVehiculoFijo || !transportistaId || !vehiculoViajeId) return')
    expect(builder).toContain("campos: { vehiculo_habitual_id: vehiculoViajeId }")
  })

  it('el vehículo del viaje viaja en los tres envíos (venta rápida, despacho y edición)', () => {
    expect(ventaRapidaHook).toContain('vehiculoId: vehiculoId || null')
    expect(useDespachos).toContain('vehiculoId: vehiculoId || null') // despachos/crear
    // Al editar solo se envía el camión si el usuario lo tocó (raíl R4): editar
    // el pago u otro dato nunca reescribe el camión guardado del viaje.
    for (const fuente of [editarDespacho, cambiarTransp]) {
      expect(fuente).toContain('vehiculoId: (vehiculoTocado || fijarVehiculoFijo) ? (vehiculoViajeId || null) : undefined')
    }
  })

  it('la lista de despachos trae el camión del viaje para precargar los modales', () => {
    expect(useDespachos).toContain('vehiculo_id, vehiculo_origen')
    expect(useDespachos).toContain('vehiculo_viaje:vehiculos!notas_despacho_vehiculo_id_fkey')
  })

  it('al despachar se precarga el camión elegido en la cotización', () => {
    expect(cotizacionesView).toContain('v === detalle?.transportista_id && detalle?.vehiculo_id')
  })
})

describe('Franja de vehículos — baja con la semántica de la Fase 1', () => {
  it('muestra el título y el filtro "Ver inactivos"', () => {
    expect(vehiculosFranja).toContain('Vehículos de la Empresa')
    expect(vehiculosFranja).toContain('Ver inactivos')
    expect(vehiculosFranja).toContain('Reactivar')
  })

  it('informa con los mensajes exactos según la baja sea física o lógica', () => {
    expect(vehiculosFranja).toContain('eliminado_fisico')
    expect(vehiculosFranja).toContain('Se eliminó por completo porque no tenía viajes asociados.')
    expect(vehiculosFranja).toContain('Se marcó como Inactivo: sus viajes pasados siguen intactos en los reportes.')
  })

  it('las altas y bajas pasan por los permisos de R13', () => {
    // Altas y bajas: jefe, administración, logística y desarrollador (logística da de baja desde 2026-10-30).
    expect(vehiculosFranja).toContain("const ROLES_GESTION = ['jefe', 'administracion', 'logistica', 'desarrollador']")
    expect(vehiculosFranja).toContain("const ROLES_BAJA = ['jefe', 'administracion', 'logistica', 'desarrollador']")
  })
})

describe('Fichas de choferes — vehículo habitual solo para locales', () => {
  it('ambos formularios de transportista envían vehiculo_habitual_id y lo descartan si no es local', () => {
    expect(formCompact).toContain('vehiculo_habitual_id: esLocal ? (vehiculoHabitualId || null) : null')
    expect(transportistasView).toContain("vehiculo_habitual_id: campos.es_local ? (vehiculoHabitualId || null) : null")
  })

  it('la tarjeta del chofer local muestra su etiqueta de vehículo fijo', () => {
    expect(transportistasView).toContain('Camión fijo')
    expect(transportistasView).toContain('vehiculo_habitual_id')
  })
})
