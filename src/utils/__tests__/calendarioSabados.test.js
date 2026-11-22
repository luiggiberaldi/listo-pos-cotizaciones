// construacero-staging/src/utils/__tests__/calendarioSabados.test.js
// OP-2026-036 — Arnés de pruebas del Calendario Mensual de Sábados y sus guardarraíles.
import { describe, expect, it } from 'vitest'
import {
  calcularCambiosCalendario,
  contarTurnosPorVendedor,
  desplazarMes,
  detectarAlertaSabadoSemana,
  esFechaISOValida,
  esFechaSabado,
  formatearSabadoLegible,
  getFechaCaracasISO,
  obtenerRangoMesISO,
  obtenerSabadoDeLaSemana,
  obtenerSabadosDelMes,
  validarLoteDesignaciones,
} from '../calendarioSabados.js'

const UUID_JOSUE = 'd6663eec-1b3b-43c4-a4b9-9cab16bf80a7'
const UUID_EDGAR = 'f56214bb-1f62-42e7-888d-aaf44e177fd6'
const UUID_EIKER = 'a7223bc3-7ae9-4cdc-926f-875ca639d425'
const UUID_NIKI  = '5ec8c63b-c96d-46f2-b95e-16420d15d726'

const VENDEDORES = {
  [UUID_JOSUE]: { id: UUID_JOSUE, nombre: 'Josué Marciales', rol: 'vendedor' },
  [UUID_EDGAR]: { id: UUID_EDGAR, nombre: 'Edgar Ramírez', rol: 'vendedor' },
  [UUID_EIKER]: { id: UUID_EIKER, nombre: 'Eiker Montaner', rol: 'vendedor' },
  [UUID_NIKI]:  { id: UUID_NIKI,  nombre: 'Niki Ramírez',  rol: 'supervisor' },
}

describe('OP-2026-036 — calendarioSabados (hora local Venezuela y fechas)', () => {
  it('getFechaCaracasISO no salta al día siguiente después de las 8 p. m. de Venezuela (03:30 UTC)', () => {
    // 2026-11-21 23:30 hora Venezuela = 2026-11-22T03:30:00Z
    const nocheVenezuela = new Date('2026-11-22T03:30:00.000Z')
    expect(getFechaCaracasISO(nocheVenezuela)).toBe('2026-11-21')

    // 2026-11-22 00:05 hora Venezuela = 2026-11-22T04:05:00Z
    const madrugadaDomingo = new Date('2026-11-22T04:05:00.000Z')
    expect(getFechaCaracasISO(madrugadaDomingo)).toBe('2026-11-22')
  })

  it('esFechaISOValida rechaza fechas inexistentes y formatos mal escritos', () => {
    expect(esFechaISOValida('2026-11-21')).toBe(true)
    expect(esFechaISOValida('2026-02-29')).toBe(false) // 2026 no es bisiesto
    expect(esFechaISOValida('2026-02-30')).toBe(false)
    expect(esFechaISOValida('2026-13-01')).toBe(false)
    expect(esFechaISOValida('21/11/2026')).toBe(false)
    expect(esFechaISOValida('')).toBe(false)
  })

  it('esFechaSabado acepta solo sábados y rechaza lunes a viernes y domingos', () => {
    expect(esFechaSabado('2026-11-07')).toBe(true)
    expect(esFechaSabado('2026-11-14')).toBe(true)
    expect(esFechaSabado('2026-11-21')).toBe(true)
    expect(esFechaSabado('2026-11-28')).toBe(true)
    expect(esFechaSabado('2026-11-20')).toBe(false) // viernes
    expect(esFechaSabado('2026-11-22')).toBe(false) // domingo
    expect(esFechaSabado('2026-11-24')).toBe(false) // martes
  })

  it('formatearSabadoLegible devuelve texto claro en versión corta y larga', () => {
    expect(formatearSabadoLegible('2026-11-07', { corto: true })).toBe('Sáb 07 nov')
    expect(formatearSabadoLegible('2026-11-28', { corto: false })).toBe('Sábado 28 de noviembre de 2026')
  })

  it('desplazarMes cambia de año correctamente en diciembre y enero', () => {
    expect(desplazarMes(2026, 12, 1)).toEqual({ anio: 2027, mes: 1 })
    expect(desplazarMes(2027, 1, -1)).toEqual({ anio: 2026, mes: 12 })
    expect(obtenerRangoMesISO(2026, 11)).toEqual({
      anio: 2026,
      mes: 11,
      desde: '2026-11-01',
      hasta: '2026-11-30',
      etiqueta: 'Noviembre 2026',
    })
  })
})

