// Copia para el árbol principal (producción): lee el SQL del paquete supabase/release/main.
// Contrato de la Fase 4 del plan de flota (reportes y documentos):
//  - la migración 283 usa creado_en, define vehiculo_origen y calcula la
//    mercancía como total − flete − corte (raíl R7);
//  - el reporte suma la comisión GUARDADA en cada viaje (R6);
//  - lo estimado se marca con ≈ (R5);
//  - los PDFs de despacho imprimen el camión del viaje, no el de la ficha;
//  - dos choferes rotando camiones se reflejan correctamente en los totales (R12).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  textoViajes, totalesVehiculos, totalesChoferes, construirCsvFlota,
  textoDesgloseChoferes, textoDesgloseVehiculos, repartoFlete,
  periodoAnterior, diasDelPeriodo, variacion, porcentaje,
} from '../flotaReporte'
import { datosVehiculoImpreso, nombreVehiculo } from '../vehiculoImpreso'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const leer = (rel) => fs.readFileSync(path.join(projectRoot, rel), 'utf8')
const migracion = leer('supabase/release/main/283_flota_vehiculos_locales_apply.sql')

describe('RPC obtener_reporte_flota_y_choferes — métricas congeladas (R6/R7)', () => {
  it('filtra por creado_en y nunca por created_at', () => {
    expect(migracion).toContain('nd.creado_en >= p_fecha_inicio')
    // Fuera de los comentarios (el encabezado menciona created_at para aclarar).
    const sinComentarios = migracion.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(sinComentarios).not.toMatch(/\bcreated_at\b/)
  })

  it('define vehiculo_origen con los tres orígenes permitidos', () => {
    expect(migracion).toContain("CHECK (vehiculo_origen IN ('manual', 'auto_habitual', 'backfill'))")
  })

  it('mercancía = total − flete − corte (no infla con el flete)', () => {
    expect(migracion).toContain('SUM(nd.total_usd - nd.flete_usd - nd.corte_usd)')
  })

  it('la comisión se lee del neto guardado en cada viaje, sin recalcular', () => {
    expect(migracion).toContain('SUM(nd.flete_neto_transportista_usd)')
    expect(migracion).not.toMatch(/configuracion_negocio/)
  })

  it('solo cuenta viajes despachados o entregados', () => {
    expect(migracion).toContain("nd.estado IN ('despachada', 'entregada')")
  })
})

describe('Permisos de la tabla vehiculos (arreglo 284)', () => {
  it('producción otorga CRUD al Worker y solo lectura al navegador', () => {
    const m284 = leer('supabase/release/main/283_flota_vehiculos_locales_apply.sql')
    expect(m284).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehiculos TO service_role')
    expect(m284).toContain('GRANT SELECT ON public.vehiculos TO authenticated')
    expect(m284).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO authenticated/)
  })

  it('el paquete de producción ya trae los permisos (no repite el error de staging)', () => {
    const apply = leer('supabase/release/main/283_flota_vehiculos_locales_apply.sql')
    expect(apply).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehiculos TO service_role')
    expect(apply).toContain('GRANT SELECT ON public.vehiculos TO authenticated')
  })
})

