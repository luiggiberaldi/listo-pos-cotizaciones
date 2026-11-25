/**
 * Utilidad compartida (UI + pruebas) para detectar posibles cargas recientes
 * duplicadas (N32) en ingresos por lote o movimientos manuales, sin bloquear
 * cargas legítimas si el operador confirma visualmente.
 */
export function detectarCargasRecientesSimilares(movimientosRecientes = [], candidatos = [], ahoraMs = Date.now(), ventanaHoras = 24) {
  if (!Array.isArray(movimientosRecientes) || !Array.isArray(candidatos) || candidatos.length === 0) {
    return []
  }
  const limiteMs = ahoraMs - (ventanaHoras * 60 * 60 * 1000)
  const porProducto = new Map()

  for (const mov of movimientosRecientes) {
    if (!mov?.producto_id || mov?.tipo !== 'ingreso') continue
    if (['reversion_inventario', 'conteo_fisico', 'product_create'].includes(mov?.origen_tipo)) continue
    const ts = mov.creado_en ? Date.parse(mov.creado_en) : NaN
    if (Number.isFinite(ts) && ts < limiteMs) continue
    const cant = Number(mov.cantidad)
    if (!Number.isFinite(cant) || cant <= 0) continue
    const list = porProducto.get(mov.producto_id) || []
    list.push({ ...mov, _cantNum: cant })
    porProducto.set(mov.producto_id, list)
  }

  const alertas = []
  const vistas = new Set()
  for (const item of candidatos) {
    const prodId = item?.producto_id || item?.id
    const cant = Number(item?.cantidad)
    if (!prodId || !Number.isFinite(cant) || cant <= 0) continue
    const posibles = porProducto.get(prodId) || []
    const match = posibles.find(m => Math.abs(m._cantNum - cant) < 0.0005)
    if (!match) continue
    const clave = `${prodId}:${cant}`
    if (vistas.has(clave)) continue
    vistas.add(clave)
    alertas.push({
      producto_id: prodId,
      nombre: item.nombre || match.producto_nombre || 'Producto',
      cantidad: cant,
      motivo: match.motivo || 'Ingreso previo',
      creado_en: match.creado_en || null,
    })
  }
  return alertas
}

/**
 * Consolida filas duplicadas por código normalizado dentro de una importación CSV
 * (N34) sumando su stock inicial para evitar errores parciales o duplicación.
 */
export function consolidarFilasImportacionCsv(filas = []) {
  const salida = []
  const porCodigo = new Map()
  for (const f of filas) {
    const codigoNorm = String(f?.codigo || '').trim().toUpperCase()
    if (!codigoNorm) {
      salida.push({ ...f })
      continue
    }
    const existente = porCodigo.get(codigoNorm)
    if (!existente) {
      const copia = { ...f, codigo: String(f.codigo).trim() }
      porCodigo.set(codigoNorm, copia)
      salida.push(copia)
    } else {
      existente.stock_actual = Number(
        ((Number(existente.stock_actual) || 0) + (Number(f.stock_actual) || 0)).toFixed(4)
      )
    }
  }
  return salida
}
