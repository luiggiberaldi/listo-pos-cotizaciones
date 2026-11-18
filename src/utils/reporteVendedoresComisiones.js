// Comisiones del Reporte de Vendedores (OP-2026-032).
//
// Regla: el reporte muestra SOLO las comisiones guardadas por el sistema
// (las mismas que usan Reportes → Comisiones y Liquidación). No estima
// comisiones para despachos sin fila guardada: si no hay fila es porque la
// regla de la base decidió que no corresponde (cobro a destino pendiente,
// cliente de EMPRESA, donación, etc.) o porque aún no nace. Cada fila se
// atribuye a quien la recibe (comisiones.vendedorid = dueño del cliente),
// no a quien hizo la venta.
import { agruparPor } from './agruparPor'

const n = v => Number(v || 0)

export function construirComisionesGuardadas(listaDespachos = [], comisionesList = [], vendedoresInfo = {}) {
  const out = []
  const comisionesPorDespacho = agruparPor(comisionesList, 'despachoid')
  listaDespachos.forEach(d => {
    const filas = comisionesPorDespacho.get(d.despacho_id) || []
    filas.forEach(c => {
      const vendedorid = c.vendedorid || d.asesor_id || d.vendedor_id
      out.push({
        totalcomision: n(c.totalcomision),
        comisioncabilla: n(c.comisioncabilla),
        comisionotros: n(c.comisionotros),
        pctcabilla: n(c.pctcabilla),
        pctotros: n(c.pctotros),
        estado: c.estado || 'generada',
        // v3: filas split llegan como 'designado' (0.5%) o 'cliente_ajeno_dueno' (1.5%)
        es_split: typeof c.tipo === 'string' && (c.tipo.startsWith('cliente_ajeno') || c.tipo === 'designado'),
        vendedorid,
        despachoid: d.despacho_id,
        vendedor: vendedoresInfo[vendedorid],
      })
    })
  })
  return out
}