// Escenario del raíl R12: Juan y Pedro rotan entre CAM-01 y CAM-02.
const porVehiculo = [
  {
    vehiculo_id: 'v1', codigo: 'CAM-01', nombre: 'NPR', placa: 'A12BC3D', activo: true,
    total_viajes: 17, viajes_estimados: 2, total_flete_usd: 850, total_mercancia_usd: 12000, promedio_flete_viaje_usd: 50,
    desglose_choferes: [
      { transportista_id: 'j', chofer_nombre: 'Juan', viajes: 14, flete_usd: 700 },
      { transportista_id: 'p', chofer_nombre: 'Pedro', viajes: 3, flete_usd: 150 },
    ],
  },
  {
    vehiculo_id: 'v2', codigo: 'CAM-02', nombre: 'Cargo', placa: 'B34CD5E', activo: true,
    total_viajes: 4, viajes_estimados: 0, total_flete_usd: 220, total_mercancia_usd: 3000, promedio_flete_viaje_usd: 55,
    desglose_choferes: [{ transportista_id: 'j', chofer_nombre: 'Juan', viajes: 4, flete_usd: 220 }],
  },
]
const porChofer = [
  {
    transportista_id: 'j', chofer_nombre: 'Juan', activo: true, total_viajes: 18, viajes_en_carabobo: 10, viajes_fuera_carabobo: 8,
    total_flete_usd: 920, total_mercancia_usd: 13000, comision_generada_usd: 300, comision_pagada_usd: 200, comision_pendiente_usd: 100,
    viajes_estimados: 2,
    desglose_vehiculos: [
      { vehiculo_id: 'v1', vehiculo_nombre: 'NPR', placa: 'A12BC3D', viajes: 14, flete_usd: 700 },
      { vehiculo_id: 'v2', vehiculo_nombre: 'Cargo', placa: 'B34CD5E', viajes: 4, flete_usd: 220 },
    ],
  },
  {
    transportista_id: 'p', chofer_nombre: 'Pedro', activo: true, total_viajes: 3, viajes_en_carabobo: 3, viajes_fuera_carabobo: 0,
    total_flete_usd: 150, total_mercancia_usd: 2000, comision_generada_usd: 0, comision_pagada_usd: 0, comision_pendiente_usd: 0,
    viajes_estimados: 0,
    desglose_vehiculos: [{ vehiculo_id: 'v1', vehiculo_nombre: 'NPR', placa: 'A12BC3D', viajes: 3, flete_usd: 150 }],
  },
]

describe('Reporte con dos choferes rotando camiones (R12)', () => {
  it('los totales por vehículo y por chofer cuadran entre sí', () => {
    const tv = totalesVehiculos(porVehiculo)
    const tc = totalesChoferes(porChofer)
    expect(tv.viajes).toBe(21)
    expect(tc.viajes).toBe(21)
    expect(tv.flete).toBe(1070)
    expect(tc.flete).toBe(1070)
    expect(tc.comisionGenerada).toBe(tc.comisionPagada + tc.comisionPendiente)
  })

  it('los desgloses nombran a cada chofer y cada camión', () => {
    expect(textoDesgloseChoferes(porVehiculo[0].desglose_choferes)).toBe('Juan: 14 viajes / Pedro: 3 viajes')
    expect(textoDesgloseVehiculos(porChofer[0].desglose_vehiculos))
      .toBe('NPR (A12BC3D): 14 viajes ($700.00) | Cargo (B34CD5E): 4 viajes ($220.00)')
  })

  it('los viajes estimados se marcan con ≈ y los reales no (R5)', () => {
    expect(textoViajes(porVehiculo[0])).toBe('17 (≈2)')
    expect(textoViajes(porVehiculo[1])).toBe('4')
  })

  it('el Excel trae ambos cuadros, coma decimal y la nota de ≈', () => {
    const csv = construirCsvFlota({ porVehiculo, porChofer, desde: '2026-10-01', hasta: '2026-10-31' })
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv).toContain('Cuadro 1 - Productividad por vehiculo')
    expect(csv).toContain('Cuadro 2 - Productividad por chofer local')
    // Codigo;Vehiculo;Modelo;Placa chuto;Placa batea;Activo;Viajes;% del total;Dias;Estimados;Fletes;...
    expect(csv).toContain('CAM-01;NPR;;A12BC3D;;Si;17;81;0;2;850,00;')
    expect(csv).toContain('Juan: 14 viajes / Pedro: 3 viajes')
    expect(csv).not.toMatch(/pagada|pendiente/i)
    expect(csv).toContain('≈ = viajes viejos')
  })
})