describe('OP-2026-036 — obtenerSabadosDelMes (4 y 5 sábados, estados y bloqueo)', () => {
  it('noviembre 2026 tiene 4 sábados y clasifica pasado, hoy y futuro cuando hoy es sábado 21-nov', () => {
    const sabados = obtenerSabadosDelMes(2026, 11, '2026-11-21')
    expect(sabados.map(s => s.fecha)).toEqual([
      '2026-11-07',
      '2026-11-14',
      '2026-11-21',
      '2026-11-28',
    ])
    expect(sabados.map(s => s.estado)).toEqual(['pasado', 'pasado', 'hoy', 'futuro'])
    expect(sabados.map(s => s.editable)).toEqual([false, false, true, true])
  })

  it('cuando hoy es domingo 22-nov, el 21-nov queda bloqueado (pasado) y el 28-nov es próximo sábado', () => {
    const sabados = obtenerSabadosDelMes(2026, 11, '2026-11-22')
    expect(sabados.map(s => s.estado)).toEqual(['pasado', 'pasado', 'pasado', 'proximo'])
    expect(sabados.map(s => s.editable)).toEqual([false, false, false, true])
  })

  it('octubre 2026 tiene 5 sábados (03, 10, 17, 24 y 31)', () => {
    const sabados = obtenerSabadosDelMes(2026, 10, '2026-10-01')
    expect(sabados).toHaveLength(5)
    expect(sabados.map(s => s.fecha)).toEqual([
      '2026-10-03',
      '2026-10-10',
      '2026-10-17',
      '2026-10-24',
      '2026-10-31',
    ])
    expect(sabados[0].estado).toBe('proximo')
    expect(sabados.every(s => s.editable)).toBe(true)
  })
})

describe('OP-2026-036 — calcularCambiosCalendario y contarTurnosPorVendedor', () => {
  it('ignora sábados pasados aunque estén en borrador y detecta asignar, cambiar y quitar', () => {
    const sabados = obtenerSabadosDelMes(2026, 12, '2026-12-10') // sáb 05 pasado; 12, 19, 26 editables
    const actuales = {
      '2026-12-05': { fecha: '2026-12-05', designado_id: UUID_JOSUE, designado: VENDEDORES[UUID_JOSUE] },
      '2026-12-12': { fecha: '2026-12-12', designado_id: UUID_EDGAR, designado: VENDEDORES[UUID_EDGAR] },
      '2026-12-19': { fecha: '2026-12-19', designado_id: UUID_EIKER, designado: VENDEDORES[UUID_EIKER] },
    }
    const borradores = {
      '2026-12-05': UUID_NIKI, // pasado -> debe ignorarse
      '2026-12-12': UUID_JOSUE, // cambiar Edgar -> Josué
      '2026-12-19': '', // quitar Eiker
      '2026-12-26': UUID_NIKI, // asignar Niki
    }

    const cambios = calcularCambiosCalendario(sabados, actuales, borradores, VENDEDORES)
    expect(cambios).toHaveLength(3)
    expect(cambios[0]).toMatchObject({
      fecha: '2026-12-12',
      tipo: 'cambiar',
      anteriorNombre: 'Edgar Ramírez',
      nuevoNombre: 'Josué Marciales',
    })
    expect(cambios[1]).toMatchObject({
      fecha: '2026-12-19',
      tipo: 'quitar',
      anteriorNombre: 'Eiker Montaner',
      nuevoId: null,
    })
    expect(cambios[2]).toMatchObject({
      fecha: '2026-12-26',
      tipo: 'asignar',
      nuevoNombre: 'Niki Ramírez',
    })

    const turnos = contarTurnosPorVendedor(sabados, actuales, borradores, VENDEDORES)
    // 05 dic sigue siendo Josué (pasado) + 12 dic Josué = 2; 26 dic Niki = 1
    expect(turnos).toEqual([
      { id: UUID_JOSUE, nombre: 'Josué Marciales', cantidad: 2 },
      { id: UUID_NIKI, nombre: 'Niki Ramírez', cantidad: 1 },
    ])
  })
})

