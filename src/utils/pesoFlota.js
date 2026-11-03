// src/utils/pesoFlota.js
// Indicadores de peso del reporte de flota, calculados a partir de una fila por viaje
// (api/reportes/flota-peso). Un viaje es un despacho despachada/entregada.
//
// Solo cuentan con confianza los viajes con TODOS sus artículos con peso ("completos").
// Los "incompletos" (faltan algunos pesos) y "sin datos" (ninguno) se cuentan aparte y nunca se inventan.

export const CARGA_BAJA_PCT = 40 // un viaje con menos de este % de la capacidad se considera carga baja

const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** 'completo' | 'incompleto' | 'sin_datos' */
export function clasificarViaje(v) {
  const total = Math.trunc(n(v?.items_total))
  const sin = Math.trunc(n(v?.items_sin_peso))
  if (total <= 0 || sin >= total) return 'sin_datos'
  return sin > 0 ? 'incompleto' : 'completo'
}

/** % de la capacidad del camión que ocupa el viaje (entero). Sin capacidad o sin datos → null. */
export function usoPct(v) {
  const cap = n(v?.capacidad_kg)
  if (cap <= 0 || clasificarViaje(v) === 'sin_datos') return null
  return Math.round((n(v.peso_total_kg) / cap) * 100)
}

export function resumirViajes(viajes = []) {
  const r = {
    viajes: 0, completos: 0, incompletos: 0, sinDatos: 0,
    kgCompletos: 0, kgConocidos: 0, fleteCompletos: 0,
    sobrecargados: 0, cargaBaja: 0, viajesConCapacidad: 0, sumaUso: 0,
  }
  for (const v of viajes) {
    r.viajes += 1
    const tipo = clasificarViaje(v)
    if (tipo === 'sin_datos') { r.sinDatos += 1; continue }
    const kg = n(v.peso_total_kg)
    r.kgConocidos += kg
    const cap = n(v.capacidad_kg)
    // Un viaje incompleto ya puede estar sobrecargado: su peso real es al menos el conocido.
    if (cap > 0 && kg > cap) r.sobrecargados += 1
    if (tipo === 'incompleto') { r.incompletos += 1; continue }
    r.completos += 1
    r.kgCompletos += kg
    r.fleteCompletos += n(v.flete_usd)
    if (cap > 0) {
      r.viajesConCapacidad += 1
      r.sumaUso += (kg / cap) * 100
      if ((kg / cap) * 100 < CARGA_BAJA_PCT) r.cargaBaja += 1
    }
  }
  return {
    viajes: r.viajes, completos: r.completos, incompletos: r.incompletos, sinDatos: r.sinDatos,
    toneladas: r.kgConocidos / 1000,
    toneladasCompletas: r.kgCompletos / 1000,
    // flete ÷ toneladas, solo con viajes completos (comparación justa)
    costoPorTonelada: r.kgCompletos > 0 ? r.fleteCompletos / (r.kgCompletos / 1000) : null,
    usoPromedioPct: r.viajesConCapacidad > 0 ? Math.round(r.sumaUso / r.viajesConCapacidad) : null,
    viajesConCapacidad: r.viajesConCapacidad,
    sobrecargados: r.sobrecargados,
    cargaBaja: r.cargaBaja,
  }
}

/** Agrupa los viajes por una clave (por ejemplo vehiculo_id) y resume cada grupo. → { [clave]: resumen } */
export function resumirPor(viajes = [], campo = 'vehiculo_id') {
  const grupos = {}
  for (const v of viajes) {
    const k = v?.[campo]
    if (!k) continue
    if (!grupos[k]) grupos[k] = []
    grupos[k].push(v)
  }
  return Object.fromEntries(Object.entries(grupos).map(([k, lista]) => [k, resumirViajes(lista)]))
}

/** Solo viajes con camión registrado (el cuadro por vehículo). */
export const soloConCamion = (viajes = []) => viajes.filter(v => v?.vehiculo_id)

/** Texto "12,4 t" / "850 kg": toneladas si pasa de 1000 kg. */
export function textoPeso(kg) {
  const x = n(kg)
  if (x >= 1000) return `${(x / 1000).toLocaleString('es-VE', { maximumFractionDigits: 2 })} t`
  return `${x.toLocaleString('es-VE', { maximumFractionDigits: 1 })} kg`
}

/** Totales del reporte: siempre en toneladas con 2 decimales ("0,85 t", "1,50 t"), para comparar períodos sin mezclar unidades. */
export function textoToneladas(kg) {
  return `${(n(kg) / 1000).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`
}

/** Kilos exactos para el texto de ayuda: "1.500 kg". */
export function textoKilos(kg) {
  return `${n(kg).toLocaleString('es-VE', { maximumFractionDigits: 1 })} kg`
}