describe('Documentos impresos con el camión del viaje (arreglo 11)', () => {
  const chofer = { vehiculo: 'NPR viejo', placa_chuto: 'A12BC3D', placa_batea: 'X99', color_batea: 'Azul', vehiculo_habitual_id: 'v1' }

  it('si el viaje salió en otro camión, imprime ese camión y no la batea de la ficha', () => {
    const d = datosVehiculoImpreso({
      transportista: chofer,
      vehiculo_viaje: { id: 'v2', codigo: 'CAM-02', nombre: 'Cargo', placa: 'B34CD5E', color_batea: 'Roja' },
    })
    expect(d).toEqual({ vehiculo: 'CAM-02 Cargo', placa_chuto: 'B34CD5E', placa_batea: '', color_batea: 'Roja' })
  })

  it('si salió en su camión habitual, conserva la batea y el color de la ficha', () => {
    const d = datosVehiculoImpreso({
      transportista: chofer,
      vehiculo_viaje: { id: 'v1', codigo: 'CAM-01', nombre: 'NPR', placa: 'A12BC3D', color_batea: null },
    })
    expect(d.placa_batea).toBe('X99')
    expect(d.color_batea).toBe('Azul')
  })

  it('con modelo y placa de batea propios (285), imprime los datos del camión', () => {
    const d = datosVehiculoImpreso({
      transportista: chofer,
      vehiculo_viaje: { id: 'v2', codigo: 'CAM-02', nombre: 'Cargo', modelo: 'Mack Granite 2020', placa: 'B34CD5E', placa_batea: 'ZZ111AA', color_batea: 'Roja' },
    })
    expect(d).toEqual({ vehiculo: 'CAM-02 Mack Granite 2020', placa_chuto: 'B34CD5E', placa_batea: 'ZZ111AA', color_batea: 'Roja' })
  })

  it('sin camión de la flota (externos o históricos) imprime la ficha como antes', () => {
    const d = datosVehiculoImpreso({ transportista: chofer, vehiculo_viaje: null })
    expect(d.vehiculo).toBe('NPR viejo')
    expect(d.placa_chuto).toBe('A12BC3D')
  })

  it('los tres PDFs de despacho usan el camión del viaje', () => {
    for (const f of ['despachoPDF', 'guiaDespachoPDF', 'ordenDespachoPDF']) {
      const fuente = leer(`src/services/pdf/${f}.js`)
      expect(fuente).toContain('datosVehiculoImpreso(despacho)')
      expect(fuente).not.toContain('transportista?.placa_chuto')
    }
  })
})

describe('Pantalla de Transportistas con pestañas', () => {
  it('el nombre del camión no repite el código', () => {
    expect(nombreVehiculo({ codigo: 'CAM-01', nombre: 'CAM-01 NPR Blanco' })).toBe('CAM-01 NPR Blanco')
    expect(nombreVehiculo({ codigo: 'CAM-02', nombre: 'Cargo' })).toBe('CAM-02 Cargo')
  })

  it('separa choferes y vehículos en pestañas, recuerda la última y enlaza el camión fijo', () => {
    const vista = leer('src/views/TransportistasView.jsx')
    expect(vista).toContain('Choferes y transportistas')
    expect(vista).toContain('Vehículos de la empresa')
    expect(vista).toContain('localStorage.setItem(PESTANA_KEY')
    expect(vista).toContain('onVerVehiculo={verVehiculo}')
    // La ficha del chofer local ya no muestra el vehículo escrito a mano
    expect(vista).toContain('!transportista.es_local && transportista.vehiculo')
  })
})

describe('Reporte de transportistas: reparto del flete', () => {
  it('chofer = su comisión, empresa = total de fletes menos esa comisión', () => {
    // Chofer A de la prueba manual: $20 dentro de Carabobo (nómina) + $35 fuera (20% = $7)
    expect(repartoFlete({ flete_total_usd: 55, neto_total_usd: 7 })).toEqual({ total: 55, chofer: 7, empresa: 48 })
    expect(repartoFlete({})).toEqual({ total: 0, chofer: 0, empresa: 0 })
  })

  it('la pantalla y el PDF ya no muestran pagado ni saldo', () => {
    const tab = leer('src/components/reportes/TabTransportistas.jsx')
    const pdf = leer('src/services/pdf/flotaChoferesPDF.js')
    for (const fuente of [tab, pdf]) {
      expect(fuente).not.toMatch(/pagado_usd|saldo_usd|comision_pagada_usd|comision_pendiente_usd/)
      expect(fuente).toContain('repartoFlete')
    }
  })
})