describe('OP-2026-036 — detectarAlertaSabadoSemana y validarLoteDesignaciones', () => {
  it('avisa viernes y sábado si el sábado de la semana no tiene designado, y se apaga al asignarlo', () => {
    expect(obtenerSabadoDeLaSemana('2026-11-27')).toBe('2026-11-28') // viernes 27 -> sábado 28
    const alertaViernes = detectarAlertaSabadoSemana({}, '2026-11-27')
    expect(alertaViernes.alerta).toBe(true)
    expect(alertaViernes.esHoySabado).toBe(false)
    expect(alertaViernes.fecha).toBe('2026-11-28')

    const alertaSabado = detectarAlertaSabadoSemana({}, '2026-11-28')
    expect(alertaSabado.alerta).toBe(true)
    expect(alertaSabado.esHoySabado).toBe(true)

    const sinAlertaCuandoAsignado = detectarAlertaSabadoSemana(
      { '2026-11-28': { designado_id: UUID_EIKER } },
      '2026-11-28',
    )
    expect(sinAlertaCuandoAsignado.alerta).toBe(false)

    // En lunes (faltan 5 días) no molesta todavía con alerta urgente
    const lunes = detectarAlertaSabadoSemana({}, '2026-11-23')
    expect(lunes.alerta).toBe(false)
  })

  it('validarLoteDesignaciones rechaza días que no son sábado, sábados pasados, duplicados y años lejanos', () => {
    const hoy = '2026-11-22'

    expect(validarLoteDesignaciones([], { hoyISO: hoy }).ok).toBe(false)

    // Martes rechazado
    const martes = validarLoteDesignaciones([{ fecha: '2026-11-24', designado_id: UUID_EIKER }], { hoyISO: hoy })
    expect(martes.ok).toBe(false)
    expect(martes.error).toMatch(/no es un sábado/i)

    // Sábado pasado rechazado
    const pasado = validarLoteDesignaciones([{ fecha: '2026-11-21', designado_id: UUID_EIKER }], { hoyISO: hoy })
    expect(pasado.ok).toBe(false)
    expect(pasado.error).toMatch(/sábado pasado/i)

    // Fecha repetida rechazada
    const repetida = validarLoteDesignaciones([
      { fecha: '2026-11-28', designado_id: UUID_EIKER },
      { fecha: '2026-11-28', designado_id: UUID_JOSUE },
    ], { hoyISO: hoy })
    expect(repetida.ok).toBe(false)
    expect(repetida.error).toMatch(/repetida/i)

    // Fecha demasiado lejana rechazada
    const lejana = validarLoteDesignaciones([{ fecha: '2028-01-01', designado_id: UUID_EIKER }], { hoyISO: hoy })
    expect(lejana.ok).toBe(false)
    expect(lejana.error).toMatch(/límite/i)

    // Lote válido con asignación y limpieza (null)
    const valido = validarLoteDesignaciones([
      { fecha: '2026-11-28', designado_id: UUID_EIKER },
      { fecha: '2026-12-05', designado_id: '' },
    ], { hoyISO: hoy })
    expect(valido).toEqual({
      ok: true,
      cambios: [
        { fecha: '2026-11-28', designado_id: UUID_EIKER },
        { fecha: '2026-12-05', designado_id: null },
      ],
    })
  })
})