describe('Reporte detallado por camión (286)', () => {
  it('período anterior con la misma cantidad de días', () => {
    expect(periodoAnterior('2026-10-26', '2026-10-29')).toEqual({ desde: '2026-10-22', hasta: '2026-10-25' })
    expect(periodoAnterior('2026-10-01', '2026-10-31')).toEqual({ desde: '2026-08-31', hasta: '2026-09-30' })
    expect(periodoAnterior(null, '2026-10-29')).toBeNull()
    expect(diasDelPeriodo('2026-10-26', '2026-10-29')).toBe(4)
  })

  it('variación y porcentaje se leen fácil', () => {
    expect(variacion(12, 10).texto).toBe('▲ 20%')
    expect(variacion(5, 10).texto).toBe('▼ 50%')
    expect(variacion(3, 0).texto).toBe('▲ nuevo')
    expect(variacion(0, 0).texto).toBe('= igual')
    expect(porcentaje(1, 2)).toBe(50)
    expect(porcentaje(1, 0)).toBe(0)
  })

  it('la migración 286 mantiene las métricas congeladas y agrega el detalle', () => {
    const m = leer('supabase/release/main/286_flota_reporte_detallado_apply.sql')
    expect(m).toContain("nd.estado IN ('despachada', 'entregada')")
    expect(m).toContain('SUM(nd.total_usd - nd.flete_usd - nd.corte_usd)')
    expect(m).toContain('AS empresa_usd')
    expect(m).toContain("COUNT(DISTINCT (nd.creado_en AT TIME ZONE 'America/Caracas')::date)")
    expect(m).toContain('CREATE OR REPLACE FUNCTION public.obtener_detalle_viajes_flota(')
    expect(m).toContain('GRANT EXECUTE ON FUNCTION public.obtener_detalle_viajes_flota(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) TO service_role')
    expect(m).not.toMatch(/GRANT EXECUTE[^;]*TO (anon|authenticated)/)
  })
})

describe('Barra común de Reportes en Transportistas (resumido / detallado)', () => {
  it('usa la barra común de Reportes con Imprimir/Descargar PDF y las variantes resumido/detallado', () => {
    const tab = leer('src/components/reportes/TabTransportistas.jsx')
    const barra = leer('src/components/reportes/BarraPeriodoReporte.jsx')
    expect(tab).toContain('<BarraPeriodoReporte')
    expect(tab).toContain('titulo="Periodo de despachos"')
    expect(tab).toContain("id: 'resumido'")
    expect(tab).toContain("id: 'detallado'")
    expect(tab).toContain('onExportar={generarReporte}')
    expect(barra).toContain("'Imprimir PDF'")
    expect(barra).toContain("'Descargar PDF'")
    // Arranca en "Hoy", como las demás pestañas
    expect(tab).toContain('getDayRange(0)')
  })

  it('la sección de flota ya no tiene su propio PDF ni Excel', () => {
    const seccion = leer('src/components/reportes/SeccionFlotaChoferes.jsx')
    expect(seccion).not.toMatch(/exportarPDF|exportarExcel|generarFlotaChoferesPDF/)
  })

  it('el resumido omite el detalle viaje por viaje y el Cuadro 2', () => {
    const pdf = leer('src/services/pdf/flotaChoferesPDF.js')
    expect(pdf).toContain("const detallado = modo === 'detallado'")
    expect(pdf).toContain('if (detallado && detalle.length > 0)')
    expect(pdf).toContain('if (detallado) y = tabla(doc, y,')
  })
})
